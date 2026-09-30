import { randomUUID } from "node:crypto";
import { PgBoss, type BackendProfile, type Job } from "pg-boss";
import { type Database, type Sql, enqueue, event } from "./db.js";
import type { BlobStore } from "./storage.js";
import { ingestAsset } from "./library.js";
import { processImport } from "./imports.js";
import { HttpError } from "./config.js";

export const jobKinds = [
  "ingest",
  "import",
  "run",
  "delete",
  "compatibility",
] as const;
export type JobKind = (typeof jobKinds)[number];
export interface JobData {
  workspaceId: string;
  targetId: string;
  finalize?: boolean;
  kind?: JobKind;
}
const queueName = (kind: JobKind) => `proof-${kind}`;
const adapter = (db: Sql) => ({
  executeSql: (text: string, values?: unknown[]) => db.query(text, values),
});
export async function createQueue(
  db: Database,
  options: { backend?: BackendProfile } = {},
) {
  const boss = new PgBoss({
    db: adapter(db),
    backend: options.backend || "postgres",
    application_name: "proof-worker",
    schedule: false,
  });
  boss.on("error", () =>
    console.error(
      "The durable queue reported an error. Check PostgreSQL availability.",
    ),
  );
  await boss.start();
  await boss.createQueue("proof-dead", {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
  });
  for (const kind of jobKinds)
    await boss.createQueue(queueName(kind), {
      retryLimit: kind === "delete" ? 12 : 3,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 300,
      expireInSeconds: kind === "run" ? 3600 : 1800,
      heartbeatSeconds: 30,
      deadLetter: "proof-dead",
      retentionSeconds: 14 * 86400,
      deleteAfterSeconds: 86400,
    });
  // pg-boss lazily loads queue metadata outside a supplied transaction. Warm that cache
  // before outbox transactions, including single-connection PostgreSQL test adapters.
  for (const kind of jobKinds)
    await boss.findJobs(queueName(kind), {
      id: "00000000-0000-0000-0000-000000000000",
    });
  return boss;
}

export async function drainOutbox(db: Database, boss: PgBoss) {
  return db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        "SELECT * FROM job_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const row of rows) {
      if (!jobKinds.includes(row.kind))
        throw new Error("Unknown durable job kind.");
      // Both writes use this transaction. A crash cannot leave a delivered outbox row without a job.
      await boss.send(
        queueName(row.kind),
        {
          workspaceId: row.workspace_id,
          targetId: row.target_id,
          kind: row.kind,
        },
        { id: row.id, db: adapter(tx) },
      );
      await tx.query("UPDATE job_outbox SET delivered_at=now() WHERE id=$1", [
        row.id,
      ]);
    }
    return rows.length;
  });
}

export async function processDeletion(
  db: Database,
  blobs: BlobStore,
  ws: string,
  id: string,
  boss: PgBoss,
  finalize = false,
) {
  await db.transaction(async (tx) => {
    const row = (
      await tx.query(
        "SELECT * FROM deletion_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ws, id],
      )
    ).rows[0];
    if (
      !row ||
      row.status === "complete" ||
      (row.status === "waiting" && !finalize)
    )
      return;
    const payload = row.object_keys;
    const keys: string[] = Array.isArray(payload) ? payload : payload.keys;
    if (
      !Array.isArray(keys) ||
      keys.some((key) => typeof key !== "string" || !key.startsWith(`${ws}/`))
    )
      throw new HttpError(422, "Invalid object deletion scope.");
    for (const key of new Set(keys)) await blobs.delete(key);
    const after = Number(payload.after || 0);
    if (after > Date.now()) {
      // A still-valid signed PUT can recreate the staging object. Delete it again after expiry.
      await boss.send(
        queueName("delete"),
        { workspaceId: ws, targetId: id, finalize: true, kind: "delete" },
        { id, startAfter: new Date(after + 1000), db: adapter(tx) },
      );
      await tx.query(
        "UPDATE deletion_jobs SET status='waiting' WHERE workspace_id=$1 AND id=$2",
        [ws, id],
      );
    } else
      await tx.query(
        "UPDATE deletion_jobs SET status='complete' WHERE workspace_id=$1 AND id=$2",
        [ws, id],
      );
  });
}

async function scheduleUploadCleanup(db: Database, ws: string, id: string) {
  await db.transaction(async (tx) => {
    const a = (
      await tx.query(
        "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
        [ws, id],
      )
    ).rows[0];
    if (!a || a.status !== "ready" || a.metadata.uploadCleanupQueued) return;
    const deletion = randomUUID();
    await tx.query(
      "INSERT INTO deletion_jobs(id,workspace_id,object_keys) VALUES($1,$2,$3)",
      [
        deletion,
        ws,
        JSON.stringify({
          keys: [`${ws}/${id}/upload`],
          after: Number(a.metadata.uploadExpiresAt || 0),
        }),
      ],
    );
    await enqueue(tx, ws, "delete", deletion);
    await tx.query(
      "UPDATE source_assets SET metadata=metadata || '{\"uploadCleanupQueued\":true}'::jsonb WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    );
  });
}

export function retryable(error: unknown) {
  if (error instanceof HttpError)
    return (
      (error.status === 429 && !/budget|quota|limit/i.test(error.message)) ||
      error.status >= 500
    );
  const e = error as {
    code?: string;
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (e?.$metadata?.httpStatusCode)
    return (
      e.$metadata.httpStatusCode === 429 || e.$metadata.httpStatusCode >= 500
    );
  if (
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EPIPE|40001|40P01|53\d\d\d|57P0\d|08\w{3})$/.test(
      e?.code || "",
    )
  )
    return true;
  if (["TimeoutError", "AbortError"].includes(e?.name || "")) return true;
  if (
    /HTTP (429|5\d\d)|timed out|fetch failed|socket|temporarily unavailable/i.test(
      e?.message || "",
    )
  )
    return true;
  if (
    /not configured|credential|invalid|unsupported|does not match|checksum|file size|exceeds|limit|public HTTPS|not a public|no readable|binary contents|password|encrypted|HTTP [34]\d\d/i.test(
      e?.message || "",
    )
  )
    return false;
  // Unknown failures may be a transient database or provider outage. Bound their retries.
  return true;
}

async function recordFailure(
  db: Database,
  kind: JobKind,
  data: JobData,
  terminal: boolean,
) {
  const ws = data.workspaceId,
    id = data.targetId;
  const error = terminal
    ? "Processing failed. Check source availability, file validity, and provider configuration."
    : "A temporary processing failure will be retried.";
  if (kind === "run")
    await db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT status FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [ws, id],
        )
      ).rows[0];
      if (!r || ["complete", "partial", "cancelled"].includes(r.status)) return;
      await tx.query(
        "UPDATE runs SET status=$3,error=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ws, id, terminal ? "failed" : "queued", error],
      );
      await event(tx, ws, id, terminal ? "failed" : "retrying", {
        error,
        partialReport: true,
      });
    });
  if (kind === "ingest")
    await db.query(
      "UPDATE source_assets SET status=$3,metadata=metadata || $4::jsonb WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL AND status<>'ready'",
      [
        ws,
        id,
        terminal ? "failed" : "queued",
        JSON.stringify({ processingError: error }),
      ],
    );
  if (kind === "import") {
    await db.query(
      "UPDATE source_imports SET status=$3,result=result || $4::jsonb WHERE workspace_id=$1 AND id=$2 AND status<>'complete'",
      [ws, id, terminal ? "failed" : "pending", JSON.stringify({ error })],
    );
    await db.query(
      "UPDATE reference_imports SET status=$3 WHERE workspace_id=$1 AND id=$2 AND status<>'complete'",
      [ws, id, terminal ? "failed" : "pending"],
    );
    await db.query(
      "UPDATE source_assets SET status=$3,metadata=metadata || $4::jsonb WHERE workspace_id=$1 AND id IN (SELECT (input->>'assetId')::uuid FROM source_imports WHERE workspace_id=$1 AND id=$2) AND deleted_at IS NULL AND status<>'ready'",
      [
        ws,
        id,
        terminal ? "failed" : "queued",
        JSON.stringify({ processingError: error }),
      ],
    );
  }
  if (kind === "delete" && terminal)
    await db.query(
      "UPDATE deletion_jobs SET status='failed' WHERE workspace_id=$1 AND id=$2 AND status<>'complete'",
      [ws, id],
    );
  if (kind === "compatibility")
    await db.query(
      "UPDATE compatibility_jobs SET status=$3,error=$4 WHERE workspace_id=$1 AND id=$2 AND status<>'complete'",
      [ws, id, terminal ? "failed" : "queued", error],
    );
}

export async function handleJob(
  db: Database,
  blobs: BlobStore,
  boss: PgBoss,
  kind: JobKind,
  job: Job<JobData> & { retryLimit?: number },
) {
  try {
    const { workspaceId: ws, targetId: id } = job.data;
    if (kind === "ingest") {
      await ingestAsset(db, blobs, ws, id);
      await scheduleUploadCleanup(db, ws, id);
    }
    if (kind === "import") {
      await processImport(db, blobs, ws, id);
      const row = (
        await db.query(
          "SELECT input FROM source_imports WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        )
      ).rows[0];
      if (row?.input.assetId)
        await scheduleUploadCleanup(db, ws, row.input.assetId);
    }
    if (kind === "run") {
      const { processRun } = await import("./engine.js");
      await processRun(db, blobs, ws, id);
    }
    if (kind === "compatibility") {
      const { processCompatibilityJob } = await import("./compatibility.js");
      await processCompatibilityJob(db, blobs, ws, id);
    }
    if (kind === "delete")
      await processDeletion(db, blobs, ws, id, boss, job.data.finalize);
  } catch (error) {
    // A queued retry for a deleted source or run has nothing left to process.
    if (error instanceof HttpError && error.status === 404) return;
    const transient = retryable(error),
      terminal =
        !transient ||
        job.retryCount >= (job.retryLimit ?? (kind === "delete" ? 12 : 3));
    await recordFailure(db, kind, job.data, terminal);
    if (transient)
      throw new Error(
        "Worker stage failed; the durable queue controls retries.",
      );
  }
}

export async function startWorker(
  db: Database,
  blobs: BlobStore,
  options: { backend?: BackendProfile } = {},
) {
  const boss = await createQueue(db, options);
  const concurrency = Math.max(
    1,
    Math.min(4, Number(process.env.PROOF_WORKER_CONCURRENCY) || 2),
  );
  for (const kind of jobKinds)
    await boss.work<JobData>(
      queueName(kind),
      {
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: kind === "run" ? concurrency : 1,
        pollingIntervalSeconds: 1,
      },
      async (jobs) => {
        for (const job of jobs) await handleJob(db, blobs, boss, kind, job);
      },
    );
  await boss.work<JobData>(
    "proof-dead",
    { includeMetadata: true, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs)
        if (job.data.kind && jobKinds.includes(job.data.kind))
          await recordFailure(db, job.data.kind, job.data, true);
    },
  );
  let stopped = false;
  let draining: Promise<unknown> | undefined;
  const drain = () => {
    if (stopped || draining) return;
    draining = drainOutbox(db, boss)
      .catch(() =>
        console.error(
          "Outbox delivery failed; pending jobs remain in PostgreSQL.",
        ),
      )
      .finally(() => {
        draining = undefined;
      });
  };
  drain();
  const timer = setInterval(drain, 1000);
  return {
    boss,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await draining;
      await boss.stop({ graceful: true, timeout: 30_000 });
    },
  };
}
