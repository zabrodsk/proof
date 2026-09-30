import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alice,
  bob,
  fixture,
  input,
  source,
  saveSource,
  platform,
  runFixture,
  finishImports,
} from "./integrations/helpers.js";
import { reserveConnectorCall } from "../server/integrations/budgets.js";

test("MCP submissions use the shared native run, outbox, exact text and idempotency across a database restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proof-shared-"));
  let f = await fixture(dir);
  try {
    const data = input({ text: "  Original submitted text.\n\n" });
    const a = await f.store.createRun(alice, data);
    const b = await f.store.createRun(alice, data);
    assert.equal(a.id, b.id);
    assert.equal(a.receipt.input.text, data.text);
    assert.equal(
      (await f.db.query("SELECT target_id FROM job_outbox WHERE kind='run'"))
        .rows[0].target_id,
      a.id,
    );
    await assert.rejects(
      f.store.createRun(alice, {
        ...data,
        text: "Different original text to check.",
      }),
      /different input/,
    );
    await f.close();
    f = await fixture(dir);
    assert.equal((await f.service.get(alice, a.id)).textChecked, data.text);
    assert.equal((await f.store.createRun(alice, data)).id, a.id);
    assert.equal((await f.db.query("SELECT id FROM runs")).rows.length, 1);
  } finally {
    await f.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("accounts cannot read each other's shared reports, cancel jobs or select foreign library sources", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const run = await f.store.createRun(alice, input());
    await assert.rejects(f.store.getRun(bob, run.id), /unavailable/);
    await assert.rejects(f.store.cancel(bob, run.id));
    await assert.rejects(f.service.evidence(bob, run.id, crypto.randomUUID()));
    await assert.rejects(
      f.store.createRun(
        bob,
        input({
          kind: "check_sources",
          sources: [{ id: s.id, version: s.version }],
        }),
      ),
    );
    assert.equal((await f.store.searchLibrary(bob, "")).sources.length, 0);
  } finally {
    await f.close();
  }
});
test("platform access uses explicitly selected shared assets and extraction versions", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const p = await platform(f.store);
    assert.equal((await f.store.searchLibrary(p, "")).sources.length, 0);
    await assert.rejects(
      f.store.createRun(
        p,
        input({
          kind: "check_sources",
          sources: [{ id: s.id, version: s.version }],
        }),
      ),
      /unavailable/,
    );
    await f.store.selectGrantSources(alice.owner, p.grantId, [s.id]);
    assert.equal((await f.store.searchLibrary(p, "")).sources.length, 1);
    await assert.rejects(
      f.store.createRun(
        p,
        input({
          kind: "check_sources",
          sources: [{ id: s.id, version: crypto.randomUUID() }],
        }),
      ),
      /unavailable/,
    );
    await assert.rejects(
      f.store.saveGrant(
        bob.owner,
        {
          issuer: "https://auth.example",
          subject: alice.owner,
          clientId: "chatgpt-client",
          platform: "chatgpt",
          scopes: [],
        },
        [],
      ),
      /another Proof account/,
    );
  } finally {
    await f.close();
  }
});
test("unmapped chapter limits and out-of-file page ranges fail before creating a job", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    await assert.rejects(
      f.store.createRun(
        alice,
        input({
          kind: "check_sources",
          sources: [
            {
              id: s.id,
              version: s.version,
              range: { chapters: { from: 1, to: 11 } },
            },
          ],
        }),
      ),
      /Chapter ranges/,
    );
    await assert.rejects(
      f.store.createRun(
        alice,
        input({
          kind: "check_sources",
          sources: [
            {
              id: s.id,
              version: s.version,
              range: { pages: { from: 1, to: 11 } },
            },
          ],
        }),
      ),
      /exceeds/,
    );
    assert.equal((await f.db.query("SELECT id FROM runs")).rows.length, 0);
  } finally {
    await f.close();
  }
});
test("platform revocation cancels unfinished native jobs, denies platform reads, and preserves owner access", async () => {
  const f = await fixture();
  try {
    const p = await platform(f.store);
    const r = await f.store.createRun(p, input());
    await f.store.revokeGrant(alice.owner, p.grantId);
    await assert.rejects(f.store.getRun(p, r.id), /revoked/);
    assert.equal((await f.store.getRun(alice, r.id)).status, "cancelled");
    await f.store.allowReconnection(alice.owner, p.grantId);
    assert.equal((await f.store.getRun(p, r.id)).status, "cancelled");
  } finally {
    await f.close();
  }
});
test("narrowing source access hides stored reports and stops queued source checks", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const p = await platform(f.store, alice, [s.id]);
    const r = await f.store.createRun(
      p,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await f.store.selectGrantSources(alice.owner, p.grantId, []);
    await assert.rejects(f.store.getRun(p, r.id), /unavailable/);
    assert.equal((await f.store.getRun(alice, r.id)).status, "cancelled");
  } finally {
    await f.close();
  }
});
test("finished native reports remain immutable and cancelled checks cannot be restarted by an old worker", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const cancelled = await f.store.createRun(
      alice,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await f.store.cancel(alice, cancelled.id);
    let calls = 0;
    await runFixture(f, cancelled.id, async () => {
      calls++;
      throw Error("Must not run");
    });
    assert.equal(calls, 0);
    const completed = await f.store.createRun(
      alice,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await runFixture(f, completed.id);
    const before = await f.service.get(alice, completed.id);
    await f.store.cancel(alice, completed.id);
    assert.deepEqual(
      (await f.service.get(alice, completed.id)).findings,
      before.findings,
    );
  } finally {
    await f.close();
  }
});
test("deleting a native source removes its excerpts, connector receipt and report and enqueues private-file deletion", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const r = await f.store.createRun(
      alice,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await runFixture(f, r.id);
    await f.store.deleteSource(alice.owner, s.id);
    await assert.rejects(f.service.get(alice, r.id), /unavailable/);
    assert.equal(
      (
        await f.db.query(
          "SELECT id FROM proof_connector_submissions WHERE id=$1",
          [r.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM source_passages")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("SELECT id FROM deletion_jobs")).rows.length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("spending is reserved transactionally before dispatch and partial reports retain explicit exhaustion", async () => {
  const f = await fixture();
  try {
    const r = await f.store.createRun(alice, input({ budgetUsd: 0.001 }));
    await reserveConnectorCall(f.db, r.workspace_id, r.id, "jev", 1000);
    await assert.rejects(
      reserveConnectorCall(f.db, r.workspace_id, r.id, "jev", 100000),
      /exhausted/,
    );
    const report = await f.service.get(alice, r.id);
    assert.equal(report.status, "partial");
    assert.match(report.error, /exhausted/);
    assert.ok(report.reservedUsd <= 0.001);
    assert.equal(
      (
        await f.db.query(
          "SELECT calls FROM proof_connector_budgets WHERE bucket='provider:jev'",
        )
      ).rows[0].calls,
      1,
    );
  } finally {
    await f.close();
  }
});
test("duplicate concurrent submissions share one native job and rollback flag preserves reads", async () => {
  const f = await fixture();
  try {
    const data = input();
    const [a, b] = await Promise.all([
      f.store.createRun(alice, data),
      f.store.createRun(alice, data),
    ]);
    assert.equal(a.id, b.id);
    await assert.rejects(
      f.store.createRun(bob, input(), false),
      /temporarily disabled/,
    );
    assert.equal((await f.store.getRun(alice, a.id)).id, a.id);
  } finally {
    await f.close();
  }
});
test("both platform grants read the same completed native report without a second assessment", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const chatgpt = await platform(f.store, alice, [s.id]);
    const claude = await platform(f.store, alice, [s.id], "claude-client");
    const r = await f.store.createRun(
      chatgpt,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await runFixture(f, r.id);
    assert.deepEqual(
      (await f.service.get(chatgpt, r.id)).findings,
      (await f.service.get(claude, r.id)).findings,
    );
    assert.equal(
      (await f.db.query("SELECT id FROM assessments")).rows.length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("explicit imports use the native source library and outbox, retain bibliography gaps and are idempotent", async () => {
  const f = await fixture();
  try {
    const p = await platform(f.store);
    const data = {
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          kind: "text" as const,
          title: "Original book",
          text: "A private original book passage with enough readable text.",
        },
        {
          kind: "bibliography" as const,
          title: "Works cited",
          text: "Author A. A book without a DOI. 2001.",
        },
      ],
    };
    const job = await f.service.import(p, data);
    assert.equal((await f.service.import(p, data)).id, job.id);
    await finishImports(f, job.id);
    const status = await f.store.getImport(p, job.id);
    assert.equal(status.status, "complete");
    assert.ok(
      !JSON.stringify(status).includes("private original book passage"),
    );
    assert.equal((await f.store.searchLibrary(p, "")).sources.length, 1);
    assert.equal(status.result.notices.length, 1);
    await assert.rejects(f.store.getImport(bob, job.id), /unavailable/);
  } finally {
    await f.close();
  }
});
test("original evidence and citation semantics come from the shared stored finding, never a fabricated passage", async () => {
  const f = await fixture();
  try {
    const s = await saveSource(f.store, source());
    const r = await f.store.createRun(
      alice,
      input({
        kind: "check_sources",
        sources: [{ id: s.id, version: s.version }],
      }),
    );
    await runFixture(f, r.id);
    const page = await f.service.get(alice, r.id);
    assert.equal(page.status, "complete");
    assert.equal(page.findings[0].support, "supported");
    assert.ok(
      ["missing", "not_checked"].includes(page.findings[0].citationCorrectness),
    );
    const original = await f.service.evidence(
      alice,
      r.id,
      page.findings[0].evidenceIds[0],
    );
    assert.equal(original.text, s.text);
    assert.equal(original.locator.page, undefined);
    await assert.rejects(
      f.service.evidence(alice, r.id, crypto.randomUUID()),
      /unavailable/,
    );
  } finally {
    await f.close();
  }
});
