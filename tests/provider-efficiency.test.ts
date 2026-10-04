import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  providerContext,
  providerFetch,
  exaSearch,
} from "../server/backend/providers.js";
import type { Database } from "../server/backend/db.js";
function fixture(
  failAccounting = false,
  options: { maxCalls?: number; workspace?: string } = {},
) {
  let reservations = 0;
  const calls: Array<{ provider: string; operation: string }> = [];
  const db: Database = {
    async query(sql, params = []) {
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
        calls.push({ provider: params[3], operation: params[4] });
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
    calls,
    run: <T>(fn: () => Promise<T>) =>
      providerContext.run(
        {
          db,
          ws: options.workspace || "test",
          run: "test",
          signal: controller.signal,
          maxCalls: options.maxCalls ?? 10,
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
test("each followed redirect is reserved and attributed to its actual provider", async () => {
  const f = fixture();
  const dispatched: string[] = [];
  const stub = mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      dispatched.push(String(input));
      if (dispatched.length === 1)
        return new Response(null, {
          status: 302,
          headers: { Location: "https://api.openalex.org/works/W1" },
        });
      return Response.json({ ok: true });
    },
  );
  try {
    const response = await f.run(() =>
      providerFetch("https://api.exa.ai/redirect"),
    );
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(dispatched, [
      "https://api.exa.ai/redirect",
      "https://api.openalex.org/works/W1",
    ]);
    assert.equal(f.reservations, 2);
    assert.deepEqual(f.calls, [
      { provider: "exa", operation: "/redirect" },
      { provider: "openalex", operation: "/works/W1" },
    ]);
  } finally {
    stub.mock.restore();
  }
});
test("cross-origin redirects strip credentials and apply fetch POST rewrite rules", async () => {
  const f = fixture();
  const requests: Array<{ method: string; authorization: string | null }> = [];
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, options: RequestInit = {}) => {
      const headers = new Headers(options.headers);
      requests.push({
        method: options.method || "GET",
        authorization: headers.get("authorization"),
      });
      return requests.length === 1
        ? new Response(null, {
            status: 303,
            headers: { Location: "https://api.openalex.org/result" },
          })
        : Response.json({ ok: true });
    },
  );
  try {
    await f.run(() =>
      providerFetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          Authorization: "Bearer private",
          "Content-Type": "application/json",
        },
        body: '{"query":"example"}',
      }),
    );
    assert.deepEqual(requests, [
      { method: "POST", authorization: "Bearer private" },
      { method: "GET", authorization: null },
    ]);
  } finally {
    stub.mock.restore();
  }
});

test("public search uses the web while academic search stays publication-scoped", async () => {
  const f = fixture();
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture";
  const bodies: any[] = [];
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_input: any, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ results: [] });
    },
  );
  try {
    await f.run(async () => {
      await exaSearch("Paris is the capital of France", 4, { scope: "public" });
      await exaSearch("Paris is the capital of France", 4, {
        scope: "academic",
      });
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].category, undefined);
    assert.equal(bodies[0].includeDomains, undefined);
    assert.equal(bodies[1].category, "publication");
  } finally {
    stub.mock.restore();
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});
test("six concurrent equivalent scoped searches make one paid request and return isolated results", async () => {
  const f = fixture();
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture";
  let calls = 0;
  const stub = mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json({
      results: [{ title: "Source", url: "https://example.com/source" }],
    });
  });
  try {
    const results = await f.run(() =>
      Promise.all(
        Array.from({ length: 6 }, () =>
          exaSearch("Same scoped query", 4, { scope: "public" }),
        ),
      ),
    );
    assert.equal(calls, 1, "baseline 6 duplicate requests is reduced to 1");
    assert.equal(f.reservations, 1);
    results[0][0].title = "Caller-specific title";
    assert.equal(results[1][0].title, "Source");
    await fixture(false, { workspace: "another-workspace" }).run(() =>
      exaSearch("Same scoped query", 4, { scope: "public" }),
    );
    assert.equal(calls, 2, "another workspace cannot reuse this run's request");
  } finally {
    stub.mock.restore();
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});
test("cross-origin redirects also strip provider API keys and preserve a 303 HEAD", async () => {
  const f = fixture();
  const requests: {
    method: string;
    key: string | null;
    cookie: string | null;
  }[] = [];
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_input: any, options: RequestInit) => {
      const headers = new Headers(options.headers);
      requests.push({
        method: options.method || "GET",
        key: headers.get("x-api-key"),
        cookie: headers.get("cookie"),
      });
      return requests.length === 1
        ? new Response(null, {
            status: 303,
            headers: { Location: "https://api.openalex.org/result" },
          })
        : new Response(null);
    },
  );
  try {
    await f.run(() =>
      providerFetch("https://api.exa.ai/search", {
        method: "HEAD",
        headers: { "x-api-key": "private", Cookie: "private=1" },
      }),
    );
    assert.deepEqual(requests, [
      { method: "HEAD", key: "private", cookie: "private=1" },
      { method: "HEAD", key: null, cookie: null },
    ]);
  } finally {
    stub.mock.restore();
  }
});
test("a 307 preserves replayable POST data and same-origin authentication", async () => {
  const f = fixture();
  const requests: RequestInit[] = [];
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_input: any, options: RequestInit) => {
      requests.push(options);
      return requests.length === 1
        ? new Response(null, { status: 307, headers: { Location: "/final" } })
        : Response.json({ ok: true });
    },
  );
  try {
    await f.run(() =>
      providerFetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": "private" },
        body: "same-body",
      }),
    );
    assert.equal(requests[1].method, "POST");
    assert.equal(requests[1].body, "same-body");
    assert.equal(new Headers(requests[1].headers).get("x-api-key"), "private");
  } finally {
    stub.mock.restore();
  }
});
test("a redirect cannot spend beyond the physical request cap", async () => {
  const f = fixture(false, { maxCalls: 1 });
  const stub = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://api.openalex.org/result" },
      }),
  );
  try {
    await assert.rejects(
      f.run(() => providerFetch("https://api.exa.ai/search")),
      /budget exhausted/,
    );
    assert.equal(stub.mock.callCount(), 1);
    assert.equal(f.reservations, 1);
  } finally {
    stub.mock.restore();
  }
});
for (const location of [
  "http://api.openalex.org/result",
  "https://user:password@api.openalex.org/result",
])
  test(`unsafe redirect ${location.split(":")[0]} is rejected before another dispatch`, async () => {
    const f = fixture();
    const stub = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(null, { status: 302, headers: { Location: location } }),
    );
    try {
      await assert.rejects(
        f.run(() => providerFetch("https://api.exa.ai/search")),
        /HTTPS URL without credentials/,
      );
      assert.equal(stub.mock.callCount(), 1);
    } finally {
      stub.mock.restore();
    }
  });
test("manual redirect requests return the first response without following", async () => {
  const f = fixture();
  const stub = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, { status: 302, headers: { Location: "/final" } }),
  );
  try {
    assert.equal(
      (
        await f.run(() =>
          providerFetch("https://api.exa.ai/search", { redirect: "manual" }),
        )
      ).status,
      302,
    );
    assert.equal(f.reservations, 1);
  } finally {
    stub.mock.restore();
  }
});
test("provider concurrency is bounded and queued cancelled requests never reserve", async () => {
  const f = fixture();
  let active = 0,
    peak = 0;
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_input: any, options: RequestInit) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((_resolve, reject) =>
          options.signal!.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
        return Response.json({ ok: true });
      } finally {
        active--;
      }
    },
  );
  try {
    const pending = f.run(() =>
      Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          providerFetch(`https://api.exa.ai/request-${index}`),
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(peak, 4);
    assert.equal(f.reservations, 4);
    f.controller.abort();
    const results = await pending;
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(f.reservations, 4);
    assert.equal(stub.mock.callCount(), 4);
  } finally {
    stub.mock.restore();
  }
});

test("a long Retry-After stops this attempt instead of retrying early", async () => {
  const f = fixture();
  const stub = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, { status: 429, headers: { "Retry-After": "300" } }),
  );
  try {
    assert.equal(
      (await f.run(() => providerFetch("https://api.exa.ai/search"))).status,
      429,
    );
    assert.equal(stub.mock.callCount(), 1);
    assert.equal(f.reservations, 1);
  } finally {
    stub.mock.restore();
  }
});
test("provider attribution uses the actual provider hostname boundary", async () => {
  const f = fixture();
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: true }),
  );
  try {
    await f.run(() => providerFetch("https://api.exa.ai.other.example/works"));
    assert.deepEqual(f.calls, [{ provider: "scholarly", operation: "/works" }]);
  } finally {
    stub.mock.restore();
  }
});

for (const status of [307, 308])
  test(`cross-origin ${status} cannot forward a document body to another provider`, async () => {
    const f = fixture();
    const stub = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(null, {
          status,
          headers: { Location: "https://api.openalex.org/collect" },
        }),
    );
    try {
      await assert.rejects(
        f.run(() =>
          providerFetch("https://api.typesafe.ai/v1/systemone", {
            method: "POST",
            body: "controlled private document payload",
            headers: { Authorization: "Bearer fixture" },
          }),
        ),
        /cannot forward a request body/,
      );
      assert.equal(stub.mock.callCount(), 1);
      assert.equal(f.reservations, 1);
    } finally {
      stub.mock.restore();
    }
  });
