import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { installAccess } from "../server/access.js";
import { classroomRouter } from "../server/classroom.js";
test("five browser sessions can review concurrently without reading each other’s results", async () => {
  process.env.PROOF_HOSTED = "true";
  process.env.PROOF_ACCESS_KEY = "session-test-key-at-least-24-characters";
  process.env.TYPESAFE_API_KEY = "fixture-key";
  process.env.PROOF_ACCOUNTS_FILE = join(
    mkdtempSync(join(tmpdir(), "proof-accounts-")),
    "accounts.json",
  );
  const app = express();
  app.use(express.json());
  installAccess(app);
  app.use("/api/class", classroomRouter());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const original = globalThis.fetch;
  const release: (() => void)[] = [];
  let block = true;
  let fail = false;
  const stub = mock.method(
    globalThis,
    "fetch",
    async (input: any, init?: RequestInit) => {
      if (String(input).startsWith("https://api.typesafe.ai/")) {
        const payload = JSON.parse(String(init?.body));
        if (fail) return new Response("Unavailable", { status: 503 });
        if (block) await new Promise<void>((resolve) => release.push(resolve));
        const answers = Object.fromEntries(
          Object.entries(payload.questions).map(([key, q]: [string, any]) => {
            const keys = Object.keys(q.criteria);
            const choice = keys.includes("clear") ? "clear" : keys[0];
            return [
              key,
              {
                type: "choice",
                choice,
                confidence: 0.95,
                probabilities: Object.fromEntries(
                  keys.map((k) => [
                    k,
                    k === choice ? 0.95 : 0.05 / (keys.length - 1),
                  ]),
                ),
              },
            ];
          }),
        );
        return Response.json({
          answers,
          usage: { input_tokens: 100, output_tokens: 10 },
          model: "test",
        });
      }
      return original(input, init);
    },
  );
  try {
    const cookies: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await original(base + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Public visitor ${i + 1}`,
          password: "test-password-only",
          register: true,
        }),
      });
      cookies.push(r.headers.get("set-cookie")!.split(";")[0]);
    }
    const start = (i: number) =>
      original(base + "/api/class/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies[i] },
        body: JSON.stringify({
          text: "This is an original sentence for review.",
          assignment: "draft",
          papers: [],
        }),
      });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await start(i);
      assert.equal(r.status, 202);
      ids.push((await r.json()).id);
    }
    assert.equal((await start(5)).status, 429);
    assert.equal((await start(0)).status, 429);
    assert.equal(
      (
        await original(base + `/api/class/reviews/${ids[0]}`, {
          headers: { Cookie: cookies[1] },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await original(base + `/api/class/reviews/${ids[0]}`, {
          headers: { Cookie: cookies[0] },
        })
      ).status,
      200,
    );
    release.forEach((resolve) => resolve());
    for (const [i, id] of ids.entries()) {
      let result: any;
      for (let attempts = 0; attempts < 20; attempts++) {
        result = await (
          await original(base + `/api/class/reviews/${id}`, {
            headers: { Cookie: cookies[i] },
          })
        ).json();
        if (result.status === "complete") break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(result.status, "complete");
      assert.equal(result.report.coverage.completed, 1);
      assert.equal(result.report.usage.inputTokens, 100);
    }
    block = false;
    fail = true;
    const failedStart = await start(0);
    const failedId = (await failedStart.json()).id;
    async function settled() {
      for (let i = 0; i < 40; i++) {
        const job = await (
          await original(base + `/api/class/reviews/${failedId}`, {
            headers: { Cookie: cookies[0] },
          })
        ).json();
        if (job.status !== "running") return job;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("Review did not settle");
    }
    assert.equal((await settled()).report.coverage.completed, 0);
    fail = false;
    assert.equal(
      (
        await original(base + `/api/class/reviews/${failedId}/retry`, {
          method: "POST",
          headers: { Cookie: cookies[1] },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await original(base + `/api/class/reviews/${failedId}/retry`, {
          method: "POST",
          headers: { Cookie: cookies[0] },
        })
      ).status,
      202,
    );
    const recovered = await settled();
    assert.equal(recovered.report.coverage.completed, 1);
    assert.equal(recovered.report.reviewId, failedId);
    assert.equal(recovered.report.usage.inputTokens, 100);
  } finally {
    release.forEach((resolve) => resolve());
    stub.mock.restore();
    server.close();
    delete process.env.PROOF_HOSTED;
    delete process.env.PROOF_ACCESS_KEY;
    delete process.env.TYPESAFE_API_KEY;
  }
});
