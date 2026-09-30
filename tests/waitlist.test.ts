import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  createWaitlistRouter,
  createWaitlistStore,
} from "../server/waitlist.js";

async function setup(options: { limit?: number; windowMs?: number } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-waitlist-"));
  const file = path.join(directory, "signups.json");
  const app = express();
  app.use(express.json());
  app.use("/api/waitlist", createWaitlistRouter({ file, ...options }));
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
        error ? reject(error) : resolve(listener),
      );
    },
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/waitlist`;
  return {
    file,
    post: (data: unknown) =>
      fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("waitlist saves normalized emails with consent, deduplicates, and persists across store instances", async () => {
  const context = await setup();
  try {
    for (const email of [" Reader@Example.com ", "reader@example.com"]) {
      const result = await context.post({
        email,
        consent: true,
        source: "footer",
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { ok: true });
    }
    const storeAfterRestart = createWaitlistStore(context.file);
    await storeAfterRestart.add("reader@example.com", "hero");
    await storeAfterRestart.add("another@example.com", "hero");
    const entries = JSON.parse(await readFile(context.file, "utf8"));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].email, "reader@example.com");
    assert.equal(entries[0].source, "footer");
    assert.equal(entries[0].consent, "early-access-v1");
    assert.ok(!Number.isNaN(Date.parse(entries[0].joinedAt)));
    assert.equal((await stat(context.file)).mode & 0o777, 0o600);
  } finally {
    await context.close();
  }
});

test("invalid requests and honeypots do not create waitlist entries", async () => {
  const context = await setup();
  try {
    for (const body of [
      { email: "not-an-email", consent: true },
      { email: "reader@example.com" },
      { email: "reader@example.com", consent: false },
      { email: "reader@example.com", consent: true, source: "unknown" },
    ])
      assert.equal((await context.post(body)).status, 400);
    assert.equal(
      (
        await context.post({
          email: "bot@example.com",
          consent: true,
          website: "spam",
        })
      ).status,
      200,
    );
    await assert.rejects(readFile(context.file), { code: "ENOENT" });
  } finally {
    await context.close();
  }
});

test("concurrent signups keep every unique email", async () => {
  const context = await setup({ limit: 30 });
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        context.post({
          email: `reader${index % 10}@example.com`,
          consent: true,
        }),
      ),
    );
    assert.ok(results.every((result) => result.status === 200));
    const entries = JSON.parse(await readFile(context.file, "utf8"));
    assert.equal(entries.length, 10);
    assert.equal(
      new Set(entries.map((entry: { email: string }) => entry.email)).size,
      10,
    );
  } finally {
    await context.close();
  }
});

test("rate-limited requests are rejected without saving", async () => {
  const context = await setup({ limit: 2 });
  try {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await context.post({ email: `reader${i}@example.com`, consent: true }))
          .status,
        200,
      );
    const limited = await context.post({
      email: "limited@example.com",
      consent: true,
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    assert.equal(JSON.parse(await readFile(context.file, "utf8")).length, 2);
  } finally {
    await context.close();
  }
});

test("storage failure returns an error and preserves the existing file", async () => {
  const context = await setup();
  try {
    await writeFile(context.file, "invalid existing file");
    assert.equal(
      (await context.post({ email: "reader@example.com", consent: true }))
        .status,
      503,
    );
    assert.equal(await readFile(context.file, "utf8"), "invalid existing file");
    await rm(context.file);
    assert.equal(
      (await context.post({ email: "reader@example.com", consent: true }))
        .status,
      200,
    );
  } finally {
    await context.close();
  }
});
