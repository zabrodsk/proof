import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { PgBoss } from "pg-boss";
import {
  type Database,
  type Sql,
  migrate,
  workspace,
  enqueue,
} from "../server/backend/db.js";
import {
  createQueue,
  drainOutbox,
  processDeletion,
  retryable,
} from "../server/backend/queue.js";
import { processImport } from "../server/backend/imports.js";
import { createAsset, deleteAsset } from "../server/backend/library.js";
import { HttpError } from "../server/backend/config.js";
import type { BlobStore } from "../server/backend/storage.js";

let pg: PGlite, db: Database, boss: PgBoss, ws: string;
const files = new Map<string, Buffer>();
const blobs: BlobStore = {
  async put(key, body) {
    files.set(key, Buffer.from(body));
  },
  async get(key) {
    const file = files.get(key);
    if (!file) throw new Error("Missing blob");
    return file;
  },
  async delete(key) {
    files.delete(key);
  },
};
function sqlAdapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values?.length) {
        const result = await connection.query(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows };
      }
      const result = (await connection.exec(sql)).at(-1);
      return { rows: result?.rows || [], rowCount: result?.affectedRows };
    },
  };
}
before(async () => {
  pg = new PGlite({ extensions: { vector } });
  db = {
    ...sqlAdapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(sqlAdapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
  ws = await workspace(db, `queue-${randomUUID()}`);
  boss = await createQueue(db, { backend: "pglite" });
});
after(async () => {
  await boss?.stop();
  await db?.close();
});

test("outbox rolls back with its request and resumes after a queue restart", async () => {
  const target = randomUUID();
  await assert.rejects(
    db.transaction(async (tx) => {
      await enqueue(tx, ws, "ingest", target);
      throw new Error("rollback");
    }),
  );
  assert.equal(
    (await db.query("SELECT id FROM job_outbox WHERE target_id=$1", [target]))
      .rows.length,
    0,
  );
  await db.transaction(async (tx) => {
    await enqueue(tx, ws, "ingest", target);
    await enqueue(tx, ws, "ingest", target);
  });
  assert.equal(await drainOutbox(db, boss), 1);
  assert.equal(await drainOutbox(db, boss), 0);
  await boss.stop();
  boss = await createQueue(db, { backend: "pglite" });
  const jobs = await boss.fetch<{ workspaceId: string; targetId: string }>(
    "proof-ingest",
  );
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].data, {
    workspaceId: ws,
    targetId: target,
    kind: "ingest",
  });
  await boss.complete("proof-ingest", jobs[0]);
});

test("text import retries reuse the asset, extraction, and passages", async () => {
  const a = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Imported book", authors: ["Doe"], year: "2024" },
      "source.txt",
      "text/plain",
    ),
  );
  const id = randomUUID();
  const input = {
    assetId: a.id,
    text: "This book provides a long enough readable sentence about controlled research and its limitations.",
    kind: "text",
  };
  await db.query(
    "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,'text',$3)",
    [id, ws, JSON.stringify(input)],
  );
  await processImport(db, blobs, ws, id);
  const initial = (
    await db.query("SELECT * FROM source_imports WHERE id=$1", [id])
  ).rows[0];
  await db.query("UPDATE source_imports SET status='pending' WHERE id=$1", [
    id,
  ]);
  await processImport(db, blobs, ws, id);
  const final = (
    await db.query("SELECT * FROM source_imports WHERE id=$1", [id])
  ).rows[0];
  assert.equal(final.result.extractionId, initial.result.extractionId);
  assert.equal(
    (await db.query("SELECT id FROM extractions WHERE asset_id=$1", [a.id]))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT title FROM source_works, jsonb_to_record(metadata) AS meta(title text) WHERE id=$1",
        [a.workId],
      )
    ).rows[0].title,
    "Imported book",
  );
  assert.equal(final.status, "complete");
});

test("queue insertion and delivery marker roll back together", async () => {
  const target = randomUUID();
  await db.transaction((tx) => enqueue(tx, ws, "import", target));
  const interrupted: Database = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          async query(sql, values) {
            if (sql.startsWith("UPDATE job_outbox"))
              throw new Error("Crash after queue insertion");
            return tx.query(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(drainOutbox(interrupted, boss));
  assert.equal(
    (await boss.findJobs("proof-import", { data: { targetId: target } }))
      .length,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT delivered_at FROM job_outbox WHERE target_id=$1", [
        target,
      ])
    ).rows[0].delivered_at,
    null,
  );
  await drainOutbox(db, boss);
  assert.equal(
    (await boss.findJobs("proof-import", { data: { targetId: target } }))
      .length,
    1,
  );
});

test("bibliography entries are persisted checkpoints with no duplicate entries on retry", async () => {
  const id = randomUUID();
  const input = {
    text: 'Doe, Jane. "A Study of Reading." Journal of Reading, 2024.\nSmith, John. The Other Book. Publisher, 2023.',
    externalAccess: false,
  };
  await db.query(
    "INSERT INTO reference_imports(id,workspace_id,original) VALUES($1,$2,$3)",
    [id, ws, input.text],
  );
  await db.query(
    "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,'bibliography',$3)",
    [id, ws, JSON.stringify(input)],
  );
  await processImport(db, blobs, ws, id);
  const first = (
    await db.query(
      "SELECT id FROM reference_entries WHERE import_id=$1 ORDER BY ordinal",
      [id],
    )
  ).rows;
  assert.equal(first.length, 2);
  await db.query("UPDATE source_imports SET status='pending' WHERE id=$1", [
    id,
  ]);
  await processImport(db, blobs, ws, id);
  assert.deepEqual(
    (
      await db.query(
        "SELECT id FROM reference_entries WHERE import_id=$1 ORDER BY ordinal",
        [id],
      )
    ).rows,
    first,
  );
});

test("deletion removes files immediately and cleans recreated staging files after upload expiry", async () => {
  const a = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Delete me", authors: [], year: "" },
      "source.txt",
      "text/plain",
    ),
  );
  await blobs.put(a.key, Buffer.from("Original private text"), "text/plain");
  await deleteAsset(db, ws, a.id);
  const deletion = (
    await db.query(
      "SELECT id FROM deletion_jobs WHERE workspace_id=$1 ORDER BY id",
      [ws],
    )
  ).rows.at(-1).id;
  await processDeletion(db, blobs, ws, deletion, boss);
  assert.equal(files.has(a.key), false);
  assert.equal(
    (await db.query("SELECT status FROM deletion_jobs WHERE id=$1", [deletion]))
      .rows[0].status,
    "waiting",
  );
  await blobs.put(a.key, Buffer.from("Late signed upload"), "text/plain");
  await db.query(
    "UPDATE deletion_jobs SET object_keys=jsonb_set(object_keys,'{after}','0') WHERE id=$1",
    [deletion],
  );
  await processDeletion(db, blobs, ws, deletion, boss, true);
  assert.equal(files.has(a.key), false);
  assert.equal(
    (await db.query("SELECT status FROM deletion_jobs WHERE id=$1", [deletion]))
      .rows[0].status,
    "complete",
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,'text',$3)",
    [
      id,
      ws,
      JSON.stringify({
        assetId: a.id,
        text: "Retry must not recreate deleted content.",
      }),
    ],
  );
  await assert.rejects(
    processImport(db, blobs, ws, id),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  assert.equal(files.has(a.key), false);
});

test("permanent validation failures do not consume retry attempts", () => {
  assert.equal(
    retryable(new HttpError(429, "Run provider-call budget exhausted.")),
    false,
  );
  assert.equal(
    retryable(new HttpError(429, "Active run quota reached.")),
    false,
  );
  assert.equal(
    retryable(new HttpError(429, "Provider temporarily throttled.")),
    true,
  );
  assert.equal(retryable(new HttpError(422, "Invalid source")), false);
  assert.equal(retryable(new Error("EXA_API_KEY is not configured.")), false);
  assert.equal(retryable(new Error("Exa returned HTTP 503.")), true);
  assert.equal(retryable(new Error("Document download timed out.")), true);
});
