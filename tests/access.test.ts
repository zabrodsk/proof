import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { installAccess } from "../server/access.js";
test("hosted API requires a signed session and limits failed access attempts", async () => {
  const original = {
    hosted: process.env.PROOF_HOSTED,
    key: process.env.PROOF_ACCESS_KEY,
    inviteCode: process.env.PROOF_INVITE_CODE,
    accountsFile: process.env.PROOF_ACCOUNTS_FILE,
  };
  process.env.PROOF_HOSTED = "true";
  process.env.PROOF_INVITE_CODE = "1234";
  process.env.PROOF_ACCESS_KEY = "a-test-only-key-with-at-least-24-characters";
  process.env.PROOF_ACCOUNTS_FILE = join(
    mkdtempSync(join(tmpdir(), "proof-accounts-")),
    "accounts.json",
  );
  const app = express();
  app.use(express.json());
  installAccess(app);
  app.get("/api/private", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/api/private")).status, 401);
    const invalid = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "A",
        password: "test-password-only",
        register: true,
      }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /username/);

    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "  Hackathon visitor  ",
        password: "test-password-only",
        register: true,
      }),
    });
    assert.equal(login.status, 200);
    const authBody = await login.json();
    assert.equal(authBody.user.name, "Hackathon visitor");
    assert.equal(authBody.user.jevUsd, 0);
    assert.equal(authBody.inviteRequired, true);
    const claim = (name: string, password = "replacement-password") =>
      fetch(base + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          password,
          register: true,
        }),
      });
    assert.equal((await claim("HACKATHON VISITOR")).status, 409);
    assert.equal((await claim("Another public visitor")).status, 200);
    const names = await (await fetch(base + "/api/session")).json();
    assert.equal(names.authenticated, false);
    assert.equal("roster" in names, false);
    assert.equal("user" in names, false);
    const relogin = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "hackathon visitor",
        password: "test-password-only",
      }),
    });
    assert.equal((await relogin.json()).user.id, authBody.user.id);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    const headers = {
      Cookie: cookie.split(";")[0],
      "Content-Type": "application/json",
    };
    assert.equal((await fetch(base + "/api/private", { headers })).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "1234" }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/invite", {
          method: "POST",
          headers,
          body: JSON.stringify({ code: "0000" }),
        })
      ).status,
      400,
    );
    const accepted = await fetch(base + "/api/invite", {
      method: "POST",
      headers,
      body: JSON.stringify({ code: "1234" }),
    });
    assert.deepEqual(await accepted.json(), { inviteRequired: false });
    assert.equal(
      (
        await fetch(base + "/api/private", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
    const signedSession = await (
      await fetch(base + "/api/session", {
        headers: { Cookie: cookie.split(";")[0] },
      })
    ).json();
    assert.equal(signedSession.user.id, authBody.user.id);
    assert.equal(signedSession.inviteRequired, false);
    assert.equal("roster" in signedSession, false);
    const logout = await fetch(base + "/api/session", { method: "DELETE" });
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(
      (
        await fetch(base + "/api/private", {
          headers: { Cookie: "proof_session=9999999999999.forged" },
        })
      ).status,
      401,
    );
    for (let i = 0; i < 10; i++)
      await fetch(base + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hackathon visitor",
          password: "incorrect-password",
        }),
      });
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Hackathon visitor",
            password: "incorrect-password",
          }),
        })
      ).status,
      429,
    );
  } finally {
    server.close();
    if (original.inviteCode === undefined) delete process.env.PROOF_INVITE_CODE;
    else process.env.PROOF_INVITE_CODE = original.inviteCode;
    if (original.hosted === undefined) delete process.env.PROOF_HOSTED;
    else process.env.PROOF_HOSTED = original.hosted;
    if (original.key === undefined) delete process.env.PROOF_ACCESS_KEY;
    else process.env.PROOF_ACCESS_KEY = original.key;
    if (original.accountsFile === undefined)
      delete process.env.PROOF_ACCOUNTS_FILE;
    else process.env.PROOF_ACCOUNTS_FILE = original.accountsFile;
  }
});
