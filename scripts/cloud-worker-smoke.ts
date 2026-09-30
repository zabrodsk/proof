import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  database,
  enqueue,
  workspace,
  type Database,
} from "../server/backend/db.js";
import { storage, type BlobStore } from "../server/backend/storage.js";
import { createAsset, deleteAsset } from "../server/backend/library.js";
import { createRun } from "../server/backend/service.js";
import { embeddingSnapshot } from "../server/backend/embedding-model.js";
import { runInput, type Selection } from "../shared/backend.js";

// Run inside the deployed worker container. This process only submits jobs and
// observes PostgreSQL; it never starts its own worker or queue consumer.
if (process.env.PROOF_HOSTED !== "true")
  throw new Error(
    "Cloud smoke requires PROOF_HOSTED=true in the deployed worker.",
  );
if (
  process.env.PROOF_EMBEDDINGS !== "true" ||
  process.env.PROOF_EMBEDDING_REVISION !== embeddingSnapshot.revision
)
  throw new Error(
    "Cloud smoke requires the enabled pinned embedding snapshot.",
  );

const owner = `cloud-smoke-${randomUUID()}`;
const db = database();
const blobs = storage();
const timeout = 240_000;
let ws: string | undefined;
let stage = "configuration";

class SmokeFailure extends Error {}
const fail = (reason: string): never => {
  throw new SmokeFailure(reason);
};
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) fail(reason);
}
function safeStatus(value: unknown) {
  return typeof value === "string" && /^[a-z_0-9]{1,30}$/.test(value)
    ? value
    : "unknown";
}
async function poll<T>(
  label: string,
  inspect: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await inspect();
    if (value !== undefined) return value;
    await delay(500);
  }
  return fail(`${label}_timeout`);
}
async function draft(text: string) {
  const id = randomUUID(),
    versionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,$3,$4)",
      [id, ws, "Synthetic cloud verification", versionId],
    );
    await tx.query(
      "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
      [versionId, ws, id, text],
    );
  });
  return versionId;
}
async function verifyRun(
  mode: "source_check" | "discover" | "fact_check",
  documentVersionId: string,
  text: string,
  sources: Selection[] = [],
) {
  stage = mode;
  const run = await createRun(
    db,
    ws!,
    runInput.parse({
      documentVersionId,
      mode,
      selectedSources: sources,
      checkScope: "selected_library",
      externalAccess: mode === "source_check" ? "none" : "research",
      sourcePolicy: mode === "source_check" ? "user_supplied" : "academic",
      allowProviderProcessing: true,
      budgetPreset: "small",
      claimSpans: [{ start: 0, end: text.length }],
    }),
    randomUUID(),
  );
  const finished = await poll(mode, async () => {
    const row = (
      await db.query(
        "SELECT status,stage,coverage FROM runs WHERE workspace_id=$1 AND id=$2",
        [ws, run.id],
      )
    ).rows[0];
    if (!row) return fail(`${mode}_run_missing`);
    if (["failed", "cancelled"].includes(row.status))
      return fail(
        `${mode}_${safeStatus(row.status)}_at_${safeStatus(row.stage)}`,
      );
    return ["complete", "partial"].includes(row.status) ? row : undefined;
  });
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
      [ws, run.id],
    )
  ).rows;
  check(findings.length === 1, `${mode}_finding_count_invalid`);
  check(findings[0].data.claim.text === text, `${mode}_claim_changed`);
  check(
    finished.coverage.completedClaims === 1,
    `${mode}_coverage_not_persisted`,
  );
  const calls = (
    await db.query(
      "SELECT provider,status,count(*)::int AS n FROM provider_calls WHERE workspace_id=$1 AND run_id=$2 GROUP BY provider,status ORDER BY provider,status",
      [ws, run.id],
    )
  ).rows;
  check(calls.length > 0, `${mode}_provider_ledger_empty`);
  check(
    calls.some((call) => call.status === "complete"),
    `${mode}_no_successful_provider_call`,
  );
  check(
    calls.reduce((sum, call) => sum + call.n, 0) <= 50,
    `${mode}_provider_budget_exceeded`,
  );
  if (mode === "source_check") {
    check(
      calls.some(
        (call) => call.provider === "jev" && call.status === "complete",
      ),
      "source_check_no_successful_judge_call",
    );
    check(
      findings[0].data.processing === "complete",
      "source_check_judgment_incomplete",
    );
    check(
      findings[0].data.checkedPassageIds.length > 0,
      "source_check_evidence_not_persisted",
    );
  } else {
    const research = (
      await db.query(
        "SELECT data FROM research_results WHERE workspace_id=$1 AND run_id=$2",
        [ws, run.id],
      )
    ).rows;
    check(research.length > 0, `${mode}_research_ledger_empty`);
    check(
      calls.some(
        (call) => call.provider === "exa" && call.status === "complete",
      ),
      `${mode}_no_successful_discovery_call`,
    );
    console.log(`${mode}: research checkpoints=${research.length}`);
  }
  console.log(
    `${mode}: status=${safeStatus(finished.status)} findings=${findings.length} support=${safeStatus(findings[0].data.support)} processing=${safeStatus(findings[0].data.processing)}`,
  );
  console.log(
    `${mode}: providers=${calls.map((call) => `${safeStatus(call.provider)}/${safeStatus(call.status)}=${call.n}`).join(",")}`,
  );
}

async function cleanup(db: Database, blobs: BlobStore, scope: string) {
  const row = (
    await db.query("SELECT owner_id FROM workspaces WHERE id=$1", [scope])
  ).rows[0];
  check(
    row?.owner_id === owner && owner.startsWith("cloud-smoke-"),
    "cleanup_scope_mismatch",
  );
  const cancelled = await db.query(
    "UPDATE runs SET cancel_requested=true,status='cancelled',updated_at=now() WHERE workspace_id=$1 AND status IN ('queued','running') RETURNING id",
    [scope],
  );
  if (cancelled.rows.length) await delay(2000);
  const assets = (
    await db.query(
      "SELECT id,object_key FROM source_assets WHERE workspace_id=$1 AND deleted_at IS NULL",
      [scope],
    )
  ).rows;
  // This script and research imports never issue signed PUT URLs. Expire the
  // unused upload intents so durable deletion can finish during this check.
  await db.query(
    "UPDATE source_assets SET metadata=jsonb_set(metadata,'{uploadExpiresAt}','0'::jsonb) WHERE workspace_id=$1 AND deleted_at IS NULL",
    [scope],
  );
  for (const source of assets) await deleteAsset(db, scope, source.id);
  const deletionCount = await poll("cleanup_deletion", async () => {
    const jobs = (
      await db.query("SELECT status FROM deletion_jobs WHERE workspace_id=$1", [
        scope,
      ])
    ).rows;
    if (jobs.some((job) => job.status === "failed"))
      return fail("cleanup_durable_deletion_failed");
    return jobs.every((job) => job.status === "complete")
      ? jobs.length
      : undefined;
  });
  for (const source of assets) {
    for (const key of new Set([
      source.object_key,
      `${scope}/${source.id}/upload`,
      `${scope}/${source.id}/original`,
    ])) {
      let absent = false;
      try {
        await blobs.get(key);
      } catch (error: any) {
        absent =
          error?.$metadata?.httpStatusCode === 404 ||
          ["NoSuchKey", "NotFound"].includes(error?.name);
      }
      check(absent, "cleanup_object_still_present_or_unverifiable");
    }
  }
  await db.transaction(async (tx) => {
    // The workspace foreign keys intentionally do not cascade. Remove only
    // this synthetic scope, with existing child-table cascades handling reports.
    await tx.query("DELETE FROM compatibility_jobs WHERE workspace_id=$1", [
      scope,
    ]);
    await tx.query("DELETE FROM runs WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM documents WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM reference_imports WHERE workspace_id=$1", [
      scope,
    ]);
    await tx.query("DELETE FROM source_imports WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM source_works WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM job_outbox WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM deletion_jobs WHERE workspace_id=$1", [scope]);
    await tx.query("DELETE FROM pgboss.job WHERE data->>'workspaceId'=$1", [
      scope,
    ]);
    await tx.query("DELETE FROM workspaces WHERE id=$1 AND owner_id=$2", [
      scope,
      owner,
    ]);
  });
  check(
    (await db.query("SELECT id FROM workspaces WHERE id=$1", [scope])).rows
      .length === 0,
    "cleanup_workspace_remains",
  );
  console.log(
    `cleanup: complete assets=${assets.length} durable_deletions=${deletionCount} workspace_removed=true`,
  );
}

try {
  check(
    typeof blobs.signDownload === "function",
    "private_signed_download_unavailable",
  );
  ws = await workspace(db, owner);
  console.log("workspace: isolated synthetic owner created");
  stage = "ingestion";
  const original = Buffer.from(
    "Synthetic cloud verification source.\nSleep deprivation impairs working memory.\nThis example contains no private records.\n",
  );
  const source = await db.transaction(async (tx) => {
    const created = await createAsset(
      tx,
      ws!,
      {
        title: "Synthetic memory verification",
        authors: ["Cloud smoke fixture"],
        year: "2026",
      },
      "cloud-smoke.txt",
      "text/plain",
      original.length,
    );
    await tx.query(
      "UPDATE source_assets SET metadata=jsonb_set(metadata,'{uploadExpiresAt}','0'::jsonb),status='queued' WHERE workspace_id=$1 AND id=$2",
      [ws, created.id],
    );
    return created;
  });
  await blobs.put(source.key, original, "text/plain");
  await db.transaction((tx) => enqueue(tx, ws!, "ingest", source.id));
  const ready = await poll("ingestion", async () => {
    const row = (
      await db.query(
        "SELECT status,object_key FROM source_assets WHERE workspace_id=$1 AND id=$2",
        [ws, source.id],
      )
    ).rows[0];
    if (!row) return fail("ingestion_asset_missing");
    if (row.status === "failed") return fail("ingestion_worker_failed");
    return row.status === "ready" ? row : undefined;
  });
  const extraction = (
    await db.query(
      "SELECT id,status FROM extractions WHERE workspace_id=$1 AND asset_id=$2 ORDER BY created_at DESC LIMIT 1",
      [ws, source.id],
    )
  ).rows[0];
  check(extraction?.status === "complete", "ingestion_extraction_incomplete");
  const vectors = (
    await db.query(
      "SELECT vector_dims(embedding) AS dimensions,embedding_version FROM source_passages WHERE workspace_id=$1 AND extraction_id=$2",
      [ws, extraction.id],
    )
  ).rows;
  check(
    vectors.length > 0 &&
      vectors.every(
        (row) =>
          row.dimensions === 384 &&
          row.embedding_version ===
            `${embeddingSnapshot.model}@${embeddingSnapshot.revision}`,
      ),
    "ingestion_embedding_snapshot_invalid",
  );
  const outbox = (
    await db.query(
      "SELECT delivered_at FROM job_outbox WHERE workspace_id=$1 AND kind='ingest' AND target_id=$2",
      [ws, source.id],
    )
  ).rows[0];
  check(outbox?.delivered_at, "ingestion_outbox_not_delivered");
  console.log(
    `ingestion: existing cloud worker completed, vectors=${vectors.length} dimensions=384 pinned_revision=true`,
  );
  stage = "private_storage";
  const signed = await blobs.signDownload!(ready.object_key);
  const download = await fetch(signed, { signal: AbortSignal.timeout(30_000) });
  check(download.ok, "signed_download_failed");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
  const unsigned = new URL(signed);
  unsigned.search = "";
  const denied = await fetch(unsigned, { signal: AbortSignal.timeout(30_000) });
  check(
    [401, 403, 404].includes(denied.status),
    "unsigned_object_access_not_denied",
  );
  await denied.body?.cancel();
  console.log(
    `private_storage: signed_original_bytes_match=true unsigned_status=${denied.status}`,
  );
  const claim = "Sleep deprivation impairs working memory.";
  const documentVersionId = await draft(claim);
  await verifyRun("source_check", documentVersionId, claim, [
    { assetId: source.id, extractionId: extraction.id, pageRanges: [] },
  ]);
  if (process.env.PROOF_SMOKE_RESEARCH === "true") {
    await verifyRun("discover", documentVersionId, claim);
    await verifyRun("fact_check", documentVersionId, claim);
  }
  console.log("cloud_worker_smoke: passed");
} catch (error) {
  console.error(
    `cloud_worker_smoke: failed stage=${stage} reason=${error instanceof SmokeFailure ? error.message : error instanceof assert.AssertionError ? "assertion_failed" : "operation_failed"}`,
  );
  process.exitCode = 1;
} finally {
  if (ws)
    try {
      await cleanup(db, blobs, ws);
    } catch (error) {
      console.error(
        `cleanup: failed reason=${error instanceof SmokeFailure ? error.message : "operation_failed"}`,
      );
      process.exitCode = 1;
    }
  await db.close();
}
