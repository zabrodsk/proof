import { createHash, randomUUID } from "node:crypto";
import type { Database, Sql } from "./db.js";
import { enqueue } from "./db.js";
import type { BlobStore } from "./storage.js";
import { extractFile, passageSpans } from "./extraction.js";
import { ocrUnreadable } from "./ocr.js";
import { embed, vector } from "./embeddings.js";
import { limits, versions, notFound, HttpError } from "./config.js";
import type { SourceMetadata } from "../../shared/backend.js";
export const checksum = (body: Buffer | string) =>
  createHash("sha256").update(body).digest("hex");
export async function createAsset(
  tx: Sql,
  ws: string,
  metadata: SourceMetadata,
  filename: string,
  type: string,
  bytes?: number,
  id = randomUUID(),
) {
  const work = randomUUID(),
    version = randomUUID(),
    key = `${ws}/${id}/upload`;
  await tx.query(
    "INSERT INTO source_works(id,workspace_id,metadata) VALUES($1,$2,$3)",
    [work, ws, JSON.stringify(metadata)],
  );
  await tx.query(
    "INSERT INTO source_versions(id,workspace_id,work_id,metadata) VALUES($1,$2,$3,$4)",
    [version, ws, work, JSON.stringify(metadata)],
  );
  await tx.query(
    "INSERT INTO source_assets(id,workspace_id,version_id,object_key,filename,media_type,expected_bytes,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      ws,
      version,
      key,
      filename,
      type,
      bytes,
      JSON.stringify({ ...metadata, uploadExpiresAt: Date.now() + 900_000 }),
    ],
  );
  return { id, workId: work, versionId: version, key };
}
export async function asset(db: Sql, ws: string, id: string, lock = false) {
  const r = await db.query(
    `SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [ws, id],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}
export async function ingestAsset(
  db: Database,
  blobs: BlobStore,
  ws: string,
  id: string,
) {
  const a = await asset(db, ws, id);
  const existing = await db.query(
    "SELECT id,status FROM extractions WHERE workspace_id=$1 AND asset_id=$2 AND parser_version=$3",
    [ws, id, versions.parser],
  );
  if (
    existing.rows[0] &&
    ["complete", "partial"].includes(existing.rows[0].status)
  )
    return existing.rows[0].id;
  const body = await blobs.get(a.object_key);
  if (
    body.length > limits.fileBytes ||
    (a.expected_bytes && Number(a.expected_bytes) !== body.length)
  )
    throw new Error("Uploaded file size does not match the upload intent.");
  const hash = checksum(body);
  if (a.checksum && a.checksum !== hash)
    throw new Error("Uploaded file checksum changed.");
  let parsed = await extractFile(body, a.filename);
  if (
    a.filename.toLowerCase().endsWith(".pdf") &&
    parsed.coverage.unreadablePages.length
  ) {
    const attempts = new Map<string, string>();
    const ocr = await ocrUnreadable(body, parsed, {
      allowExternalProcessing: a.metadata.allowExternalProcessing === true,
      onUsage: async (usage) => {
        const key = `${usage.pageIndex}:${usage.attempt}`;
        await db.transaction(async (tx) => {
          await asset(tx, ws, id, true);
          if (usage.status === "started") {
            const count = (
              await tx.query(
                "SELECT count(*)::int AS n FROM asset_provider_calls WHERE workspace_id=$1 AND asset_id=$2",
                [ws, id],
              )
            ).rows[0].n;
            if (count >= 40)
              throw new HttpError(
                429,
                "OCR attempt budget exhausted for this asset.",
              );
            const call = randomUUID();
            attempts.set(key, call);
            await tx.query(
              "INSERT INTO asset_provider_calls(id,workspace_id,asset_id,provider,usage) VALUES($1,$2,$3,'firecrawl',$4)",
              [call, ws, id, JSON.stringify(usage)],
            );
          } else
            await tx.query(
              "UPDATE asset_provider_calls SET usage=$3 WHERE workspace_id=$1 AND id=$2",
              [ws, attempts.get(key), JSON.stringify(usage)],
            );
        });
      },
    });
    parsed = ocr.parsed;
  }
  const extractionId = existing.rows[0]?.id || randomUUID();
  const passages = await Promise.all(
    parsed.pages.map(async (p) => ({
      page: p,
      spans: await Promise.all(
        passageSpans(p.text).map(async (s) => ({
          ...s,
          embedding: await embed(s.text),
        })),
      ),
    })),
  );
  // Serialize final file persistence with deletion. Parsing and embedding happen outside the lock.
  await db.transaction(async (tx) => {
    const current = await asset(tx, ws, id, true);
    if (
      current.status === "ready" &&
      (
        await tx.query(
          "SELECT id FROM extractions WHERE workspace_id=$1 AND asset_id=$2 AND parser_version=$3",
          [ws, id, versions.parser],
        )
      ).rows.length
    )
      return;
    const original = `${ws}/${id}/original`;
    await blobs.put(original, body, a.media_type);
    await tx.query(
      "INSERT INTO extractions(id,workspace_id,asset_id,parser_version,status,coverage) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,asset_id,parser_version) DO NOTHING",
      [
        extractionId,
        ws,
        id,
        versions.parser,
        parsed.coverage.unreadablePages.length ||
        parsed.coverage.omittedPages.length
          ? "partial"
          : "complete",
        JSON.stringify({
          ...parsed.coverage,
          search:
            process.env.PROOF_EMBEDDINGS === "true"
              ? "text_and_vector"
              : "text_only",
        }),
      ],
    );
    for (const { page: p, spans } of passages) {
      const pageId = randomUUID();
      await tx.query(
        "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label,label_status,text,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          pageId,
          ws,
          extractionId,
          p.index,
          p.label,
          p.labelStatus,
          p.text,
          p.status,
        ],
      );
      for (const b of p.blocks)
        await tx.query(
          "INSERT INTO source_blocks(id,workspace_id,page_id,start_offset,end_offset,coordinates) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            ws,
            pageId,
            b.start,
            b.end,
            JSON.stringify(b.coordinates || null),
          ],
        );
      for (const s of spans)
        await tx.query(
          "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text,embedding,embedding_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            ws,
            extractionId,
            pageId,
            s.start,
            s.end,
            s.text,
            s.embedding ? vector(s.embedding) : null,
            s.embedding
              ? `${versions.embedding}@${process.env.PROOF_EMBEDDING_REVISION}`
              : null,
          ],
        );
    }
    await tx.query(
      "UPDATE source_assets SET object_key=$3,checksum=$4,status='ready' WHERE workspace_id=$1 AND id=$2",
      [ws, id, original, hash],
    );
  });
  // Keep the upload key until its signed URL expires. The cleanup worker removes it afterward.
  const saved = (
    await db.query(
      "SELECT id FROM extractions WHERE workspace_id=$1 AND asset_id=$2 AND parser_version=$3",
      [ws, id, versions.parser],
    )
  ).rows[0];
  if (!saved) throw notFound();
  return saved.id as string;
}
export async function deleteAsset(db: Database, ws: string, id: string) {
  await db.transaction(async (tx) => {
    const a = await asset(tx, ws, id, true);
    // Runs freeze source IDs. Remove all reports that could contain this source's excerpts.
    await tx.query(
      `DELETE FROM runs WHERE workspace_id=$1 AND (
      id=$3 OR input::text LIKE $2 OR id IN (SELECT run_id FROM research_results WHERE workspace_id=$1 AND data::text LIKE $2))`,
      [ws, `%${id}%`, a.metadata.retrievedByRunId || null],
    );
    await tx.query(
      "DELETE FROM asset_provider_calls WHERE workspace_id=$1 AND asset_id=$2",
      [ws, id],
    );
    await tx.query(
      "DELETE FROM extractions WHERE workspace_id=$1 AND asset_id=$2",
      [ws, id],
    );
    await tx.query(
      "UPDATE reference_entries SET asset_id=NULL,status='matched_needs_pdf' WHERE workspace_id=$1 AND asset_id=$2",
      [ws, id],
    );
    await tx.query(
      "DELETE FROM runs WHERE workspace_id=$1 AND input->>'referenceImportVersionId' IN (SELECT id::text FROM reference_imports WHERE workspace_id=$1 AND settings->>'originAssetId'=$2)",
      [ws, id],
    );
    await tx.query(
      "DELETE FROM reference_imports WHERE workspace_id=$1 AND (settings->>'originAssetId'=$2 OR id IN (SELECT id FROM source_imports WHERE workspace_id=$1 AND input->>'assetId'=$2))",
      [ws, id],
    );
    await tx.query(
      "DELETE FROM compatibility_jobs WHERE workspace_id=$1 AND result->'assetIds' ? $2",
      [ws, id],
    );
    await tx.query(
      "DELETE FROM source_imports WHERE workspace_id=$1 AND (input::text LIKE $2 OR result::text LIKE $2)",
      [ws, `%${id}%`],
    );
    await tx.query(
      "UPDATE source_assets SET deleted_at=now(),status='deleted',metadata='{}',filename='deleted',checksum=NULL WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    );
    await tx.query(
      "UPDATE source_versions SET metadata='{}' WHERE workspace_id=$1 AND id=$2",
      [ws, a.version_id],
    );
    await tx.query(
      "UPDATE source_works SET metadata='{}',deleted_at=now() WHERE workspace_id=$1 AND id IN (SELECT work_id FROM source_versions WHERE workspace_id=$1 AND id=$2)",
      [ws, a.version_id],
    );
    const deletion = randomUUID();
    await tx.query(
      "INSERT INTO deletion_jobs(id,workspace_id,object_keys) VALUES($1,$2,$3)",
      [
        deletion,
        ws,
        JSON.stringify({
          keys: [a.object_key, `${ws}/${id}/upload`, `${ws}/${id}/original`],
          after: Math.max(Date.now(), a.metadata.uploadExpiresAt || 0),
        }),
      ],
    );
    await enqueue(tx, ws, "delete", deletion);
  });
}
export async function validateSelection(
  db: Sql,
  ws: string,
  selections: {
    assetId: string;
    extractionId: string;
    pageRanges?: { from: number; to: number }[];
  }[],
) {
  for (const s of selections) {
    const r = await db.query(
      "SELECT e.coverage FROM extractions e JOIN source_assets a ON a.id=e.asset_id AND a.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.id=$2 AND a.id=$3 AND a.deleted_at IS NULL AND a.status='ready' AND e.status IN ('complete','partial')",
      [ws, s.extractionId, s.assetId],
    );
    if (!r.rows.length)
      throw new HttpError(
        409,
        "A selected source is unavailable or still processing.",
      );
    if (s.pageRanges?.some((p) => p.to > r.rows[0].coverage.totalPages))
      throw new HttpError(400, "A page range exceeds the selected file.");
  }
}
