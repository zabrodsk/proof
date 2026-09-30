import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAccess } from "../server/access.js";

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
