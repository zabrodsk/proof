import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAccess } from "../server/access.js";
import { accountStore } from "../server/accounts.js";
import { WorkOS, CookieSession } from "@workos-inc/node";

test("WorkOS gates APIs, uses PKCE and rejects forged callbacks", async () => {
  const values = {
    WORKOS_API_KEY: "sk_test_placeholder",
    WORKOS_CLIENT_ID: "client_test_placeholder",
    WORKOS_REDIRECT_URI: "http://127.0.0.1:4317/auth/callback",
    WORKOS_COOKIE_PASSWORD:
      "a-test-only-cookie-password-at-least-32-characters",
    PROOF_ACCOUNTS_FILE: join(
      mkdtempSync(join(tmpdir(), "proof-workos-")),
      "accounts.json",
    ),
    PROOF_HOSTED: "false",
  };
  const original = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    delete process.env.WORKOS_COOKIE_PASSWORD;
    assert.throws(() => installAccess(express()), /WORKOS_COOKIE_PASSWORD/);
    process.env.WORKOS_COOKIE_PASSWORD = values.WORKOS_COOKIE_PASSWORD;
    const app = express();
    app.use(express.json());
    installAccess(app);
    app.get("/api/private", (_req, res) => res.json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + "/api/private")).status, 401);
    assert.deepEqual(await (await fetch(base + "/api/session")).json(), {
      authenticated: false,
      hosted: false,
      provider: "workos",
    });
    assert.equal(
      (await fetch(base + "/api/session", { method: "POST" })).status,
      405,
    );
    const login = await fetch(base + "/auth/login?screen=sign-up", {
      redirect: "manual",
    });
    const location = new URL(login.headers.get("location")!);
    assert.equal(location.hostname, "api.workos.com");
    assert.equal(location.searchParams.get("screen_hint"), "sign-up");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("state"));
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    const callback = await fetch(
      base + "/auth/callback?code=fake&state=forged",
      { headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] } },
    );
    assert.equal(callback.status, 400);
    assert.match(callback.headers.get("set-cookie")!, /Max-Age=0/);
  } finally {
    server?.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("WorkOS identities retain their owner ID and do not accept password login", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "proof-workos-account-")),
    "accounts.json",
  );
  const accounts = accountStore(path);
  const workos = accounts.workos("user_synthetic_workos", "Adam");
  assert.equal(workos.id, "user_synthetic_workos");
  assert.equal(accounts.login("Adam", "any-password"), undefined);
  assert.equal(accounts.create("Adam", "legacy-password"), undefined);
  accounts.charge(workos.id, 1000, 0.001);
  assert.equal(accounts.workos(workos.id, "Adam Updated").inputTokens, 1000);
  const legacy = accounts.create("Adam", "legacy-password")!;
  assert.ok(legacy);
  assert.equal(accounts.login("Adam", "legacy-password")?.id, legacy.id);
  assert.equal(accountStore(path).get(workos.id)?.name, "Adam Updated");
});

test("successful WorkOS callback forwards the verified owner ID to protected APIs", async () => {
  const values = {
    WORKOS_API_KEY: "sk_test_placeholder",
    WORKOS_CLIENT_ID: "client_test_placeholder",
    WORKOS_REDIRECT_URI: "http://127.0.0.1:4317/auth/callback",
    WORKOS_COOKIE_PASSWORD:
      "a-test-only-cookie-password-at-least-32-characters",
    PROOF_ACCOUNTS_FILE: join(
      mkdtempSync(join(tmpdir(), "proof-workos-success-")),
      "accounts.json",
    ),
    PROOF_HOSTED: "false",
    PROOF_INVITE_CODE: "0123",
  };
  const original = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  const client = new WorkOS(values.WORKOS_API_KEY, {
    clientId: values.WORKOS_CLIENT_ID,
  });
  const exchange = mock.method(
    Object.getPrototypeOf(client.userManagement),
    "authenticateWithCode",
    async (input: any) => {
      assert.equal(input.code, "synthetic-code");
      assert.ok(input.codeVerifier);
      return { sealedSession: "synthetic-sealed-session" };
    },
  );
  const authentication = mock.method(
    CookieSession.prototype,
    "authenticate",
    async () =>
      ({
        authenticated: true,
        user: {
          id: "user_synthetic_verified",
          firstName: "Fixture",
          lastName: "User",
          email: "fixture@example.test",
        },
      }) as any,
  );
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    const app = express();
    app.use(express.json());
    installAccess(app);
    app.get("/api/private", (_req, res) =>
      res.json({ owner: res.locals.proofSession }),
    );
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(base + "/auth/login", { redirect: "manual" });
    const state = new URL(login.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const callback = await fetch(
      base +
        "/auth/callback?code=synthetic-code&state=" +
        encodeURIComponent(state),
      {
        redirect: "manual",
        headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
      },
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/app");
    for (const [requested, expected] of [
      [
        "/app/integrations?platform=claude#connect",
        "/app/integrations?platform=claude#connect",
      ],
      ["https://example.test/app", "/app"],
      ["//example.test/app", "/app"],
      ["/application", "/app"],
      ["/app/../../auth/logout", "/app"],
    ]) {
      const start = await fetch(
        base + "/auth/login?returnTo=" + encodeURIComponent(requested),
        { redirect: "manual" },
      );
      const flowState = new URL(
        start.headers.get("location")!,
      ).searchParams.get("state")!;
      const finish = await fetch(
        base +
          "/auth/callback?code=synthetic-code&state=" +
          encodeURIComponent(flowState),
        {
          redirect: "manual",
          headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0] },
        },
      );
      assert.equal(finish.status, 302);
      assert.equal(finish.headers.get("location"), expected);
    }
    const cookie = callback.headers
      .getSetCookie()
      .find((value) => value.startsWith("proof_workos="))!
      .split(";")[0];
    const session = await (
      await fetch(base + "/api/session", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(session.user.id, "user_synthetic_verified");
    assert.equal(session.provider, "workos");
    assert.equal(session.inviteRequired, true);
    assert.equal(
      (await fetch(base + "/api/private", { headers: { Cookie: cookie } }))
        .status,
      403,
    );
    const accepted = await fetch(base + "/api/invite", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "0123" }),
    });
    assert.equal(accepted.status, 200);
    const protectedResult = await (
      await fetch(base + "/api/private", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(protectedResult.owner, "user_synthetic_verified");
    assert.equal(exchange.mock.callCount(), 6);
  } finally {
    server?.close();
    exchange.mock.restore();
    authentication.mock.restore();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
