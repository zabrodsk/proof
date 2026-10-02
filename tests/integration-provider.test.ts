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

test("native call-cap rejection does not consume a connector spending reservation", async () => {
  const f = await fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  try {
    const run = await f.store.createRun(alice, input({ budgetUsd: 0.1 }));
    await providerContext.run(
      {
        db: f.db,
        ws: run.workspace_id,
        run: run.id,
        signal: new AbortController().signal,
        maxCalls: 0,
        model: run.config.model,
      },
      async () =>
        assert.rejects(
          providerFetch("https://api.exa.ai/search"),
          /provider-call budget exhausted/,
        ),
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await f.db.query(
          "SELECT reserved_usd FROM proof_connector_submissions WHERE id=$1",
          [run.id],
        )
      ).rows[0].reserved_usd,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM provider_calls WHERE run_id=$1",
          [run.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
