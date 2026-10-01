import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { integrationApi } from "../server/integrations/http.js";

test("connection configuration exposes registered public client IDs only to signed-in owners", async () => {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers["x-fixture-owner"])
      res.locals.proofSession = "fixture-owner";
    next();
  });
  app.use(
    integrationApi(
      {} as any,
      {
        config: {
          resource: "https://proof.example/mcp",
          clients: { "client-chatgpt": "chatgpt", "client-claude": "claude" },
          introspectionClientSecret: "never-expose-this",
        },
      } as any,
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/configuration`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, {
      headers: { "x-fixture-owner": "yes" },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    const config = await response.json();
    assert.deepEqual(config.platforms, ["chatgpt", "claude"]);
    assert.deepEqual(config.oauthClientIds, {
      chatgpt: "client-chatgpt",
      claude: "client-claude",
    });
    assert.equal(JSON.stringify(config).includes("never-expose-this"), false);
  } finally {
    server.close();
  }
});
