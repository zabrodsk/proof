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
  };
  process.env.PROOF_HOSTED = "true";
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
    const badCode = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Adam",
        password: "test-password-only",
        register: true,
        key: "autofilled-password",
      }),
    });
    assert.equal(badCode.status, 401);
    assert.match((await badCode.json()).error, /join code is incorrect/);

    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: `  ${process.env.PROOF_ACCESS_KEY}\n`,
        name: "Adam",
        password: "test-password-only",
        register: true,
      }),
    });
    assert.equal(login.status, 200);
    const authBody = await login.json();
    const claim = (name: string, password = "replacement-password") =>
      fetch(base + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          password,
          key: process.env.PROOF_ACCESS_KEY,
          register: true,
        }),
      });
    assert.equal((await claim("Adam")).status, 409);
    assert.equal((await claim("Not in class")).status, 400);
    const names = await (await fetch(base + "/api/session")).json();
    assert.equal(names.roster.length, 21);
    assert.equal(
      names.roster.find((p: any) => p.name === "Adam").claimed,
      true,
    );
    const relogin = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Adam", password: "test-password-only" }),
    });
    assert.equal((await relogin.json()).user.id, authBody.user.id);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.equal(
      (
        await fetch(base + "/api/private", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
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
          name: "Adam",
          password: "incorrect-password",
        }),
      });
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Adam",
            password: "incorrect-password",
          }),
        })
      ).status,
      429,
    );
  } finally {
    server.close();
    if (original.hosted === undefined) delete process.env.PROOF_HOSTED;
    else process.env.PROOF_HOSTED = original.hosted;
    if (original.key === undefined) delete process.env.PROOF_ACCESS_KEY;
    else process.env.PROOF_ACCESS_KEY = original.key;
  }
});
