import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAccess } from "../server/access.js";
import { accountStore } from "../server/accounts.js";
import { inviteGate } from "../server/invite.js";

test("invite access preserves leading zeroes, persists per account, and limits guesses across accounts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-invite-test-"));
  const settings = {
    PROOF_HOSTED: "false",
    PROOF_INVITE_CODE: "0123",
    PROOF_ACCOUNTS_FILE: join(directory, "accounts.json"),
    PROOF_ACCESS_KEY: "a-test-only-signing-key-with-at-least-24-characters",
  };
  const original = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, settings);
  const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];
  async function start() {
    const app = express();
    app.use(express.json());
    installAccess(app);
    app.get("/api/private", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }
  try {
    const base = await start();
    const json = { "Content-Type": "application/json" };
    const register = async (name: string) => {
      const result = await fetch(base + "/api/session", {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          name,
          password: "synthetic-password-only",
          register: true,
        }),
      });
      assert.equal(result.status, 200);
      const session = await result.json();
      assert.equal(session.inviteRequired, true);
      return {
        headers: {
          ...json,
          Cookie: result.headers.get("set-cookie")!.split(";")[0],
        },
        session,
      };
    };
    assert.equal((await fetch(base + "/api/private")).status, 401);
    const accepted = await register("Accepted fixture");
    const redeem = (
      headers: Record<string, string>,
      code: unknown,
      url = base,
    ) =>
      fetch(url + "/api/invite", {
        method: "POST",
        headers,
        body: JSON.stringify({ code }),
      });
    assert.equal((await redeem(accepted.headers, 123)).status, 400);
    assert.equal((await redeem(accepted.headers, "0123")).status, 200);
    assert.equal(
      (await fetch(base + "/api/private", { headers: accepted.headers }))
        .status,
      200,
    );
    const restarted = await start();
    assert.equal(
      (await fetch(restarted + "/api/private", { headers: accepted.headers }))
        .status,
      200,
    );
    assert.equal(
      (
        await (
          await fetch(restarted + "/api/session", { headers: accepted.headers })
        ).json()
      ).inviteRequired,
      false,
    );
    assert.ok(accountStore().get(accepted.session.user.id)?.invitedAt);
    const blocked = await register("Blocked fixture");
    // One failed guess was made by the accepted account, four more exhaust the IP bucket.
    for (let i = 0; i < 4; i++)
      assert.equal((await redeem(blocked.headers, "9999")).status, 400);
    const limited = await redeem(blocked.headers, "0123");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "900");
    const another = await register("Another fixture");
    assert.equal((await redeem(another.headers, "0123")).status, 429);
    assert.equal(
      (await fetch(base + "/api/private", { headers: another.headers })).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/session", { headers: another.headers })).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "DELETE",
          headers: another.headers,
        })
      ).status,
      200,
    );
    process.env.PROOF_INVITE_CODE = "12345";
    assert.throws(() => inviteGate(accountStore()), /exactly four digits/);
  } finally {
    for (const server of servers) server.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
