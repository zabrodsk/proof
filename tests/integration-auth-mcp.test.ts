import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthVerifier,
  type OAuthConfig,
} from "../server/integrations/auth.js";
import { mcpRouter } from "../server/integrations/mcp.js";
import {
  integrationApi,
  integrationErrors,
} from "../server/integrations/http.js";
import {
  alice,
  bob,
  fixture,
  platform,
  input,
  source,
  saveSource,
  runFixture,
} from "./integrations/helpers.js";
const config: OAuthConfig = {
  issuer: "https://auth.example",
  resource: "https://proof.example/mcp",
  jwksUrl: "https://auth.example/jwks",
  clients: { "chatgpt-client": "chatgpt", "claude-client": "claude" },
  autoGrant: false,
};
async function signing() {
  const key = await generateKeyPair("RS256");
  const token = (
    claims: Record<string, unknown> = {},
    iss = config.issuer,
    aud = config.resource,
    expiry: string | number = "5m",
  ) =>
    new SignJWT({
      scope: alice.scopes.join(" "),
      client_id: "chatgpt-client",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(alice.owner)
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(key.privateKey);
  return { key, token };
}

test("OAuth validates signatures, issuer, audience, expiry, scopes and configured platform identity", async () => {
  const f = await fixture();
  try {
    await platform(f.store);
    const { key, token } = await signing();
    const verifier = new OAuthVerifier(
      config,
      f.store,
      async () => key.publicKey,
    );
    assert.equal((await verifier.verify(await token())).owner, alice.owner);
    await assert.rejects(
      verifier.verify(await token({}, "https://wrong-issuer.example")),
    );
    await assert.rejects(
      verifier.verify(await token({}, config.issuer, "wrong-audience")),
    );
    await assert.rejects(
      verifier.verify(
        await token(
          {},
          config.issuer,
          config.resource,
          Math.floor(Date.now() / 1000) - 60,
        ),
      ),
    );
    await assert.rejects(
      verifier.verify(await token({ client_id: "unknown-client" })),
    );
    await assert.rejects(verifier.verify(await token({ scope: undefined })));
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({
      scope: "reports:read",
      client_id: "chatgpt-client",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(alice.owner)
      .setIssuer(config.issuer)
      .setAudience(config.resource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await assert.rejects(verifier.verify(forged));
    const readOnly = await verifier.verify(
      await token({ scope: "reports:read" }),
    );
    await assert.rejects(f.store.createRun(readOnly, input()), /checks:run/);
    await f.store.revokeGrant(
      alice.owner,
      (await verifier.verify(await token())).grantId!,
    );
    await assert.rejects(
      verifier.verify(await token()),
      /Connect this platform/,
    );
  } finally {
    await f.close();
  }
});

test("upstream introspection rejects a signed token whose OAuth grant was revoked", async () => {
  const f = await fixture();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  let active = true,
    requests = 0;
  app.post("/introspection", (req, res) => {
    requests++;
    assert.ok(req.body.token);
    res.json({ active, scope: "reports:read" });
  });
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address() as { port: number };
  try {
    await platform(f.store);
    const { key, token } = await signing();
    const verifier = new OAuthVerifier(
      {
        ...config,
        introspectionUrl: `http://127.0.0.1:${address.port}/introspection`,
      },
      f.store,
      async () => key.publicKey,
    );
    const access = await token();
    const confirmed = await verifier.verify(access);
    assert.equal(confirmed.owner, alice.owner);
    assert.deepEqual(confirmed.scopes, ["reports:read"]);
    active = false;
    await assert.rejects(verifier.verify(access), /revoked/);
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((r) => listener.close(() => r()));
    await f.close();
  }
});

test("first platform grants require a matching existing account, and explicit revocation requires browser approval to reconnect", async () => {
  const f = await fixture();
  try {
    const { key, token } = await signing();
    const verifier = new OAuthVerifier(
      { ...config, autoGrant: true },
      f.store,
      async () => key.publicKey,
      (id) => id === alice.owner,
    );
    const access = await token();
    const p = await verifier.verify(access);
    assert.equal((await f.store.searchLibrary(p, "")).sources.length, 0);
    await f.store.revokeGrant(alice.owner, p.grantId!);
    await assert.rejects(verifier.verify(access), /Connect this platform/);
    await f.store.allowReconnection(alice.owner, p.grantId!);
    assert.equal((await verifier.verify(access)).grantId, p.grantId);
    const wrong = new OAuthVerifier(
      { ...config, autoGrant: true },
      f.store,
      async () => key.publicKey,
      () => false,
    );
    await assert.rejects(
      wrong.verify(await token({ client_id: "claude-client" })),
      /Connect this platform/,
    );
  } finally {
    await f.close();
  }
});

test("real Streamable HTTP clients round-trip exact input, stored findings and original evidence across two host grants", async () => {
  const f = await fixture();
  const { key, token } = await signing();
  const p = await platform(f.store);
  const claudePrincipal = await platform(f.store, alice, [], "claude-client");
  const s = source();
  await saveSource(f.store, s);
  await f.store.selectGrantSources(alice.owner, claudePrincipal.grantId, [
    s.id,
  ]);
  await f.store.selectGrantSources(alice.owner, p.grantId, [s.id]);
  const app = express();
  app.use(express.json());
  const verifier = new OAuthVerifier(
    config,
    f.store,
    async () => key.publicKey,
  );
  app.use(mcpRouter(f.service, verifier));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
  const clients: Client[] = [];
  try {
    const metadata = await fetch(
      `${base}/.well-known/oauth-protected-resource/mcp`,
    );
    assert.equal((await metadata.json()).resource, config.resource);
    const unauth = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("WWW-Authenticate")!, /resource_metadata/);
    async function connect(clientId: string) {
      const client = new Client({ name: clientId, version: "1" });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${await token({ client_id: clientId })}`,
            },
          },
        }),
      );
      return client;
    }
    const chatgpt = await connect("chatgpt-client");
    const list = await chatgpt.listTools();
    assert.equal(list.tools.length, 8);
    assert.equal(
      list.tools.find((t) => t.name === "check_facts")?.annotations
        ?.readOnlyHint,
      false,
    );
    assert.equal(
      list.tools.find((t) => t.name === "get_check")?.annotations?.readOnlyHint,
      true,
    );
    assert.equal(
      list.tools.find((t) => t.name === "cancel_check")?.annotations
        ?.destructiveHint,
      true,
    );
    const text = "  The study included 120 adults.\n";
    const started = await chatgpt.callTool({
      name: "check_sources",
      arguments: {
        text,
        sources: [{ id: s.id, version: s.version }],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    assert.equal(started.isError, undefined);
    const submitted = started.structuredContent as {
      id: string;
      textChecked: string;
    };
    assert.equal(submitted.textChecked, text);
    await chatgpt.close(); // A dropped host connection does not own or delete the durable job.
    await runFixture(f, submitted.id);
    const claude = await connect("claude-client");
    const read = await claude.callTool({
      name: "get_check",
      arguments: { id: submitted.id },
    });
    const report = read.structuredContent as any;
    assert.equal(report.status, "complete");
    assert.equal(report.textChecked, text);
    assert.equal(report.findings[0].support, "supported");
    const original = await claude.callTool({
      name: "get_evidence",
      arguments: {
        id: submitted.id,
        evidenceId: report.findings[0].evidenceIds[0],
      },
    });
    assert.equal((original.structuredContent as any).text, s.text);
    const fabricated = await claude.callTool({
      name: "get_evidence",
      arguments: { id: submitted.id, evidenceId: crypto.randomUUID() },
    });
    assert.equal(fabricated.isError, true);
    const invalid = await claude.callTool({
      name: "check_facts",
      arguments: { text: "check that", idempotencyKey: crypto.randomUUID() },
    });
    assert.equal(invalid.isError, true);
    const wrongOwner = await claude.callTool({
      name: "get_check",
      arguments: { id: submitted.id, owner: "someone-else" },
    });
    assert.equal(wrongOwner.isError, true);
  } finally {
    for (const c of clients) await c.close();
    await new Promise<void>((r) => listener.close(() => r()));
    await f.close();
  }
});

test("website API and MCP share the same application service and enforce authenticated report access", async () => {
  const f = await fixture();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.proofSession = req.headers["x-test-owner"];
    next();
  });
  app.use("/api/integrations", integrationApi(f.service));
  integrationErrors(app);
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}/api/integrations`;
  try {
    const denied = await fetch(`${base}/library`);
    assert.equal(denied.status, 401);
    const submitted = await fetch(`${base}/checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-owner": alice.owner,
      },
      body: JSON.stringify(input()),
    });
    assert.equal(submitted.status, 202);
    const r = await submitted.json();
    assert.equal((await f.store.getRun(alice, r.id)).id, r.id);
    const foreign = await fetch(`${base}/checks/${r.id}`, {
      headers: { "x-test-owner": bob.owner },
    });
    assert.equal(foreign.status, 404);
    const mine = await fetch(`${base}/checks/${r.id}`, {
      headers: { "x-test-owner": alice.owner },
    });
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get("Cache-Control"), "no-store");
  } finally {
    await new Promise<void>((r) => listener.close(() => r()));
    await f.close();
  }
});
