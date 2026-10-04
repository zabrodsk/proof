import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { localDatabase } from "../server/backend/local.js";
import { migrate, workspace, enqueue } from "../server/backend/db.js";
import { localStorage } from "../server/backend/storage.js";
import { startWorker } from "../server/backend/queue.js";

test("local backend persists data across restart and consumes real durable jobs", async () => {
  const root = await mkdtemp(`${tmpdir()}/proof-local-`);
  let db = await localDatabase(`${root}/database`);
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  try {
    await migrate(db);
    const ws = await workspace(db, "local");
    await db.close();
    db = await localDatabase(`${root}/database`);
    assert.equal(await workspace(db, "local"), ws);
    const blobs = localStorage(`${root}/files`);
    const id = randomUUID(),
      key = `${ws}/${id}/upload`;
    await blobs.put(key, Buffer.from("Synthetic source"), "text/plain");
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO deletion_jobs(id,workspace_id,object_keys) VALUES($1,$2,$3)",
        [id, ws, JSON.stringify([key])],
      );
      await enqueue(tx, ws, "delete", id);
    });
    worker = await startWorker(db, blobs, { backend: "pglite" });
    const deadline = Date.now() + 15000;
    let status: string | undefined;
    do {
      status = (
        await db.query("SELECT status FROM deletion_jobs WHERE id=$1", [id])
      ).rows[0].status;
      if (status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(status, "complete");
    await assert.rejects(access(`${root}/files/${key}`), { code: "ENOENT" });
  } finally {
    await worker?.stop();
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
