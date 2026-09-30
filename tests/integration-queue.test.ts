import test from "node:test";
import assert from "node:assert/strict";
import { fixture, alice, input } from "./integrations/helpers.js";
import { createQueue, drainOutbox } from "../server/backend/queue.js";
test("the shared outbox hands a connector run to the native durable queue exactly once", async () => {
  const f = await fixture();
  const boss = await createQueue(f.db, { backend: "pglite" });
  try {
    const run = await f.store.createRun(alice, input());
    assert.equal(await drainOutbox(f.db, boss), 1);
    assert.equal(await drainOutbox(f.db, boss), 0);
    const jobs = await boss.findJobs("proof-run");
    assert.equal(jobs.length, 1);
    assert.equal((jobs[0].data as any).targetId, run.id);
    assert.equal(
      (await f.db.query("SELECT delivered_at FROM job_outbox")).rows[0]
        .delivered_at != null,
      true,
    );
  } finally {
    await boss.stop();
    await f.close();
  }
});
