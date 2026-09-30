import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { createAsset, ingestAsset } from "../server/backend/library.js";
import { createRun, ownedRun } from "../server/backend/service.js";
import { processRun, type EngineDeps } from "../server/backend/engine.js";
import { runInput, type Selection } from "../shared/backend.js";
import type { BlobStore } from "../server/backend/storage.js";

let pg: PGlite;
let db: Database;
const previousEmbeddings = process.env.PROOF_EMBEDDINGS;
function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) return { rows: (await connection.query(sql, values)).rows };
      return { rows: (await connection.exec(sql)).at(-1)?.rows || [] };
    },
  };
}
before(async () => {
  process.env.PROOF_EMBEDDINGS = "false";
  pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
});
after(async () => {
  await db.close();
  if (previousEmbeddings === undefined) delete process.env.PROOF_EMBEDDINGS;
  else process.env.PROOF_EMBEDDINGS = previousEmbeddings;
});
async function fixture(text: string, pages: string[]) {
  const ws = await workspace(db, randomUUID());
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    async put(key, body) {
      files.set(key, Buffer.from(body));
    },
    async get(key) {
      return files.get(key)!;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  const body = Buffer.from(pages[0]);
  const saved = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      {
        title: "Controlled study",
        authors: ["Brown"],
        year: "2024",
      },
      "study.txt",
      "text/plain",
      body.length,
    ),
  );
  await blobs.put(saved.key, body, "text/plain");
  const extractionId = await ingestAsset(db, blobs, ws, saved.id);
  await db.query(
    "UPDATE source_assets SET eligibility='eligible' WHERE workspace_id=$1 AND id=$2",
    [ws, saved.id],
  );
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [extractionId],
  );
  // Keep every paragraph on the cited page. This forces separate judgment packets.
  for (let i = 1; i < pages.length; i++) {
    const start = i * 1000;
    await db.query(
      "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) SELECT $1,$2,$3,id,$4,$5,$6 FROM source_pages WHERE extraction_id=$3",
      [
        randomUUID(),
        ws,
        extractionId,
        start,
        start + pages[i].length,
        pages[i],
      ],
    );
  }
  const documentId = randomUUID(),
    versionId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,'Draft',$3)",
    [documentId, ws, versionId],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [versionId, ws, documentId, text],
  );
  const selection: Selection = {
    assetId: saved.id,
    extractionId,
    pageRanges: [],
  };
  const run = await createRun(
    db,
    ws,
    runInput.parse({
      documentVersionId: versionId,
      mode: "source_check",
      selectedSources: [selection],
      allowProviderProcessing: true,
      claimSpans: [{ start: 0, end: text.length }],
    }),
    randomUUID(),
  );
  return { ws, blobs, run, assetId: saved.id };
}
const noResearch = async () => ({
  selections: [] as Selection[],
  candidates: [],
  notices: [] as string[],
});
function deps(judge: EngineDeps["judge"]): EngineDeps {
  return { judge, research: noResearch, resolveReferences: noResearch };
}

test("a queued run uses its frozen source identity and publication status", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  await db.query(
    "UPDATE source_assets SET eligibility='ineligible',metadata=metadata||$3::jsonb WHERE workspace_id=$1 AND id=$2",
    [
      f.ws,
      f.assetId,
      JSON.stringify({ authors: ["Green"], publicationWarning: true }),
    ],
  );
  let calls = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, source, passages) => {
      calls++;
      assert.deepEqual(source.authors, ["Brown"]);
      assert.equal(source.publicationWarning, undefined);
      return {
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "The cited passage supports the claim.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(calls, 1);
  assert.equal(finding.citation, "correct");
  assert.equal(finding.eligibility, "eligible");
  assert.equal(
    (await ownedRun(db, f.ws, f.run.id)).config.sourceSnapshots[f.assetId]
      .metadata.authors[0],
    "Brown",
  );
});

test("contradiction without an evidence quote prevents approving a mixed cited page", async () => {
  const paragraphs = Array.from(
    { length: 7 },
    (_, i) =>
      `${i === 6 ? "CONFLICT" : "SUPPORT"} The treatment was studied in this paragraph. ${i}`,
  );
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1).",
    paragraphs,
  );
  let calls = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => {
      calls++;
      const conflict = passages!.some((p) => p.startsWith("CONFLICT"));
      return {
        ...claim,
        method: "Jev",
        status: conflict ? "contradicted" : "supported",
        ...(conflict ? {} : { evidence: passages![0] }),
        checkedPassages: passages,
        explanation: conflict
          ? "The cited page conflicts with the claim."
          : "Part of the cited page supports the claim.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(calls, 2);
  assert.equal(finding.support, "mixed");
  assert.equal(finding.citation, "not_checked");
});

test("older runs without frozen source metadata abstain instead of reading current eligibility", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  await db.query(
    "UPDATE runs SET config=config-'sourceSnapshots' WHERE id=$1",
    [f.run.id],
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async () => {
      throw new Error(
        "An old source must not be assessed against current metadata.",
      );
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(finding.support, "not_verified");
  assert.equal(finding.processing, "partial");
  assert.equal(finding.eligibility, "unknown");
  assert.ok(
    finding.explanation.some((notice: string) =>
      notice.includes("Start a new check"),
    ),
  );
});
