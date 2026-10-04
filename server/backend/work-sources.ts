import type { Sql } from "./db.js";
import { HttpError, notFound } from "./config.js";

export async function ownedDocument(db: Sql, ws: string, documentId: string) {
  const { rows } = await db.query(
    "SELECT id FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
    [ws, documentId],
  );
  if (!rows.length) throw notFound();
}
export async function attachSource(
  db: Sql,
  ws: string,
  documentId: string,
  assetId: string,
) {
  await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
  await ownedDocument(db, ws, documentId);
  await db.query(
    "INSERT INTO document_sources(workspace_id,document_id,asset_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [ws, documentId, assetId],
  );
}
export async function requireWorkSource(
  db: Sql,
  ws: string,
  documentId: string,
  assetId: string,
) {
  const { rows } = await db.query(
    "SELECT asset_id FROM document_sources WHERE workspace_id=$1 AND document_id=$2 AND asset_id=$3",
    [ws, documentId, assetId],
  );
  if (!rows.length)
    throw new HttpError(
      400,
      "This source does not belong to the current work.",
    );
}
export async function runDocumentId(
  db: Sql,
  ws: string,
  runId: string,
): Promise<string> {
  const { rows } = await db.query(
    "SELECT v.document_id FROM runs r JOIN document_versions v ON v.workspace_id=r.workspace_id AND v.id=r.document_version_id WHERE r.workspace_id=$1 AND r.id=$2",
    [ws, runId],
  );
  if (!rows.length) throw notFound();
  return rows[0].document_id;
}
