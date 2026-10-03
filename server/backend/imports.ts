import type { Database } from "./db.js";
import type { BlobStore } from "./storage.js";
import { asset, ingestAsset } from "./library.js";
import { importReferences } from "./references.js";
import { HttpError, notFound } from "./config.js";
import { remoteFile } from "../remote.js";
import { importDocumentSources } from "./imported-sources.js";

async function imported(db: Database, ws: string, id: string) {
  const row = (
    await db.query(
      "SELECT * FROM source_imports WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}

export async function processImport(
  db: Database,
  blobs: BlobStore,
  ws: string,
  id: string,
) {
  let row = await imported(db, ws, id);
  if (row.status === "complete") return;
  await db.query(
    "UPDATE source_imports SET status='processing' WHERE workspace_id=$1 AND id=$2",
    [ws, id],
  );
  const input = row.input;
  if (row.kind === "bibliography") {
    let text = input.text || "";
    let extractionId: string | undefined;
    if (input.assetId) {
      extractionId = await ingestAsset(db, blobs, ws, input.assetId);
      const pages = (
        await db.query(
          "SELECT text FROM source_pages WHERE workspace_id=$1 AND extraction_id=$2 ORDER BY page_index",
          [ws, extractionId],
        )
      ).rows;
      text = pages.map((page) => page.text).join("\f");
    }
    if (!text.trim())
      throw new HttpError(422, "The bibliography has no readable text.");
    await db.query(
      "UPDATE reference_imports SET original=$3,status='processing' WHERE workspace_id=$1 AND id=$2",
      [ws, id, text],
    );
    await importReferences(db, ws, id, text, input.externalAccess === true);
    if (input.automatic && input.documentId)
      await importDocumentSources(
        db,
        blobs,
        ws,
        id,
        input.documentId,
        input.externalAccess === true,
      );
    const coverage = extractionId
      ? (
          await db.query(
            "SELECT coverage FROM extractions WHERE workspace_id=$1 AND id=$2",
            [ws, extractionId],
          )
        ).rows[0]?.coverage
      : undefined;
    await db.query(
      "UPDATE source_imports SET status='complete',result=$3 WHERE workspace_id=$1 AND id=$2",
      [
        ws,
        id,
        JSON.stringify({
          referenceImportVersionId: id,
          extractionId,
          coverage,
          stage: "complete",
        }),
      ],
    );
    return;
  }

  // The intake route allocates an asset once. Retries only reuse that asset.
  if (!input.assetId)
    throw new HttpError(422, "The import has no source asset.");
  if ((row.kind === "text" && input.text !== undefined) || row.kind === "url") {
    if (!row.result.sourceStored) {
      let body: Buffer;
      let filename = "source.txt";
      let mediaType = "text/plain";
      let fetchedUrl: string | undefined;
      if (row.kind === "url") {
        if (!input.externalAccess || !input.url)
          throw new HttpError(
            403,
            "External access was not approved for this import.",
          );
        const file = await remoteFile(input.url);
        body = file.buffer;
        fetchedUrl = file.url;
        mediaType = file.type.split(";")[0].trim().toLowerCase();
        if (body.subarray(0, 1024).toString().includes("%PDF-")) {
          filename = "snapshot.pdf";
          mediaType = "application/pdf";
        } else if (
          mediaType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
          filename = "snapshot.docx";
        else if (["text/html", "application/xhtml+xml"].includes(mediaType))
          filename = "snapshot.html";
        else if (
          [
            "text/plain",
            "text/markdown",
            "application/xml",
            "text/xml",
          ].includes(mediaType)
        )
          filename = mediaType.includes("xml")
            ? "snapshot.xml"
            : "snapshot.txt";
        else
          throw new HttpError(
            422,
            "The URL did not return a supported document type.",
          );
      } else {
        if (!input.text?.trim())
          throw new HttpError(422, "The import has no source text.");
        body = Buffer.from(input.text, "utf8");
      }
      await db.transaction(async (tx) => {
        // Deletion takes the asset lock before removing its import. Use the same order.
        const currentAsset = await asset(tx, ws, input.assetId, true);
        const current = (
          await tx.query(
            "SELECT result FROM source_imports WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [ws, id],
          )
        ).rows[0];
        if (!current) throw notFound();
        if (current.result.sourceStored || currentAsset.status === "ready")
          return;
        await blobs.put(currentAsset.object_key, body, mediaType);
        await tx.query(
          "UPDATE source_assets SET filename=$3,media_type=$4,expected_bytes=$5,status='queued',access=$6,metadata=metadata || $7::jsonb WHERE workspace_id=$1 AND id=$2",
          [
            ws,
            input.assetId,
            filename,
            mediaType,
            body.length,
            "uploaded",
            JSON.stringify(
              fetchedUrl
                ? { sourceUrl: fetchedUrl, fetchedAt: new Date().toISOString() }
                : {},
            ),
          ],
        );
        await tx.query(
          "UPDATE source_imports SET result=result || $3::jsonb WHERE workspace_id=$1 AND id=$2",
          [ws, id, JSON.stringify({ sourceStored: true, stage: "extract" })],
        );
      });
    }
  }
  const extractionId = await ingestAsset(db, blobs, ws, input.assetId);
  const coverage = (
    await db.query(
      "SELECT coverage FROM extractions WHERE workspace_id=$1 AND id=$2",
      [ws, extractionId],
    )
  ).rows[0]?.coverage;
  await db.query(
    "UPDATE source_imports SET status='complete',result=result || $3::jsonb WHERE workspace_id=$1 AND id=$2",
    [
      ws,
      id,
      JSON.stringify({
        assetId: input.assetId,
        extractionId,
        coverage,
        stage: "complete",
      }),
    ],
  );
}
