import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import {
  createAsset,
  asset,
  ingestAsset,
  deleteAsset,
  validateSelection,
} from "../server/backend/library.js";
import { createRun, ownedRun, applyFix } from "../server/backend/service.js";
import { retrieve } from "../server/backend/retrieval.js";
import { extractFile, passageSpans } from "../server/backend/extraction.js";
import { runInput, type Selection } from "../shared/backend.js";
import type { BlobStore } from "../server/backend/storage.js";

let pg: PGlite;
let db: Database;
const previousEmbeddings = process.env.PROOF_EMBEDDINGS;

function sqlAdapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) {
        const result = await connection.query(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows };
      }
      const results = await connection.exec(sql);
      const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows };
    },
  };
}

before(async () => {
  process.env.PROOF_EMBEDDINGS = "false";
  pg = new PGlite({ extensions: { vector } });
  db = {
    ...sqlAdapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(sqlAdapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
  // Startup retries must be safe against an already initialized database.
  await migrate(db);
});
after(async () => {
  await db?.close();
  if (previousEmbeddings === undefined) delete process.env.PROOF_EMBEDDINGS;
  else process.env.PROOF_EMBEDDINGS = previousEmbeddings;
});

async function draft(ws: string, text = "The review included 300 studies.") {
  const id = randomUUID(),
    versionId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,$3,$4)",
    [id, ws, "Draft", versionId],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [versionId, ws, id, text],
  );
  return { id, versionId, text };
}
function memoryBlobs() {
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    async put(key, body) {
      files.set(key, Buffer.from(body));
    },
    async get(key) {
      const body = files.get(key);
      if (!body) throw new Error("Missing blob");
      return body;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  return { blobs, files };
}
async function source(
  ws: string,
  text = "The review included 218 studies with a total of 14,170 participants.",
) {
  const { blobs, files } = memoryBlobs();
  const body = Buffer.from(text);
  const created = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Review", authors: [], year: "2024" },
      "review.txt",
      "text/plain",
      body.length,
    ),
  );
  await blobs.put(created.key, body, "text/plain");
  const extractionId = await ingestAsset(db, blobs, ws, created.id);
  return {
    ...created,
    extractionId,
    blobs,
    files,
    selection: {
      assetId: created.id,
      extractionId,
      pageRanges: [],
    } satisfies Selection,
  };
}
async function sourceRun(
  ws: string,
  versionId: string,
  selection: Selection,
  key = randomUUID(),
) {
  return createRun(
    db,
    ws,
    runInput.parse({
      documentVersionId: versionId,
      mode: "source_check",
      selectedSources: [selection],
    }),
    key,
  );
}
const status = (expected: number) => (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "status" in error &&
  error.status === expected;

test("migration enables pgvector and enforces workspace ownership across assets, documents, and runs", async () => {
  const ws = await workspace(db, randomUUID()),
    other = await workspace(db, randomUUID());
  const saved = await source(ws),
    doc = await draft(ws);
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  assert.equal(
    (
      await db.query(
        "SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector AS distance",
      )
    ).rows[0].distance,
    0,
  );
  await assert.rejects(asset(db, other, saved.id), status(404));
  await assert.rejects(ownedRun(db, other, run.id), status(404));
  await assert.rejects(
    validateSelection(db, other, [saved.selection]),
    status(409),
  );
  await assert.rejects(
    sourceRun(other, doc.versionId, saved.selection),
    status(404),
  );
  await assert.rejects(
    db.query(
      "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
      [randomUUID(), other, doc.id, "Cross-workspace document"],
    ),
    /foreign key constraint/,
  );
  assert.deepEqual(
    (await retrieve(db, other, saved.selection, "studies")).passages,
    [],
  );
});

test("ingestion retries reuse the extraction and preserve original bytes", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws);
  const repeated = await ingestAsset(db, saved.blobs, ws, saved.id);
  assert.equal(repeated, saved.extractionId);
  const counts = (
    await db.query(
      "SELECT (SELECT count(*) FROM extractions WHERE asset_id=$1)::int AS extractions, (SELECT count(*) FROM source_pages WHERE extraction_id=$2)::int AS pages",
      [saved.id, saved.extractionId],
    )
  ).rows[0];
  assert.deepEqual(counts, { extractions: 1, pages: 1 });
  assert.deepEqual(
    saved.files.get(`${ws}/${saved.id}/original`),
    saved.files.get(saved.key),
  );
  assert.equal((await asset(db, ws, saved.id)).status, "ready");
});

test("a saved recognized PDF is reused without reading bytes or calling the provider again", async () => {
  const ws = await workspace(db, randomUUID());
  const pdf = await PDFDocument.create();
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(200, 300);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 200, 300);
  context.fillStyle = "black";
  context.fillText("Synthetic scanned body", 10, 100);
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  for (let n = 0; n < 2; n++)
    pdf
      .addPage([200, 300])
      .drawImage(image, { x: 0, y: 0, width: 200, height: 300 });
  const body = Buffer.from(await pdf.save());
  const { blobs } = memoryBlobs();
  const created = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Synthetic scan", authors: [], year: "2026" },
      "scan.pdf",
      "application/pdf",
      body.length,
    ),
  );
  await db.query(
    "UPDATE source_assets SET metadata=metadata || '{\"allowExternalProcessing\":true}'::jsonb WHERE id=$1",
    [created.id],
  );
  await blobs.put(created.key, body, "application/pdf");
  const previousKey = process.env.FIRECRAWL_API_KEY;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.FIRECRAWL_API_KEY = "synthetic-test-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.firecrawl.dev/v2/parse");
    calls++;
    const uploaded = await PDFDocument.load(
      await ((init!.body as FormData).get("file") as File).arrayBuffer(),
    );
    assert.equal(uploaded.getPageCount(), 2);
    return Response.json({
      success: true,
      data: {
        pages: [1, 2].map((pageNumber) => ({
          pageNumber,
          markdown: `Synthetic page ${pageNumber} describes a study with 218 participants.`,
        })),
      },
    });
  };
  try {
    const first = await ingestAsset(db, blobs, ws, created.id);
    assert.equal(calls, 1);
    blobs.get = async () => {
      throw new Error("A saved extraction must not reread the file");
    };
    assert.equal(await ingestAsset(db, blobs, ws, created.id), first);
    assert.equal(calls, 1);
    const rows = (
      await db.query(
        "SELECT usage FROM asset_provider_calls WHERE workspace_id=$1 AND asset_id=$2",
        [ws, created.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.usage.requestId)).size, 1);
    assert.ok(rows.every((row) => row.usage.status === "complete"));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM source_pages WHERE extraction_id=$1 AND status='readable'",
          [first],
        )
      ).rows[0].n,
      2,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});

test("run idempotency returns one durable run and rejects changed input", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const key = randomUUID();
  const first = await sourceRun(ws, doc.versionId, saved.selection, key);
  const again = await sourceRun(ws, doc.versionId, saved.selection, key);
  assert.equal(first.id, again.id);
  const changed = runInput.parse({
    documentVersionId: doc.versionId,
    mode: "source_check",
    selectedSources: [saved.selection],
    budgetPreset: "small",
  });
  await assert.rejects(createRun(db, ws, changed, key), status(409));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM job_outbox WHERE kind='run' AND target_id=$1",
        [first.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM run_events WHERE run_id=$1 AND type='queued'",
        [first.id],
      )
    ).rows[0].n,
    1,
  );
});

test("run contracts keep all three modes and external access distinct", () => {
  const documentVersionId = randomUUID();
  assert.equal(
    runInput.safeParse({
      documentVersionId,
      mode: "source_check",
      selectedSources: [],
    }).success,
    false,
  );
  for (const mode of ["discover", "fact_check"]) {
    assert.equal(
      runInput.safeParse({ documentVersionId, mode, externalAccess: "none" })
        .success,
      false,
    );
    assert.equal(
      runInput.safeParse({
        documentVersionId,
        mode,
        externalAccess: "research",
        sourcePolicy: "academic",
      }).success,
      true,
    );
  }
  assert.equal(
    runInput.safeParse({
      documentVersionId,
      mode: "source_check",
      referenceImportVersionId: randomUUID(),
      externalAccess: "research",
    }).success,
    false,
  );
});

test("a 300-page PDF indexes the last page and retrieval respects physical page restrictions", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 300; index++) {
    pdf
      .addPage()
      .drawText(
        index === 300
          ? "Terminal discovery: the final study included 218 participants."
          : `Physical page ${index} describes ordinary background and study methods.`,
        { x: 30, y: 700, size: 12, font },
      );
  }
  const body = Buffer.from(await pdf.save());
  const ws = await workspace(db, randomUUID()),
    { blobs } = memoryBlobs();
  const saved = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Long study", authors: [], year: "2024" },
      "long.pdf",
      "application/pdf",
      body.length,
    ),
  );
  await blobs.put(saved.key, body, "application/pdf");
  const extractionId = await ingestAsset(db, blobs, ws, saved.id);
  const coverage = (
    await db.query("SELECT coverage FROM extractions WHERE id=$1", [
      extractionId,
    ])
  ).rows[0].coverage;
  assert.equal(coverage.totalPages, 300);
  assert.equal(coverage.readablePages, 300);
  assert.deepEqual(coverage.omittedPages, []);
  const selection: Selection = {
    assetId: saved.id,
    extractionId,
    pageRanges: [],
  };
  const all = await retrieve(
    db,
    ws,
    selection,
    "Terminal discovery",
    undefined,
    1,
  );
  assert.ok(
    all.passages.some(
      (passage) => passage.pageIndex === 300 && passage.text.includes("218"),
    ),
  );
  assert.equal(
    all.passages.find((passage) => passage.pageIndex === 300)?.labelStatus,
    "unknown",
  );
  const restricted = await retrieve(
    db,
    ws,
    { ...selection, pageRanges: [{ from: 10, to: 12 }] },
    "Terminal discovery",
    "300",
    10,
  );
  assert.ok(restricted.passages.length > 0);
  assert.ok(
    restricted.passages.every(
      (passage) => passage.pageIndex >= 10 && passage.pageIndex <= 12,
    ),
  );
  assert.equal(restricted.locatorKnown, false);
  assert.deepEqual(restricted.citedIds, []);
  await assert.rejects(
    validateSelection(db, ws, [
      { ...selection, pageRanges: [{ from: 1, to: 301 }] },
    ]),
    status(400),
  );
  await db.query(
    "UPDATE source_pages SET label='printed-300',label_status='confirmed' WHERE extraction_id=$1 AND page_index=300",
    [extractionId],
  );
  const cited = await retrieve(
    db,
    ws,
    selection,
    "ordinary background",
    "printed-300",
    1,
  );
  assert.equal(cited.locatorKnown, true);
  assert.equal(cited.citedIds.length, 1);
  assert.ok(cited.passages.some((passage) => passage.pageIndex === 300));
});

test("verified edits create a document version and stale findings cannot edit it again", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  const claimId = randomUUID(),
    findingId = randomUUID(),
    start = doc.text.indexOf("300");
  await db.query(
    "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,0,'{}')",
    [claimId, ws, run.id],
  );
  await db.query(
    "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,0,$5)",
    [
      findingId,
      ws,
      run.id,
      claimId,
      JSON.stringify({
        fix: {
          start,
          end: start + 3,
          original: "300",
          replacement: "218",
          documentVersionId: doc.versionId,
          kind: "number",
        },
      }),
    ],
  );
  const edited = await applyFix(db, ws, doc.id, doc.versionId, findingId);
  assert.equal(edited.text, "The review included 218 studies.");
  assert.notEqual(edited.id, doc.versionId);
  assert.equal((await ownedRun(db, ws, run.id)).invalidated, true);
  assert.equal(
    (
      await db.query("SELECT text FROM document_versions WHERE id=$1", [
        doc.versionId,
      ])
    ).rows[0].text,
    doc.text,
  );
  await assert.rejects(
    applyFix(db, ws, doc.id, doc.versionId, findingId),
    status(409),
  );
  await assert.rejects(
    applyFix(db, ws, doc.id, edited.id, findingId),
    status(409),
  );
});

test("applying one verified edit carries the other findings onto the new version", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(
      ws,
      "The review included 300 studies. Participants numbered 14,170 in total. Effects were small.",
    );
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  await db.query("UPDATE runs SET status='complete' WHERE id=$1", [run.id]);
  const span = (text: string) => {
    const start = doc.text.indexOf(text);
    return { text, start, end: start + text.length };
  };
  const seed = async (
    ordinal: number,
    claimText: string,
    fix?: { original: string; replacement: string },
  ) => {
    const claimId = randomUUID(),
      findingId = randomUUID(),
      claim = span(claimText);
    await db.query(
      "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,$4,$5)",
      [claimId, ws, run.id, ordinal, JSON.stringify(claim)],
    );
    const fixSpan = fix && span(fix.original);
    await db.query(
      "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        findingId,
        ws,
        run.id,
        claimId,
        ordinal,
        JSON.stringify({
          id: findingId,
          claim: { ...claim, kind: "numeric", context: claimText },
          support: "overstated",
          evidence: [],
          explanation: [],
          checkedPassageIds: [],
          ...(fix && fixSpan
            ? {
                fix: {
                  start: fixSpan.start,
                  end: fixSpan.end,
                  original: fix.original,
                  replacement: fix.replacement,
                  documentVersionId: doc.versionId,
                  kind: "number",
                },
              }
            : {}),
        }),
      ],
    );
    return findingId;
  };
  const first = await seed(0, "The review included 300 studies.", {
    original: "300",
    replacement: "218",
  });
  await seed(1, "Participants numbered 14,170 in total.", {
    original: "14,170",
    replacement: "14,171",
  });
  await seed(2, "Effects were small.");

  const edited = await applyFix(db, ws, doc.id, doc.versionId, first);
  assert.equal((await ownedRun(db, ws, run.id)).invalidated, true);
  assert.ok(edited.runId);
  const derived = await ownedRun(db, ws, edited.runId!);
  assert.equal(derived.document_version_id, edited.id);
  assert.equal(derived.invalidated, false);
  const carried = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [derived.id],
    )
  ).rows.map((row) => row.data);
  assert.deepEqual(
    carried.map((finding) => finding.claim.text),
    ["Participants numbered 14,170 in total.", "Effects were small."],
  );
  for (const finding of carried)
    assert.equal(
      edited.text.slice(finding.claim.start, finding.claim.end),
      finding.claim.text,
    );
  const next = carried[0];
  assert.equal(next.fix.documentVersionId, edited.id);
  const again = await applyFix(db, ws, doc.id, edited.id, next.id);
  assert.equal(
    again.text,
    "The review included 218 studies. Participants numbered 14,171 in total. Effects were small.",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM findings WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    3,
  );
});

test("accepting the last suggestion keeps a finished report for the new version", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws, "The review included 300 studies.");
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  await db.query("UPDATE runs SET status='complete' WHERE id=$1", [run.id]);
  const claimId = randomUUID(),
    findingId = randomUUID(),
    claim = { text: doc.text, start: 0, end: doc.text.length };
  await db.query(
    "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,0,$4)",
    [claimId, ws, run.id, JSON.stringify(claim)],
  );
  await db.query(
    "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,0,$5)",
    [
      findingId,
      ws,
      run.id,
      claimId,
      JSON.stringify({
        id: findingId,
        claim: { ...claim, kind: "numeric", context: doc.text },
        support: "overstated",
        evidence: [],
        explanation: [],
        checkedPassageIds: [],
        fix: {
          start: doc.text.indexOf("300"),
          end: doc.text.indexOf("300") + 3,
          original: "300",
          replacement: "218",
          documentVersionId: doc.versionId,
          kind: "number",
        },
      }),
    ],
  );
  const edited = await applyFix(db, ws, doc.id, doc.versionId, findingId);
  assert.ok(edited.runId);
  const derived = await ownedRun(db, ws, edited.runId!);
  assert.equal(derived.document_version_id, edited.id);
  assert.equal(derived.status, "complete");
  assert.equal(derived.coverage.retiredFindings, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM findings WHERE run_id=$1",
        [derived.id],
      )
    ).rows[0].n,
    0,
  );
});

test("deletion removes searchable passages and source-containing reports, then queues blob cleanup", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  await deleteAsset(db, ws, saved.id);
  await assert.rejects(asset(db, ws, saved.id), status(404));
  await assert.rejects(ingestAsset(db, saved.blobs, ws, saved.id), status(404));
  await assert.rejects(ownedRun(db, ws, run.id), status(404));
  await assert.rejects(
    validateSelection(db, ws, [saved.selection]),
    status(409),
  );
  assert.deepEqual(
    (await retrieve(db, ws, saved.selection, "studies")).passages,
    [],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM source_passages WHERE extraction_id=$1",
        [saved.extractionId],
      )
    ).rows[0].n,
    0,
  );
  const deletion = (
    await db.query("SELECT * FROM deletion_jobs WHERE workspace_id=$1", [ws])
  ).rows[0];
  assert.ok(deletion.object_keys.keys.includes(`${ws}/${saved.id}/original`));
  assert.ok(deletion.object_keys.keys.includes(saved.key));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM job_outbox WHERE kind='delete' AND target_id=$1",
        [deletion.id],
      )
    ).rows[0].n,
    1,
  );
});

test("extraction retains unreadable-page coverage and exact passage offsets", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const result = await extractFile(Buffer.from(await pdf.save()), "scan.pdf");
  assert.equal(result.coverage.totalPages, 1);
  assert.deepEqual(result.coverage.unreadablePages, [1]);
  assert.equal(result.pages[0].labelStatus, "unknown");
  assert.deepEqual(result.pages[0].blocks, []);
  const text = "   Evidence with whitespace.\n".repeat(150);
  const spans = passageSpans(text);
  assert.ok(spans.length > 1);
  for (const span of spans)
    assert.equal(text.slice(span.start, span.end), span.text);
});

test("fix application rejects an edit whose original text does not match the stored span", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const run = await sourceRun(ws, doc.versionId, saved.selection);
  const claimId = randomUUID(),
    findingId = randomUUID();
  await db.query(
    "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,0,'{}')",
    [claimId, ws, run.id],
  );
  await db.query(
    "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,0,$5)",
    [
      findingId,
      ws,
      run.id,
      claimId,
      JSON.stringify({
        fix: {
          start: 0,
          end: 3,
          original: "999",
          replacement: "218",
          documentVersionId: doc.versionId,
          kind: "number",
        },
      }),
    ],
  );
  await assert.rejects(
    applyFix(db, ws, doc.id, doc.versionId, findingId),
    status(409),
  );
  assert.equal(
    (
      await db.query("SELECT current_version_id FROM documents WHERE id=$1", [
        doc.id,
      ])
    ).rows[0].current_version_id,
    doc.versionId,
  );
  assert.equal((await ownedRun(db, ws, run.id)).invalidated, false);
});

test("run creation validates claim boundaries and limits active work per workspace", async () => {
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const input = runInput.parse({
    documentVersionId: doc.versionId,
    mode: "source_check",
    selectedSources: [saved.selection],
  });
  await assert.rejects(
    createRun(
      db,
      ws,
      { ...input, claimSpans: [{ start: 0, end: doc.text.length + 1 }] },
      randomUUID(),
    ),
    status(400),
  );
  for (let index = 0; index < 3; index++)
    await createRun(db, ws, input, randomUUID());
  await assert.rejects(createRun(db, ws, input, randomUUID()), status(429));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM runs WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n,
    3,
  );
});

test("source ownership and stored metadata survive closing and reopening PostgreSQL", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "proof-backend-restart-"),
  );
  const open = () => {
    const connection = new PGlite(directory, { extensions: { vector } });
    const durable: Database = {
      ...sqlAdapter(connection),
      transaction: (fn) => connection.transaction((tx) => fn(sqlAdapter(tx))),
      close: () => connection.close(),
    };
    return durable;
  };
  let durable = open();
  try {
    await migrate(durable);
    const owner = randomUUID(),
      ws = await workspace(durable, owner);
    const saved = await durable.transaction((tx) =>
      createAsset(
        tx,
        ws,
        { title: "A book with no DOI", authors: ["Test Author"], year: "2024" },
        "book.pdf",
        "application/pdf",
        123,
      ),
    );
    await durable.close();
    durable = open();
    await migrate(durable);
    assert.equal(await workspace(durable, owner), ws);
    const reopened = await asset(durable, ws, saved.id);
    assert.equal(reopened.metadata.title, "A book with no DOI");
    assert.equal(reopened.object_key, saved.key);
    assert.equal(reopened.version_id, saved.versionId);
  } finally {
    await durable.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function authorizeSource(ws: string, id: string, author: string) {
  await db.query(
    "UPDATE source_assets SET eligibility='eligible',metadata=metadata||$3::jsonb WHERE workspace_id=$1 AND id=$2",
    [ws, id, JSON.stringify({ authors: [author] })],
  );
}
async function engineRun(
  ws: string,
  versionId: string,
  selections: Selection[],
  overrides: Record<string, unknown> = {},
) {
  const input = runInput.parse({
    documentVersionId: versionId,
    mode: "source_check",
    selectedSources: selections,
    allowProviderProcessing: true,
    ...overrides,
  });
  return createRun(db, ws, input, randomUUID());
}
const noResearch = async () => ({
  selections: [] as Selection[],
  candidates: [],
  notices: [] as string[],
});
const noResolution = async () => ({
  selections: [] as Selection[],
  candidates: [],
  notices: [] as string[],
});

test("testing materials retain text support without academic eligibility and distinguish irrelevant passages", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const saved = await source(
    ws,
    "The class had 24 students. Each student completed two tests.",
  );
  const doc = await draft(ws, "The class had 24 students.");
  for (const verdict of ["supported", "not_addressed"] as const) {
    const run = await engineRun(ws, doc.versionId, [saved.selection], {
      sourcePolicy: "user_supplied",
      checkScope: "selected_library",
      claimSpans: [{ start: 0, end: doc.text.length }],
    });
    await processRun(db, saved.blobs, ws, run.id, {
      judge: async (claim, _item, passages) => ({
        ...claim,
        method: "Jev",
        status: verdict,
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Compared the supplied text.",
      }),
      research: noResearch,
      resolveReferences: noResolution,
    });
    const result = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(result.basis, "supplied_text");
    assert.equal(result.processing, "complete");
    assert.equal(result.eligibility, "unknown");
    assert.equal(
      result.support,
      verdict === "supported" ? "supported" : "not_verified",
    );
    if (verdict === "not_addressed")
      assert.equal(result.evidenceGap, "not_addressed");
  }
});

test("one-click corrections for materials must quote an inspected passage", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const sentence = "The class had 24 students.";
  const saved = await source(ws, sentence);
  const doc = await draft(ws, "Every class has 24 students.");
  for (const quote of [sentence, "Every class has 100 students."]) {
    const run = await engineRun(ws, doc.versionId, [saved.selection], {
      sourcePolicy: "user_supplied",
      checkScope: "selected_library",
      claimSpans: [{ start: 0, end: doc.text.length }],
    });
    await processRun(db, saved.blobs, ws, run.id, {
      judge: async (claim, _item, passages) => ({
        ...claim,
        method: "Jev",
        status: "overstated",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "The claim generalizes beyond the material.",
        fixKind: "quotation",
        fix: `The source states, "${quote}".`,
        evidenceExcerpt: quote,
      }),
      research: noResearch,
      resolveReferences: noResolution,
    });
    const result = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(!!result.fix, quote === sentence);
    if (result.fix) {
      const applied = await applyFix(db, ws, doc.id, doc.versionId, result.id);
      assert.equal(applied.text, `The source states, "${sentence}".`);
      // Restore the original through a new version for the next assessment.
      await db.query(
        "UPDATE documents SET current_version_id=$3 WHERE workspace_id=$1 AND id=$2",
        [ws, doc.id, doc.versionId],
      );
    }
  }
});

test("exhausted research budget produces an explained partial result", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const { HttpError } = await import("../server/backend/config.js");
  const ws = await workspace(db, randomUUID());
  const doc = await draft(ws);
  const run = await engineRun(ws, doc.versionId, [], {
    mode: "fact_check",
    externalAccess: "research",
    sourcePolicy: "academic",
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  await processRun(db, memoryBlobs().blobs, ws, run.id, {
    judge: async () => {
      throw Error("No passage was available");
    },
    research: async () => {
      throw new HttpError(429, "Run provider-call budget exhausted.");
    },
    resolveReferences: noResolution,
  });
  assert.equal((await ownedRun(db, ws, run.id)).status, "partial");
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.evidenceGap, "check_incomplete");
  assert.equal(result.support, "not_verified");
});

test("a successfully retrieved reference is no longer counted as unresolved", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const saved = await source(ws);
  await authorizeSource(ws, saved.id, "Brown");
  const doc = await draft(ws, "The review included 218 studies (Brown 2024).");
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    externalAccess: "resolve_selected_references",
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  const ref = randomUUID();
  await db.query(
    "UPDATE runs SET config=jsonb_set(config,'{references}',$2::jsonb) WHERE id=$1",
    [run.id, JSON.stringify([{ id: ref, status: "matched_needs_pdf" }])],
  );
  await processRun(db, saved.blobs, ws, run.id, {
    judge: async (claim, _item, passages) => ({
      ...claim,
      method: "Jev",
      status: "supported",
      evidence: passages![0],
      checkedPassages: passages,
      explanation: "The source reports 218 studies.",
    }),
    research: noResearch,
    resolveReferences: async () => ({
      selections: [saved.selection],
      candidates: [
        {
          referenceEntryId: ref,
          url: "https://doi.org/10.1000/test",
          searchIntents: ["selected_reference"],
          assetId: saved.id,
          title: "Review",
          status: "promising",
          eligibility: "eligible",
        },
      ],
      notices: [],
    }),
  });
  const finished = await ownedRun(db, ws, run.id);
  assert.equal(finished.status, "complete");
  assert.deepEqual(finished.coverage.unresolvedReferences, []);
});

test("support aggregation preserves contradiction and rejects evidence outside the assessment packet", async () => {
  const { combineSupport, assertEvidence } =
    await import("../server/backend/engine.js");
  assert.equal(combineSupport(["supported", "contradicted"]), "mixed");
  assert.equal(combineSupport(["partial", "contradicted"]), "mixed");
  assert.equal(
    combineSupport(["not_verified", "contradicted"]),
    "contradicted",
  );
  assert.equal(combineSupport(["supported", "not_verified"]), "supported");
  assert.equal(combineSupport([]), "not_verified");
  const finding = {
    id: "claim",
    text: "Some claim",
    start: 0,
    end: 10,
    citations: [],
    method: "Jev" as const,
    status: "supported" as const,
    explanation: "Evidence is exact.",
    evidence: "Invented evidence",
  };
  assert.throws(() => assertEvidence(finding, []), /outside its input packet/);
  assert.throws(
    () =>
      assertEvidence(
        {
          ...finding,
          evidence: undefined,
          checkedPassages: ["Invented checked passage"],
        },
        [],
      ),
    /unchecked passage/,
  );
});

test("alternative source support cannot silently validate the cited work", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const cited = await source(
    ws,
    "The cited work discusses recruitment methods without testing exercise benefits.",
  );
  const alternative = await source(
    ws,
    "The alternative study found exercise reduced depression in its sample.",
  );
  await authorizeSource(ws, cited.id, "Brown");
  await authorizeSource(ws, alternative.id, "Green");
  const doc = await draft(ws, "Exercise reduces depression (Brown 2024).");
  const run = await engineRun(
    ws,
    doc.versionId,
    [cited.selection, alternative.selection],
    { claimSpans: [{ start: 0, end: doc.text.length }] },
  );
  await processRun(db, cited.blobs, ws, run.id, {
    judge: async (claim, item, passages) => ({
      ...claim,
      method: "Jev",
      status: item.id === alternative.id ? "supported" : "not_addressed",
      evidence: passages![0],
      checkedPassages: passages,
      explanation: "Checked the selected work.",
    }),
    research: noResearch,
    resolveReferences: noResolution,
  });
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.support, "not_verified");
  assert.equal(result.citation, "wrong_source");
  assert.ok(
    result.evidence.some(
      (e: { assetId: string; role: string }) =>
        e.assetId === alternative.id && e.role === "alternative",
    ),
  );
});

test("fact checking retains supporting and contradicting research in a mixed finding", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const support = await source(
    ws,
    "This controlled study found exercise reduced depression in the studied group.",
  );
  const contradiction = await source(
    ws,
    "This controlled study found no reduction in depression from exercise.",
  );
  await authorizeSource(ws, support.id, "Brown");
  await authorizeSource(ws, contradiction.id, "Green");
  const doc = await draft(
    ws,
    "Exercise reduces depression in all populations.",
  );
  const run = await engineRun(ws, doc.versionId, [], {
    mode: "fact_check",
    externalAccess: "research",
    sourcePolicy: "academic",
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  await processRun(db, support.blobs, ws, run.id, {
    judge: async (claim, item, passages) => ({
      ...claim,
      method: "Jev",
      status: item.id === support.id ? "supported" : "contradicted",
      evidence: passages![0],
      checkedPassages: passages,
      explanation: "Checked the research passage.",
    }),
    research: async () => ({
      selections: [support.selection, contradiction.selection],
      candidates: [],
      notices: [],
    }),
    resolveReferences: noResolution,
  });
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.support, "mixed");
  assert.equal(result.citation, "not_checked");
  assert.equal(result.eligibility, "eligible");
  assert.ok(
    result.evidence.some(
      (e: { support: string }) => e.support === "contradicted",
    ),
  );
  assert.ok(
    result.evidence.some((e: { support: string }) => e.support === "supported"),
  );
  assert.equal((await ownedRun(db, ws, run.id)).status, "complete");
});

test("provider-disabled runs remain partial and never call research or the judge", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    allowProviderProcessing: false,
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  await processRun(db, saved.blobs, ws, run.id, {
    judge: async () => {
      throw new Error("Judge must not be called");
    },
    research: async () => {
      throw new Error("Research must not be called");
    },
    resolveReferences: async () => {
      throw new Error("Resolution must not be called");
    },
  });
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.support, "not_verified");
  assert.equal(result.processing, "partial");
  assert.deepEqual(result.checkedPassageIds, []);
  assert.equal((await ownedRun(db, ws, run.id)).status, "partial");
});

test("engine rejects fabricated evidence before saving an assessment or finding", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  await assert.rejects(
    processRun(db, saved.blobs, ws, run.id, {
      judge: async (claim) => ({
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: "Invented source evidence",
        explanation: "Fabricated support.",
      }),
      research: noResearch,
      resolveReferences: noResolution,
    }),
    /outside its input packet/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM assessments WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM findings WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    0,
  );
});

test("a supported work with an unsupported cited page reports wrong locator and assesses pages separately", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const saved = await source(
    ws,
    "CITED PAGE discusses recruitment methods without testing exercise outcomes.",
  );
  await authorizeSource(ws, saved.id, "Brown");
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [saved.extractionId],
  );
  await db.query(
    "UPDATE extractions SET coverage=jsonb_set(coverage,'{totalPages}','2') WHERE id=$1",
    [saved.extractionId],
  );
  const pageId = randomUUID(),
    passageId = randomUUID();
  const supportingText =
    "OTHER PAGE found exercise reduces depression in the study population.";
  await db.query(
    "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label,label_status,text,status) VALUES($1,$2,$3,2,'2','confirmed',$4,'readable')",
    [pageId, ws, saved.extractionId, supportingText],
  );
  await db.query(
    "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
    [
      passageId,
      ws,
      saved.extractionId,
      pageId,
      supportingText.length,
      supportingText,
    ],
  );
  const doc = await draft(ws, "Exercise reduces depression (Brown 1).");
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  let calls = 0;
  await processRun(db, saved.blobs, ws, run.id, {
    judge: async (claim, _item, passages) => {
      calls++;
      assert.ok(
        !(
          passages!.some((p) => p.startsWith("CITED PAGE")) &&
          passages!.some((p) => p.startsWith("OTHER PAGE"))
        ),
        "The cited page needs its own assessment",
      );
      return {
        ...claim,
        method: "Jev",
        status: passages![0].startsWith("OTHER PAGE")
          ? "supported"
          : "not_addressed",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Checked physical page.",
      };
    },
    research: noResearch,
    resolveReferences: noResolution,
  });
  assert.equal(calls, 2);
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.support, "supported");
  assert.equal(result.citation, "wrong_locator");
});

test("an interrupted run resumes saved claims and findings without reassessing completed work", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws);
  const first = "The study includes 218 participants.",
    second = "The review reports detailed recruitment methods.";
  const doc = await draft(ws, `${first}\n\n${second}`);
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    claimSpans: [
      { start: 0, end: first.length },
      { start: first.length + 2, end: doc.text.length },
    ],
  });
  const assessed: string[] = [];
  let interrupt = true;
  const judge: typeof import("../server/judge.js").judgeClaim = async (
    claim,
    _item,
    passages,
  ) => {
    assessed.push(claim.text);
    if (interrupt && claim.text === second)
      throw new Error("Simulated worker interruption");
    return {
      ...claim,
      method: "Jev",
      status: "supported",
      evidence: passages![0],
      checkedPassages: passages,
      explanation: "Checked source passage.",
    };
  };
  const deps = { judge, research: noResearch, resolveReferences: noResolution };
  await assert.rejects(
    processRun(db, saved.blobs, ws, run.id, deps),
    /Simulated worker interruption/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM findings WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    1,
  );
  interrupt = false;
  await processRun(db, saved.blobs, ws, run.id, deps);
  assert.equal(assessed.filter((text) => text === first).length, 1);
  assert.equal(assessed.filter((text) => text === second).length, 2);
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM claims WHERE run_id=$1", [
        run.id,
      ])
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM findings WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    2,
  );
  assert.equal((await ownedRun(db, ws, run.id)).status, "complete");
});

test("provider retries persist separate provider usage and keep uncertain charges explicit", async (t) => {
  const { providerContext, providerFetch } =
    await import("../server/backend/providers.js");
  const ws = await workspace(db, randomUUID()),
    doc = await draft(ws);
  const run = await engineRun(ws, doc.versionId, [], {
    mode: "fact_check",
    externalAccess: "research",
    sourcePolicy: "academic",
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    calls++;
    if (calls === 1) return new Response("Temporary error", { status: 503 });
    return new Response(
      JSON.stringify(
        String(input).includes("typesafe")
          ? { usage: { input_tokens: 1000 } }
          : { costDollars: { total: 0.007 } },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  await providerContext.run(
    {
      db,
      ws,
      run: run.id,
      signal: new AbortController().signal,
      maxCalls: 3,
      model: "test",
    },
    async () => {
      assert.equal(
        (await providerFetch("https://api.exa.ai/search")).status,
        200,
      );
      assert.equal(
        (await providerFetch("https://api.typesafe.ai/check")).status,
        200,
      );
      await assert.rejects(
        providerFetch("https://api.exa.ai/search"),
        status(429),
      );
    },
  );
  assert.equal(calls, 3);
  const ledger = (
    await db.query(
      "SELECT provider,status,usage FROM provider_calls WHERE run_id=$1 ORDER BY created_at",
      [run.id],
    )
  ).rows;
  assert.equal(ledger.filter((row) => row.provider === "exa").length, 2);
  assert.equal(ledger.filter((row) => row.provider === "jev").length, 1);
  assert.ok(
    ledger.some(
      (row) => row.status === "http_503" && row.usage.charge === "unknown",
    ),
  );
  assert.ok(
    ledger.some(
      (row) => row.provider === "exa" && row.usage.costDollars?.total === 0.007,
    ),
  );
  assert.ok(
    ledger.some((row) => row.provider === "jev" && row.usage.estimatedUsd > 0),
  );
});

test("provider failures and cancellation finish ledger attempts without inventing charges", async (t) => {
  const { providerContext, providerFetch } =
    await import("../server/backend/providers.js");
  const ws = await workspace(db, randomUUID()),
    doc = await draft(ws);
  const run = await engineRun(ws, doc.versionId, [], {
    mode: "fact_check",
    externalAccess: "research",
    sourcePolicy: "academic",
  });
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++attempts === 2) controller.abort();
    throw new TypeError("Simulated connection reset");
  });
  await providerContext.run(
    {
      db,
      ws,
      run: run.id,
      signal: controller.signal,
      maxCalls: 4,
      model: "test",
    },
    async () => {
      await assert.rejects(
        providerFetch("https://api.exa.ai/search"),
        /Simulated connection reset/,
      );
    },
  );
  const ledger = (
    await db.query(
      "SELECT status,usage FROM provider_calls WHERE run_id=$1 ORDER BY created_at",
      [run.id],
    )
  ).rows;
  assert.deepEqual(
    ledger.map((row) => row.status),
    ["network_error", "cancelled"],
  );
  assert.ok(ledger.every((row) => row.usage.charge === "unknown"));
  assert.equal(attempts, 2);
});

test("provider boundary rejects processing without consent and unrelated source-check research", async (t) => {
  const { providerContext, providerFetch } =
    await import("../server/backend/providers.js");
  const ws = await workspace(db, randomUUID()),
    saved = await source(ws),
    doc = await draft(ws);
  const noConsent = await engineRun(ws, doc.versionId, [saved.selection], {
    allowProviderProcessing: false,
  });
  const sourceCheck = await engineRun(ws, doc.versionId, [saved.selection]);
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network call");
  });
  for (const [run, url] of [
    [noConsent, "https://api.typesafe.ai/check"],
    [sourceCheck, "https://api.exa.ai/search"],
  ] as const) {
    await providerContext.run(
      {
        db,
        ws,
        run: run.id,
        signal: new AbortController().signal,
        maxCalls: 5,
        model: "test",
      },
      async () => {
        await assert.rejects(providerFetch(url), status(403));
      },
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM provider_calls WHERE run_id=$1",
          [run.id],
        )
      ).rows[0].n,
      0,
    );
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("concurrent ingestion returns the same persisted extraction to both callers", async () => {
  const ws = await workspace(db, randomUUID()),
    base = memoryBlobs();
  const body = Buffer.from(
    "The readable source reports 218 participants in this controlled study.",
  );
  const saved = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      { title: "Concurrent source", authors: [], year: "2024" },
      "source.txt",
      "text/plain",
      body.length,
    ),
  );
  await base.blobs.put(saved.key, body, "text/plain");
  let arrivals = 0,
    release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blobs: BlobStore = {
    ...base.blobs,
    async get(key) {
      const value = await base.blobs.get(key);
      arrivals++;
      if (arrivals === 2) release!();
      await barrier;
      return value;
    },
  };
  const [first, second] = await Promise.all([
    ingestAsset(db, blobs, ws, saved.id),
    ingestAsset(db, blobs, ws, saved.id),
  ]);
  assert.equal(first, second);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM extractions WHERE asset_id=$1 AND id=$2",
        [saved.id, first],
      )
    ).rows[0].n,
    1,
  );
});

test("deleting a bibliography upload removes copied import versions and their dependent reports", async () => {
  const ws = await workspace(db, randomUUID());
  const bibliography = await source(
    ws,
    'Brown, Alice. "Private paper title." Journal, 2024.',
  );
  const evidence = await source(ws),
    doc = await draft(ws);
  const original = randomUUID(),
    corrected = randomUUID();
  const privateText = 'Brown, Alice. "Private paper title." Journal, 2024.';
  for (const [id, version] of [
    [original, 1],
    [corrected, 2],
  ] as const) {
    await db.query(
      "INSERT INTO reference_imports(id,workspace_id,version,status,original,settings) VALUES($1,$2,$3,'complete',$4,$5)",
      [
        id,
        ws,
        version,
        privateText,
        JSON.stringify({ originAssetId: bibliography.id }),
      ],
    );
    await db.query(
      "INSERT INTO reference_entries(id,workspace_id,import_id,ordinal,original,parsed,status) VALUES($1,$2,$3,0,$4,'{}','unidentified')",
      [randomUUID(), ws, id, privateText],
    );
  }
  await db.query(
    "INSERT INTO source_imports(id,workspace_id,kind,status,input) VALUES($1,$2,'bibliography','complete',$3)",
    [original, ws, JSON.stringify({ assetId: bibliography.id })],
  );
  const run = await engineRun(ws, doc.versionId, [evidence.selection], {
    referenceImportVersionId: corrected,
  });
  await deleteAsset(db, ws, bibliography.id);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM reference_imports WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM reference_entries WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(ownedRun(db, ws, run.id), status(404));
});

test("mixed evidence never offers a numeric edit from one conflicting passage", async () => {
  const { processRun } = await import("../server/backend/engine.js");
  const ws = await workspace(db, randomUUID());
  const saved = await source(
    ws,
    "CITED PAGE reports a review of 218 studies with rigorous inclusion criteria.",
  );
  await authorizeSource(ws, saved.id, "Brown");
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [saved.extractionId],
  );
  const pageId = randomUUID(),
    supportingText =
      "OTHER PAGE reports a review of 300 studies with rigorous inclusion criteria.";
  await db.query(
    "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label,label_status,text,status) VALUES($1,$2,$3,2,'2','confirmed',$4,'readable')",
    [pageId, ws, saved.extractionId, supportingText],
  );
  await db.query(
    "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
    [
      randomUUID(),
      ws,
      saved.extractionId,
      pageId,
      supportingText.length,
      supportingText,
    ],
  );
  const doc = await draft(ws, "The review included 300 studies (Brown 1).");
  const run = await engineRun(ws, doc.versionId, [saved.selection], {
    claimSpans: [{ start: 0, end: doc.text.length }],
  });
  await processRun(db, saved.blobs, ws, run.id, {
    judge: async (claim, _item, passages) => {
      const mismatch = passages![0].startsWith("CITED PAGE"),
        start = claim.text.indexOf("300");
      return {
        ...claim,
        method: "Jev",
        status: mismatch ? "numeric_mismatch" : "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Compared the study count.",
        ...(mismatch
          ? {
              fixKind: "number" as const,
              fix: claim.text.replace("300", "218"),
              numericCorrection: {
                from: "300",
                to: "218",
                unit: "studies",
                start,
                end: start + 3,
              },
            }
          : {}),
      };
    },
    research: noResearch,
    resolveReferences: noResolution,
  });
  const result = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(result.support, "mixed");
  assert.equal(result.fix, undefined);
});

test("the judge receives the exact surrounding paragraph for a selected claim", async (t) => {
  const { processRun } = await import("../server/backend/engine.js");
  const { judgeClaim } = await import("../server/judge.js");
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-only-not-a-real-key";
  try {
    const ws = await workspace(db, randomUUID()),
      saved = await source(ws);
    const paragraph =
      "Only adults over 65 participated in the 2024 study. It increased by 20%.";
    const doc = await draft(ws, paragraph),
      start = paragraph.indexOf("It increased");
    const run = await engineRun(ws, doc.versionId, [saved.selection], {
      claimSpans: [{ start, end: paragraph.length }],
    });
    const requests: any[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (_input: unknown, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ answers: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    await processRun(db, saved.blobs, ws, run.id, {
      judge: judgeClaim,
      research: noResearch,
      resolveReferences: noResolution,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].state.claim, "It increased by 20%.");
    assert.equal(requests[0].state.paragraphContext, paragraph);
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});
