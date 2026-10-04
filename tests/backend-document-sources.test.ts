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
import { queueDocumentSources } from "../server/backend/document-sources.js";
import { importReferences } from "../server/backend/references.js";
import { importDocumentSources } from "../server/backend/imported-sources.js";
import { processImport } from "../server/backend/imports.js";
import { createRun } from "../server/backend/service.js";
import type { BlobStore } from "../server/backend/storage.js";
import type { Source } from "../shared/types.js";
import { runInput } from "../shared/backend.js";

let db: Database;
const files = new Map<string, Buffer>();
const blobs: BlobStore = {
  async put(key, body) {
    files.set(key, Buffer.from(body));
  },
  async get(key) {
    const body = files.get(key);
    assert.ok(body);
    return body;
  },
  async delete(key) {
    files.delete(key);
  },
};
function adapter(pg: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) {
        const result = await pg.query(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows };
      }
      const result = (await pg.exec(sql)).at(-1);
      return { rows: result?.rows || [], rowCount: result?.affectedRows };
    },
  };
}
before(async () => {
  const pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
});
after(async () => {
  await db.close();
});
async function references(
  ws: string,
  documentId: string,
  text: string,
  external = false,
) {
  await db.query(
    "INSERT INTO documents(id,workspace_id,title) VALUES($1,$2,'Fixture work') ON CONFLICT DO NOTHING",
    [documentId, ws],
  );
  const id = await db.transaction((tx) =>
    queueDocumentSources(tx, ws, documentId, text, external),
  );
  assert.ok(id);
  const original = (
    await db.query("SELECT original FROM reference_imports WHERE id=$1", [id])
  ).rows[0].original;
  await importReferences(db, ws, id, original, false);
  return id;
}
function resolved(doi: string): Source {
  return {
    id: randomUUID(),
    title: "Verified study",
    authors: ["Jane Smith"],
    authorDetails: [{ family: "Smith", given: "Jane" }],
    year: "2024",
    journal: "Evidence Journal",
    volume: "4",
    issue: "2",
    pages: "21-28",
    doi,
    url: `https://doi.org/${doi}`,
    access: "full_text",
    passages: [
      "The experiment showed a measurable improvement in the tested population.",
    ],
    provider: "Fixture",
    retrievedAt: new Date().toISOString(),
  };
}
const deps = {
  async resolveDOI(doi: string) {
    return resolved(doi);
  },
  async remoteFile(url: string) {
    return {
      url,
      type: "text/plain",
      buffer: Buffer.from(
        "This source provides detailed evidence for the claim in the draft.",
      ),
    };
  },
};

test("automatic import without external permission stores separate references but no fabricated passages", async () => {
  const ws = await workspace(db, randomUUID()),
    documentId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title) VALUES($1,$2,'Fixture work')",
    [documentId, ws],
  );
  const id = await db.transaction((tx) =>
    queueDocumentSources(
      tx,
      ws,
      documentId,
      "Claim.\nReferences\nhttps://example.org/first\n\nhttps://example.org/second",
      false,
    ),
  );
  assert.ok(id);
  await processImport(db, blobs, ws, id);
  await processImport(db, blobs, ws, id);
  const assets = (
    await db.query("SELECT * FROM source_assets WHERE workspace_id=$1", [ws])
  ).rows;
  assert.equal(assets.length, 2);
  assert.ok(
    assets.every(
      (a) =>
        a.status === "unavailable" &&
        a.access === "unavailable" &&
        a.metadata.importedDocumentIds.includes(documentId),
    ),
  );
  assert.equal(
    (
      await db.query("SELECT * FROM source_passages WHERE workspace_id=$1", [
        ws,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT status FROM source_imports WHERE id=$1", [id]))
      .rows[0].status,
    "complete",
  );
});

test("retrieved references are indexed separately for each work and attached to checker runs", async () => {
  const ws = await workspace(db, randomUUID()),
    documentId = randomUUID(),
    version = randomUUID();
  const text =
    "The experiment showed an improvement (Smith 2024).\nReferences\nhttps://doi.org/10.1234/study\n\nhttps://example.org/evidence";
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,'Imported work',$3)",
    [documentId, ws, version],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [version, ws, documentId, text],
  );
  const id = await references(ws, documentId, text, true);
  await importDocumentSources(db, blobs, ws, id, documentId, true, deps);
  await importDocumentSources(db, blobs, ws, id, documentId, true, deps);
  const nextDocument = randomUUID();
  const next = await references(ws, nextDocument, text, true);
  await importDocumentSources(db, blobs, ws, next, nextDocument, true, deps);
  const assets = (
    await db.query("SELECT * FROM source_assets WHERE workspace_id=$1", [ws])
  ).rows;
  assert.equal(assets.length, 4);
  assert.ok(
    assets.every(
      (a) =>
        a.status === "ready" &&
        a.access === "full_text" &&
        a.metadata.importedDocumentIds.length === 1,
    ),
  );
  const article = assets.find((a) => a.metadata.doi === "10.1234/study");
  assert.deepEqual(article.metadata.authorDetails, [
    { family: "Smith", given: "Jane" },
  ]);
  const articleReference = (
    await db.query(
      "SELECT parsed FROM reference_entries WHERE workspace_id=$1 AND asset_id=$2 LIMIT 1",
      [ws, article.id],
    )
  ).rows[0];
  for (const metadata of [article.metadata, articleReference.parsed]) {
    assert.equal(metadata.containerTitle, "Evidence Journal");
    assert.equal(metadata.volume, "4");
    assert.equal(metadata.issue, "2");
    assert.equal(metadata.pages, "21-28");
  }
  assert.deepEqual(articleReference.parsed.authorDetails, [
    { family: "Smith", given: "Jane" },
  ]);
  assert.ok(
    (
      await db.query("SELECT text FROM source_passages WHERE workspace_id=$1", [
        ws,
      ])
    ).rows.some((p) => p.text.includes("measurable improvement")),
  );
  const created = await createRun(
    db,
    ws,
    runInput.parse({
      documentVersionId: version,
      mode: "source_check",
      referenceImportVersionId: id,
      allowProviderProcessing: true,
    }),
    randomUUID(),
  );
  const run = (
    await db.query("SELECT input FROM runs WHERE workspace_id=$1 AND id=$2", [
      ws,
      created.id,
    ])
  ).rows[0];
  assert.equal(run.input.selectedSources.length, 2);
  const excludedId = assets.find((a) =>
    a.metadata.importedDocumentIds.includes(documentId),
  )!.id;
  const excludedRun = await createRun(
    db,
    ws,
    runInput.parse({
      documentVersionId: version,
      mode: "source_check",
      referenceImportVersionId: id,
      allowProviderProcessing: true,
      excludedSourceIds: [excludedId],
    }),
    randomUUID(),
  );
  const excludedInput = (
    await db.query("SELECT input FROM runs WHERE workspace_id=$1 AND id=$2", [
      ws,
      excludedRun.id,
    ])
  ).rows[0].input;
  assert.equal(excludedInput.selectedSources.length, 1);
  assert.equal(
    excludedInput.selectedSources.some(
      (source: { assetId: string }) => source.assetId === excludedId,
    ),
    false,
  );
});

test("a failed retrieval does not prevent another source being imported; abstracts retain their access level", async () => {
  const ws = await workspace(db, randomUUID()),
    documentId = randomUUID();
  const id = await references(
    ws,
    documentId,
    "References\nhttps://doi.org/10.1234/abstract\n\nhttps://example.org/failure\n\nhttps://example.org/good",
    true,
  );
  await importDocumentSources(db, blobs, ws, id, documentId, true, {
    async resolveDOI(doi) {
      return { ...resolved(doi), access: "abstract" };
    },
    async remoteFile(url) {
      if (url.includes("failure")) throw new Error("Provider unavailable");
      return deps.remoteFile(url);
    },
  });
  const assets = (
    await db.query("SELECT * FROM source_assets WHERE workspace_id=$1", [ws])
  ).rows;
  assert.equal(assets.filter((a) => a.status === "ready").length, 2);
  assert.equal(assets.find((a) => a.metadata.doi)?.access, "abstract");
  assert.match(
    assets.find((a) => a.status === "unavailable")?.metadata.importNotice,
    /Provider unavailable/,
  );
});

test("source migration recovers historic associations once without restoring removals", async () => {
  const ws = await workspace(db, randomUUID());
  const documentId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title) VALUES($1,$2,'Historic work')",
    [documentId, ws],
  );
  const id = await references(
    ws,
    documentId,
    "Claim.\nReferences\nhttps://example.org/historic",
  );
  await importDocumentSources(db, blobs, ws, id, documentId, false, deps);
  await db.query("DROP TABLE document_sources");
  await migrate(db);
  const { rows } = await db.query(
    "SELECT asset_id FROM document_sources WHERE workspace_id=$1 AND document_id=$2",
    [ws, documentId],
  );
  assert.equal(rows.length, 1);
  await db.query(
    "DELETE FROM document_sources WHERE workspace_id=$1 AND document_id=$2",
    [ws, documentId],
  );
  await migrate(db);
  assert.equal(
    (
      await db.query(
        "SELECT asset_id FROM document_sources WHERE workspace_id=$1 AND document_id=$2",
        [ws, documentId],
      )
    ).rows.length,
    0,
  );
});
