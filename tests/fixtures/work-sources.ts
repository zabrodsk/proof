import { runInput } from "../../shared/backend.js";
import { createRun } from "../../server/backend/service.js";
import { attachSource } from "../../server/backend/work-sources.js";

// Existing engine fixtures explicitly supply their sources; bind those fixtures
// to their draft before exercising the production run service.
export async function createFixtureRun(...args: Parameters<typeof createRun>) {
  const [db, ws, value] = args;
  const input = runInput.parse(value);
  const doc = (
    await db.query(
      "SELECT document_id FROM document_versions WHERE workspace_id=$1 AND id=$2",
      [ws, input.documentVersionId],
    )
  ).rows[0];
  if (doc) {
    for (const selection of input.selectedSources) {
      const source = (
        await db.query(
          "SELECT id FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [ws, selection.assetId],
        )
      ).rows[0];
      if (source) await attachSource(db, ws, doc.document_id, source.id);
    }
    if (input.referenceImportVersionId) {
      await db.query(
        "UPDATE reference_imports SET settings=settings || jsonb_build_object('documentId',$3::text) WHERE workspace_id=$1 AND id=$2 AND settings->>'documentId' IS NULL",
        [ws, input.referenceImportVersionId, doc.document_id],
      );
    }
  }
  return createRun(...args);
}
