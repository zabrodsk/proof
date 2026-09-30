import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { discoverSources } from "../server/discovery.js";
import { withUsage, recordJevUsage } from "../server/usage.js";
import { allSentences } from "../server/classroom.js";
test("discovery rejects search failures instead of inventing sources", async () => {
  const stub = mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 503 }),
  );
  try {
    await assert.rejects(
      () => discoverSources("Exercise can improve mood."),
      /503/,
    );
  } finally {
    stub.mock.restore();
  }
});
test("empty scholarly search remains explicit and has no supporting candidates", async () => {
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json({ message: { items: [] } }),
  );
  try {
    const r = await discoverSources("A claim without available papers.");
    assert.equal(r.candidates.length, 0);
    assert.ok(r.notices.some((n) => n.includes("No usable")));
  } finally {
    stub.mock.restore();
  }
});
test("parallel review usage is isolated between five users", async () => {
  const runs = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      withUsage(async () => {
        recordJevUsage({ input_tokens: n * 1000, output_tokens: 10 });
        await Promise.resolve();
        recordJevUsage({ input_tokens: n * 1000, output_tokens: 20 });
        return n;
      }),
    ),
  );
  for (const run of runs) {
    assert.equal(run.usage.inputTokens, run.result * 2000);
    assert.equal(run.usage.requests, 2);
    assert.equal(run.usage.unmeteredRequests, 0);
  }
});
test("long text segmentation preserves every occurrence through the final sentence", () => {
  const sentence =
    "This sentence contains a factual claim that needs an exact source and a page number.";
  const text = Array.from({ length: 1000 }, () => sentence).join("\n\n");
  const result = allSentences(text);
  assert.equal(result.length, 1000);
  assert.equal(result.at(-1)?.end, text.length);
  assert.equal(new Set(result.map((s) => s.id)).size, 1000);
});
