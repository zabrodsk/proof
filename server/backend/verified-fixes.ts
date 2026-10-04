import { isDeepStrictEqual } from "node:util";
import type { BackendFinding } from "../../shared/backend.js";
import type { Sql } from "./db.js";
import { HttpError } from "./config.js";

/** Revalidate evidence at approval time, including publication-status refreshes. */
export async function validateFixEvidence(
  tx: Sql,
  ws: string,
  finding: BackendFinding,
  config: { sourceSnapshots?: Record<string, any> },
  documentId: string,
) {
  const reject = () => {
    throw new HttpError(
      409,
      "The evidence behind this edit changed or is unavailable. Run a new check before applying it.",
    );
  };
  if (!finding.evidence?.length) reject();
  for (const evidence of finding.evidence) {
    const association = await tx.query(
      "SELECT asset_id FROM document_sources WHERE workspace_id=$1 AND document_id=$2 AND asset_id=$3",
      [ws, documentId, evidence.assetId],
    );
    if (!association.rows.length) reject();
    const source = (
      await tx.query(
        "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE",
        [ws, evidence.assetId],
      )
    ).rows[0];
    const frozen = config.sourceSnapshots?.[evidence.assetId];
    if (
      !source ||
      source.status !== "ready" ||
      !frozen ||
      source.eligibility === "ineligible" ||
      source.metadata.publicationWarning ||
      source.eligibility !== frozen.eligibility ||
      source.access !== frozen.access ||
      !isDeepStrictEqual(source.metadata, frozen.metadata)
    )
      reject();
    const passage = (
      await tx.query(
        `SELECT p.*,g.page_index,g.label,g.label_status,x.status AS extraction_status
       FROM source_passages p JOIN source_pages g ON g.workspace_id=p.workspace_id AND g.id=p.page_id
       JOIN extractions x ON x.workspace_id=p.workspace_id AND x.id=p.extraction_id
       WHERE p.workspace_id=$1 AND p.id=$2 AND p.extraction_id=$3 AND x.asset_id=$4 FOR SHARE OF p,g,x`,
        [ws, evidence.id, evidence.extractionId, evidence.assetId],
      )
    ).rows[0];
    if (
      !passage ||
      passage.extraction_status !== "complete" ||
      passage.text !== evidence.text ||
      passage.start_offset !== evidence.start ||
      passage.end_offset !== evidence.end ||
      passage.page_index !== evidence.pageIndex ||
      (passage.label || undefined) !== (evidence.pageLabel || undefined) ||
      passage.label_status !== evidence.labelStatus
    )
      reject();
  }
}
