import { uploadedBibliography } from "./references.js";
import { validateFixEvidence } from "./verified-fixes.js";
import { randomUUID } from "node:crypto";
import { runInput, type RunRequest } from "../../shared/backend.js";
import { type Database, type Sql, enqueue, event } from "./db.js";
import { asset, checksum, validateSelection } from "./library.js";
import { HttpError, notFound, limits, versions } from "./config.js";
import { carryForward } from "./carry-forward.js";
export async function ownedRun(db: Sql, ws: string, id: string, lock = false) {
  const r = await db.query(
    `SELECT * FROM runs WHERE workspace_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [ws, id],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}
export async function createRun(
  db: Database,
  ws: string,
  inputValue: RunRequest,
  key: string,
  trusted: { researchQuery?: string } = {},
) {
  const input = runInput.parse(inputValue);
  if (!key || key.length > 200)
    throw new HttpError(
      400,
      "Provide an Idempotency-Key header of 1 to 200 characters.",
    );
  const hash = checksum(JSON.stringify(input));
  return db.transaction(async (tx) => {
    // Serializes duplicate submissions and workspace quotas across API instances.
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
    const prior = await tx.query(
      "SELECT * FROM runs WHERE workspace_id=$1 AND idempotency_key=$2",
      [ws, key],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash)
        throw new HttpError(
          409,
          "This idempotency key was used for different inputs.",
        );
      return prior.rows[0];
    }
    const doc = await tx.query(
      "SELECT * FROM document_versions WHERE workspace_id=$1 AND id=$2",
      [ws, input.documentVersionId],
    );
    if (!doc.rows[0]) throw notFound();
    if (input.claimSpans?.some((s) => s.end > doc.rows[0].text.length))
      throw new HttpError(400, "A claim span exceeds the draft text.");
    const active = await tx.query(
      "SELECT count(*)::int AS n FROM runs WHERE workspace_id=$1 AND status IN ('queued','running')",
      [ws],
    );
    if (active.rows[0].n >= 3)
      throw new HttpError(429, "This workspace already has three active runs.");
    let references: any[] = [];
    if (input.referenceImportVersionId) {
      const imp = await tx.query(
        "SELECT * FROM reference_imports WHERE workspace_id=$1 AND id=$2",
        [ws, input.referenceImportVersionId],
      );
      if (!imp.rows[0]) throw notFound();
      if (imp.rows[0].status !== "complete")
        throw new HttpError(409, "Bibliography is still processing.");
      references = (
        await tx.query(
          "SELECT * FROM reference_entries WHERE workspace_id=$1 AND import_id=$2 ORDER BY ordinal",
          [ws, input.referenceImportVersionId],
        )
      ).rows;
      for (const ref of references.filter((r) => r.asset_id)) {
        if (input.excludedSourceIds?.includes(ref.asset_id)) continue;
        if (input.selectedSources.some((s) => s.assetId === ref.asset_id))
          continue;
        const ext = await tx.query(
          "SELECT id FROM extractions WHERE workspace_id=$1 AND asset_id=$2 AND status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1",
          [ws, ref.asset_id],
        );
        if (ext.rows[0])
          input.selectedSources.push({
            assetId: ref.asset_id,
            extractionId: ext.rows[0].id,
            pageRanges: [],
          });
      }
    }
    await validateSelection(tx, ws, input.selectedSources);
    const bibliographyAssets: string[] = [];
    for (const selection of [...input.selectedSources]) {
      const source = await asset(tx, ws, selection.assetId, true);
      if (source.access !== "uploaded") continue;
      const entries = await uploadedBibliography(
        tx,
        ws,
        selection.extractionId,
      );
      if (!entries) continue;
      bibliographyAssets.push(selection.assetId);
      for (const [ordinal, entry] of entries.entries())
        if (!references.some((r) => r.original === entry.original))
          references.push({
            id: randomUUID(),
            ordinal,
            ...entry,
            status: "unidentified",
            asset_id: null,
            originAssetId: selection.assetId,
          });
    }
    input.selectedSources = input.selectedSources.filter(
      (s) => !bibliographyAssets.includes(s.assetId),
    );
    const sourceSnapshots: Record<string, unknown> = {};
    for (const selection of input.selectedSources) {
      const source = await asset(tx, ws, selection.assetId, true);
      sourceSnapshots[selection.assetId] = {
        metadata: source.metadata,
        eligibility: source.eligibility,
        access: source.access,
        created_at: source.created_at,
      };
    }
    const config = {
      ...versions,
      embeddingRevision: process.env.PROOF_EMBEDDING_REVISION || null,
      embeddingEnabled: process.env.PROOF_EMBEDDINGS === "true",
      embeddingModelDirectory: process.env.PROOF_MODEL_DIR || ".data/models/",
      model: process.env.JEV_MODEL || "jev-latest",
      researchDate: new Date().toISOString(),
      researchQuery: trusted.researchQuery,
      limits: limits[input.budgetPreset],
      references,
      bibliographyAssets,
      sourceSnapshots,
    };
    const id = randomUUID();
    const r = await tx.query(
      "INSERT INTO runs(id,workspace_id,document_version_id,idempotency_key,request_hash,input,config) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        id,
        ws,
        input.documentVersionId,
        key,
        hash,
        JSON.stringify(input),
        JSON.stringify(config),
      ],
    );
    await enqueue(tx, ws, "run", id);
    await event(tx, ws, id, "queued");
    return r.rows[0];
  });
}
export async function applyFix(
  db: Database,
  ws: string,
  documentId: string,
  versionId: string,
  findingId: string,
) {
  return db.transaction(async (tx) => {
    const doc = (
      await tx.query(
        "SELECT * FROM documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ws, documentId],
      )
    ).rows[0];
    if (!doc) throw notFound();
    if (doc.current_version_id !== versionId)
      throw new HttpError(
        409,
        "The draft has changed. Check it again before applying this edit.",
      );
    const row = (
      await tx.query(
        "SELECT f.data,r.document_version_id,r.invalidated,r.config FROM findings f JOIN runs r ON r.id=f.run_id AND r.workspace_id=f.workspace_id WHERE f.workspace_id=$1 AND f.id=$2",
        [ws, findingId],
      )
    ).rows[0];
    const fix = row?.data.fix;
    if (
      !fix ||
      row.invalidated ||
      row.document_version_id !== versionId ||
      fix.documentVersionId !== versionId
    )
      throw new HttpError(409, "This finding has no current verified edit.");
    await validateFixEvidence(tx, ws, row.data, row.config);
    const version = (
      await tx.query(
        "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2",
        [ws, versionId],
      )
    ).rows[0];
    if (!version || version.text.slice(fix.start, fix.end) !== fix.original)
      throw new HttpError(409, "The edit span no longer matches.");
    const text =
      version.text.slice(0, fix.start) +
      fix.replacement +
      version.text.slice(fix.end);
    const id = randomUUID();
    await tx.query(
      "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
      [id, ws, documentId, text],
    );
    await tx.query(
      "UPDATE documents SET current_version_id=$3 WHERE workspace_id=$1 AND id=$2",
      [ws, documentId, id],
    );
    const runId = await carryForward(
      tx,
      ws,
      { versionId, text: version.text },
      { versionId: id, text },
      {
        start: fix.start,
        end: fix.end,
        delta: fix.replacement.length - (fix.end - fix.start),
      },
      { kind: "fix", findingId },
    );
    await tx.query(
      "UPDATE runs SET invalidated=true WHERE workspace_id=$1 AND document_version_id=$2",
      [ws, versionId],
    );
    return { id, text, runId };
  });
}
