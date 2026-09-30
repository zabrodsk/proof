import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, alice, input } from "./integrations/helpers.js";
import { providerContext, providerFetch } from "../server/backend/providers.js";

test("shared provider adapter reserves before dispatch and blocks a request that exceeds the connector cap", async () => {
  const f = await fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ usage: { input_tokens: 100 } }), {
      status: 200,
    });
  };
  try {
    const r = await f.store.createRun(alice, input({ budgetUsd: 0.001 }));
    const controller = new AbortController();
    await providerContext.run(
      {
        db: f.db,
        ws: r.workspace_id,
        run: r.id,
        signal: controller.signal,
        maxCalls: 50,
        model: r.config.model,
      },
      async () => {
        await providerFetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          body: "a".repeat(1000),
        });
        await assert.rejects(
          providerFetch("https://api.typesafe.ai/v1/systemone", {
            method: "POST",
            body: "a".repeat(100000),
          }),
          /exhausted/,
        );
      },
    );
    assert.equal(calls, 1);
    assert.equal((await f.service.get(alice, r.id)).status, "partial");
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
