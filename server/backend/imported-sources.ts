import type { Source } from "../../shared/types.js";
import { resolveDOI } from "../sources.js";
import { remoteFile } from "../remote.js";
import type { Database } from "./db.js";
import type { BlobStore } from "./storage.js";
import { asset, createAsset, ingestAsset } from "./library.js";
import { normalize } from "./references.js";

const defaults = { resolveDOI, remoteFile };

/** Materialize references supplied by the writer; metadata alone is never evidence. */
export async function importDocumentSources(
  db: Database,
  blobs: BlobStore,
  ws: string,
  importId: string,
  documentId: string,
  external: boolean,
  deps = defaults,
) {
  const entries = (
    await db.query(
      "SELECT * FROM reference_entries WHERE workspace_id=$1 AND import_id=$2 ORDER BY ordinal",
      [ws, importId],
    )
  ).rows;
  for (const entry of entries) {
    const candidate =
      entry.status === "matched_needs_pdf" && entry.candidates.length === 1
        ? entry.candidates[0]
        : undefined;
    const parsed = entry.parsed;
    const doi = parsed.doi || candidate?.doi;
    const url = doi ? `https://doi.org/${doi}` : parsed.url;
    const identity = doi
      ? `doi:${doi.toLowerCase()}`
      : url
        ? `url:${url}`
        : `reference:${normalize(entry.original)}`;
    const metadata = {
      ...parsed,
      title: candidate?.title || parsed.title || url || entry.original,
      doi,
      url,
      authors: parsed.authors || [],
      year: parsed.year || "",
      importedReference: entry.original,
      importedIdentity: identity,
    };
    const id = await db.transaction(async (tx) => {
      // Serialize allocation per workspace so simultaneous imports reuse the same source.
      await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
      const existing = (
        await tx.query(
          "SELECT id FROM source_assets WHERE workspace_id=$1 AND deleted_at IS NULL AND (id=$2 OR metadata->>'importedIdentity'=$3 OR ($4::text IS NOT NULL AND lower(metadata->>'doi')=lower($4)) OR ($5::text IS NOT NULL AND metadata->>'url'=$5)) ORDER BY (status='ready') DESC,created_at LIMIT 1",
          [ws, entry.asset_id, identity, doi || null, url || null],
        )
      ).rows[0];
      const sourceId =
        existing?.id ||
        (await createAsset(tx, ws, metadata, "reference.txt", "text/plain")).id;
      await asset(tx, ws, sourceId, true);
      await tx.query(
        "UPDATE source_assets SET metadata=metadata || jsonb_build_object('importedDocumentIds',COALESCE(metadata->'importedDocumentIds','[]'::jsonb) || CASE WHEN COALESCE(metadata->'importedDocumentIds','[]'::jsonb) ? $3 THEN '[]'::jsonb ELSE jsonb_build_array($3::text) END) WHERE workspace_id=$1 AND id=$2",
        [ws, sourceId, documentId],
      );
      await tx.query(
        "UPDATE reference_entries SET asset_id=$3 WHERE workspace_id=$1 AND id=$2",
        [ws, entry.id, sourceId],
      );
      return sourceId;
    });
    let current = await asset(db, ws, id);
    if (current.status === "ready") {
      await db.query(
        "UPDATE reference_entries SET status='matched_ready' WHERE workspace_id=$1 AND id=$2",
        [ws, entry.id],
      );
      continue;
    }
    let access = "unavailable";
    let notice = !external
      ? "Reference detected. External retrieval is disabled; add the source file to use it as evidence."
      : "This reference could not be identified reliably. Add its source file.";
    try {
      let body: Buffer | undefined;
      let filename = "reference.txt",
        mediaType = "text/plain";
      let resolved: Source | undefined;
      if (external && entry.status !== "ambiguous" && doi) {
        resolved = await deps.resolveDOI(doi);
        access = resolved.access;
        notice = resolved.notice || "";
        if (resolved.passages.length)
          body = Buffer.from(resolved.passages.join("\n\n"));
        else
          notice =
            "Source identified, but readable text is unavailable. Add the source file.";
      } else if (external && entry.status !== "ambiguous" && url) {
        const file = await deps.remoteFile(url);
        mediaType = file.type.split(";")[0].trim().toLowerCase();
        if (file.buffer.subarray(0, 1024).toString().includes("%PDF-")) {
          filename = "reference.pdf";
          mediaType = "application/pdf";
        } else if (["text/html", "application/xhtml+xml"].includes(mediaType))
          filename = "reference.html";
        else if (["text/plain", "text/markdown"].includes(mediaType))
          filename = "reference.txt";
        else if (
          mediaType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
          filename = "reference.docx";
        else
          throw new Error(
            "The source link did not return a supported document.",
          );
        body = file.buffer;
        access = "full_text";
        notice =
          "Retrieved from the source link in your document. Claims have not been checked yet.";
      }
      if (body) {
        await db.transaction(async (tx) => {
          current = await asset(tx, ws, id, true);
          if (current.status === "ready") return;
          await blobs.put(current.object_key, body!, mediaType);
          await tx.query(
            "UPDATE source_assets SET filename=$3,media_type=$4,expected_bytes=$5,status='queued',access=$6,metadata=metadata || $7::jsonb WHERE workspace_id=$1 AND id=$2",
            [
              ws,
              id,
              filename,
              mediaType,
              body!.length,
              access,
              JSON.stringify({
                ...(resolved
                  ? {
                      title: resolved.title,
                      authors: resolved.authors,
                      year: resolved.year,
                      doi: resolved.doi,
                      type: "article-journal",
                      containerTitle: resolved.journal,
                    }
                  : {}),
                sourceUrl: url,
                fetchedAt: new Date().toISOString(),
                importNotice: notice,
              }),
            ],
          );
        });
        await ingestAsset(db, blobs, ws, id);
        if (resolved)
          await db.query(
            "UPDATE reference_entries SET parsed=parsed || $3::jsonb WHERE workspace_id=$1 AND id=$2",
            [
              ws,
              entry.id,
              JSON.stringify({
                title: resolved.title,
                authors: resolved.authors,
                year: resolved.year,
                doi: resolved.doi,
                url: resolved.url,
                type: "article-journal",
                containerTitle: resolved.journal,
              }),
            ],
          );
        await db.query(
          "UPDATE reference_entries SET status='matched_ready' WHERE workspace_id=$1 AND id=$2",
          [ws, entry.id],
        );
        continue;
      }
    } catch (error) {
      access = "unavailable";
      notice = `Source retrieval failed: ${(error as Error).message}. Add the source file to use it as evidence.`;
    }
    await db.query(
      "UPDATE source_assets SET status='unavailable',access=$3,metadata=metadata || $4::jsonb WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL AND status<>'ready'",
      [ws, id, access, JSON.stringify({ importNotice: notice })],
    );
  }
}
