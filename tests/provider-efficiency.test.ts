import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { providerContext, providerFetch } from "../server/backend/providers.js";
import type { Database } from "../server/backend/db.js";
function fixture(failAccounting = false) {
  let reservations = 0;
  const db: Database = {
    async query(sql) {
      if (sql.startsWith("SELECT * FROM proof_connector_submissions"))
        return { rows: [] };
      if (sql.startsWith("SELECT cancel_requested,input"))
        return {
          rows: [
            {
              cancel_requested: false,
              input: { mode: "fact_check", allowProviderProcessing: true },
            },
          ],
        };
      if (sql.startsWith("SELECT count(*)"))
        return { rows: [{ n: reservations }] };
      if (sql.startsWith("INSERT INTO provider_calls")) {
        reservations++;
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE provider_calls")) {
        if (failAccounting) throw Error("Synthetic ledger failure");
        return { rows: [] };
      }
      throw Error("Unexpected fixture query");
    },
    transaction: async (fn) => fn(db),
    close: async () => {},
  };
  const controller = new AbortController();
  return {
    controller,
    get reservations() {
      return reservations;
    },
    run: <T>(fn: () => Promise<T>) =>
      providerContext.run(
        {
          db,
          ws: "test",
          run: "test",
          signal: controller.signal,
          maxCalls: 10,
          model: "fixture",
        },
        fn,
      ),
  };
}
test("an accounting failure cannot resend a successful paid request", async () => {
  const f = fixture(true);
  let calls = 0;
  const stub = mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ ok: true });
  });
  try {
    const response = await f.run(() =>
      providerFetch("https://api.exa.ai/search"),
    );
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls, 1);
    assert.equal(f.reservations, 1);
  } finally {
    stub.mock.restore();
  }
});
test("an expired caller deadline reserves and dispatches no retry", async () => {
  const f = fixture();
  const stub = mock.method(globalThis, "fetch", async () => {
    throw Error("Must not dispatch");
  });
  const caller = new AbortController();
  caller.abort();
  try {
    await assert.rejects(
      f.run(() =>
        providerFetch("https://api.exa.ai/search", { signal: caller.signal }),
      ),
    );
    assert.equal(stub.mock.callCount(), 0);
    assert.equal(f.reservations, 0);
  } finally {
    stub.mock.restore();
  }
});
test("a throttled call retries once, records both attempts and honors Retry-After", async () => {
  const f = fixture();
  let calls = 0;
  const stub = mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response("", { status: 429, headers: { "Retry-After": "0.3" } })
      : Response.json({ ok: true }),
  );
  const start = Date.now();
  try {
    assert.equal(
      (await f.run(() => providerFetch("https://api.exa.ai/search"))).status,
      200,
    );
    assert.equal(calls, 2);
    assert.equal(f.reservations, 2);
    assert.ok(Date.now() - start >= 280);
  } finally {
    stub.mock.restore();
  }
});
test("cancellation during throttle backoff prevents another request", async () => {
  const f = fixture();
  let calls = 0;
  const stub = mock.method(globalThis, "fetch", async () => {
    calls++;
    setTimeout(() => f.controller.abort(), 20);
    return new Response("", { status: 429, headers: { "Retry-After": "5" } });
  });
  try {
    await assert.rejects(
      f.run(() => providerFetch("https://api.exa.ai/search")),
    );
    assert.equal(calls, 1);
    assert.equal(f.reservations, 1);
  } finally {
    stub.mock.restore();
  }
});
