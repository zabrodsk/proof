import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runInput, sourceMetadata } from "../../shared/backend.js";
import { type Database, workspace, enqueue, event } from "./db.js";
import type { BlobStore } from "./storage.js";
import { uploadedBibliography } from "./references.js";
import { createAsset, asset, deleteAsset } from "./library.js";
import { createRun, ownedRun, applyFix } from "./service.js";
import { carryForward, editRegion } from "./carry-forward.js";
import { HttpError, limits, notFound } from "./config.js";
import { formatReference } from "./citations.js";
import { providerKey } from "./providers.js";
import { queueDocumentSources } from "./document-sources.js";
import {
  citationPlan,
  applyCitationPlan,
  applyVerifiedFixes,
  documentExport,
} from "./citation-plans.js";
const uuid = (value: unknown) => z.string().uuid().parse(value);
const page = (value: unknown, fallback: number, max: number) =>
  value === undefined
    ? fallback
    : z.coerce.number().int().nonnegative().max(max).parse(value);
export function backendRouter(db: Database, blobs: BlobStore) {
  const r = Router();
  r.use(async (_req, res, next) => {
    try {
      const owner = res.locals.proofSession;
      if (!owner) throw new HttpError(401, "Authentication required.");
      res.locals.workspace = await workspace(db, owner);
      next();
    } catch (e) {
      next(e);
    }
  });
  r.get("/capabilities", (_req, res) =>
    res.json({
      persistent: true,
      exa: !!providerKey("EXA_API_KEY"),
      openalex: !!providerKey("OPENALEX_API_KEY"),
      firecrawl: !!providerKey("FIRECRAWL_API_KEY"),
      embeddings: process.env.PROOF_EMBEDDINGS === "true",
      limits,
    }),
  );
  r.get("/documents", async (req, res) => {
    const result = await db.query(
      "SELECT d.id,d.title,d.current_version_id,v.text,v.created_at FROM documents d JOIN document_versions v ON v.workspace_id=d.workspace_id AND v.id=d.current_version_id WHERE d.workspace_id=$1 AND d.archived_at IS NULL ORDER BY v.created_at DESC LIMIT $2 OFFSET $3",
      [
        res.locals.workspace,
        page(req.query.limit, 100, 100),
        page(req.query.offset, 0, 1_000_000),
      ],
    );
    res.json({ items: result.rows });
  });
  r.post("/documents/:id/archive", async (req, res) => {
    const result = await db.query(
      "UPDATE documents SET archived_at=now() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id",
      [res.locals.workspace, uuid(req.params.id)],
    );
    if (!result.rows.length) throw notFound();
    res.status(204).end();
  });
  r.get("/documents/:id/runs", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    const doc = await db.query(
      "SELECT id FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
      [ws, id],
    );
    if (!doc.rows.length) throw notFound();
    const result = await db.query(
      "SELECT r.* FROM runs r JOIN document_versions v ON v.workspace_id=r.workspace_id AND v.id=r.document_version_id WHERE r.workspace_id=$1 AND v.document_id=$2 ORDER BY r.created_at DESC LIMIT 50",
      [ws, id],
    );
    res.json({ items: result.rows });
  });
  r.get("/documents/:id/export", async (req, res) => {
    const format = z.enum(["html", "text"]).parse(req.query.format || "text");
    const result = await documentExport(
      db,
      res.locals.workspace,
      uuid(req.params.id),
      req.query.versionId ? uuid(req.query.versionId) : undefined,
    );
    res.set(
      "Content-Disposition",
      `attachment; filename="proof-document.${format === "html" ? "html" : "txt"}"`,
    );
    res.set("Cache-Control", "private, no-store");
    res
      .type(format === "html" ? "text/html" : "text/plain")
      .send(result[format]);
  });
  r.get("/documents/:id/bibliography", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    const doc = await db.query(
      "SELECT id FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
      [ws, id],
    );
    if (!doc.rows.length) throw notFound();
    const result = await db.query(
      "SELECT id,status,input FROM source_imports WHERE workspace_id=$1 AND kind='bibliography' AND input->>'documentId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [ws, id],
    );
    res.json({ item: result.rows[0] || null });
  });
  r.post("/documents", async (req, res) => {
    const { title, text, localDraftId, retrieveSources } = z
      .object({
        title: z.string().min(1).max(300),
        text: z.string().min(1).max(limits.draftCharacters),
        localDraftId: z.string().uuid().optional(),
        retrieveSources: z.boolean().default(false),
      })
      .parse(req.body);
    if (
      localDraftId &&
      (process.env.PROOF_HOSTED === "true" ||
        process.env.NODE_ENV === "production")
    )
      throw new HttpError(
        400,
        "Browser draft migration is only available in local development.",
      );
    const ws = res.locals.workspace,
      id = localDraftId || randomUUID(),
      version = randomUUID();
    const documentVersionId = await db.transaction(async (tx) => {
      const inserted = await tx.query(
        "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
        [id, ws, title, version],
      );
      if (!inserted.rows.length) {
        const existing = (
          await tx.query(
            "SELECT current_version_id FROM documents WHERE workspace_id=$1 AND id=$2",
            [ws, id],
          )
        ).rows[0];
        if (!existing)
          throw new HttpError(409, "The browser draft ID is already in use.");
        return existing.current_version_id;
      }
      await tx.query(
        "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
        [version, ws, id, text],
      );
      await queueDocumentSources(tx, ws, id, text, retrieveSources);
      return version;
    });
    res.status(201).json({ id, documentVersionId });
  });
  r.post("/documents/:id/versions", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id),
      version = randomUUID();
    const { text, expectedVersionId, importSources, retrieveSources } = z
      .object({
        text: z.string().min(1).max(limits.draftCharacters),
        expectedVersionId: z.string().uuid(),
        importSources: z.boolean().default(false),
        retrieveSources: z.boolean().default(false),
      })
      .parse(req.body);
    const runId = await db.transaction(async (tx) => {
      const d = (
        await tx.query(
          "SELECT current_version_id FROM documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [ws, id],
        )
      ).rows[0];
      if (!d) throw notFound();
      if (d.current_version_id !== expectedVersionId)
        throw new HttpError(409, "The draft has changed.");
      const previous = (
        await tx.query(
          "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2",
          [ws, expectedVersionId],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
        [version, ws, id, text],
      );
      await tx.query(
        "UPDATE documents SET current_version_id=$3 WHERE workspace_id=$1 AND id=$2",
        [ws, id, version],
      );
      if (importSources)
        await queueDocumentSources(tx, ws, id, text, retrieveSources);
      const carried = previous
        ? await carryForward(
            tx,
            ws,
            { versionId: expectedVersionId, text: previous.text },
            { versionId: version, text },
            editRegion(previous.text, text),
            { kind: "edit" },
          )
        : undefined;
      await tx.query(
        "UPDATE runs SET invalidated=true WHERE workspace_id=$1 AND document_version_id=$2",
        [ws, expectedVersionId],
      );
      return carried;
    });
    res.status(201).json({ id: version, runId });
  });
  r.post("/uploads", async (req, res) => {
    const v = z
      .object({
        metadata: sourceMetadata,
        filename: z
          .string()
          .regex(/\.(pdf|docx|txt|md)$/i)
          .max(250),
        mediaType: z.enum([
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain",
          "text/markdown",
        ]),
        bytes: z.number().int().positive().max(limits.fileBytes),
        allowExternalProcessing: z.boolean().default(false),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(req.body);
    const ws = res.locals.workspace;
    const a = await db.transaction(async (tx) => {
      const a = await createAsset(
        tx,
        ws,
        {
          ...v.metadata,
          allowExternalProcessing: v.allowExternalProcessing,
        } as typeof v.metadata,
        v.filename,
        v.mediaType,
        v.bytes,
      );
      if (v.sha256)
        await tx.query(
          "UPDATE source_assets SET checksum=$3 WHERE workspace_id=$1 AND id=$2",
          [ws, a.id, v.sha256],
        );
      return a;
    });
    res.status(201).json({
      id: a.id,
      uploadUrl: blobs.signUpload
        ? await blobs.signUpload(a.key, v.mediaType, v.bytes)
        : `/api/v1/uploads/${a.id}/content`,
      method: "PUT",
      headers: { "Content-Type": v.mediaType },
      expiresIn: 900,
    });
  });
  r.put(
    "/uploads/:id/content",
    express.raw({ type: () => true, limit: limits.fileBytes }),
    async (req, res) => {
      if (blobs.signUpload)
        throw new HttpError(400, "Use the signed upload URL.");
      const ws = res.locals.workspace,
        id = uuid(req.params.id);
      if (!Buffer.isBuffer(req.body))
        throw new HttpError(400, "Upload file bytes.");
      await db.transaction(async (tx) => {
        const a = await asset(tx, ws, id, true);
        if (a.status !== "pending" || Date.now() > a.metadata.uploadExpiresAt)
          throw new HttpError(409, "Upload intent is no longer writable.");
        if (req.body.length !== Number(a.expected_bytes))
          throw new HttpError(400, "File size differs from upload intent.");
        await blobs.put(a.object_key, req.body, a.media_type);
      });
      res.status(204).end();
    },
  );
  r.post("/uploads/:id/complete", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await db.transaction(async (tx) => {
      const a = await asset(tx, ws, id, true);
      if (a.status === "pending") {
        await tx.query(
          "UPDATE source_assets SET status='queued' WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        );
        await enqueue(tx, ws, "ingest", id);
      }
    });
    res.status(202).json({ assetId: id });
  });
  r.get("/sources", async (req, res) => {
    const rows = await db.query(
      "SELECT a.id,a.metadata,a.status,a.access,a.eligibility,e.id AS extraction_id,e.status AS extraction_status,e.coverage FROM source_assets a LEFT JOIN extractions e ON a.id=e.asset_id AND a.workspace_id=e.workspace_id WHERE a.workspace_id=$1 AND a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT $2 OFFSET $3",
      [
        res.locals.workspace,
        page(req.query.limit, 50, 100),
        page(req.query.offset, 0, 1_000_000),
      ],
    );
    const items = await Promise.all(
      rows.rows.map(async (source) => {
        const entries =
          source.access === "uploaded" && source.extraction_id
            ? await uploadedBibliography(
                db,
                res.locals.workspace,
                source.extraction_id,
              )
            : undefined;
        return {
          ...source,
          contentKind: entries ? "bibliography" : "source",
          referenceCount: entries?.length,
        };
      }),
    );
    res.json({ items });
  });
  r.get("/sources/:id/usage", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await asset(db, ws, id);
    res.json({
      items: (
        await db.query(
          "SELECT provider,usage,created_at FROM asset_provider_calls WHERE workspace_id=$1 AND asset_id=$2 ORDER BY created_at",
          [ws, id],
        )
      ).rows,
    });
  });
  r.get("/sources/:id/download", async (req, res) => {
    const a = await asset(db, res.locals.workspace, uuid(req.params.id));
    if (a.status !== "ready") throw new HttpError(409, "Source is not ready.");
    if (blobs.signDownload)
      res.json({ url: await blobs.signDownload(a.object_key), expiresIn: 60 });
    else
      res
        .attachment(a.filename)
        .type(a.media_type)
        .send(await blobs.get(a.object_key));
  });
  r.delete("/sources/:id", async (req, res) => {
    await deleteAsset(db, res.locals.workspace, uuid(req.params.id));
    res.status(202).json({ status: "deleting" });
  });
  r.get("/passages/:id", async (req, res) => {
    const row = (
      await db.query(
        "SELECT p.*,g.page_index,g.label,g.label_status FROM source_passages p JOIN source_pages g ON p.page_id=g.id AND p.workspace_id=g.workspace_id WHERE p.workspace_id=$1 AND p.id=$2",
        [res.locals.workspace, uuid(req.params.id)],
      )
    ).rows[0];
    if (!row) throw notFound();
    res.json(row);
  });
  r.post("/source-imports", async (req, res) => {
    const v = z
      .object({
        kind: z.enum(["text", "url", "bibliography", "file"]),
        documentId: z.string().uuid().optional(),
        metadata: sourceMetadata.optional(),
        text: z.string().max(limits.characters).optional(),
        url: z.string().url().max(2000).optional(),
        assetId: z.string().uuid().optional(),
        externalAccess: z.boolean().default(false),
      })
      .parse(req.body);
    const ws = res.locals.workspace,
      id = randomUUID();
    if (v.kind === "url" && (!v.url || !v.externalAccess))
      throw new HttpError(
        400,
        "URL imports require a URL and externalAccess permission.",
      );
    if (["text", "bibliography"].includes(v.kind) && !v.text && !v.assetId)
      throw new HttpError(400, "Provide source text or an uploaded asset.");
    if (v.kind === "file" && !v.assetId)
      throw new HttpError(400, "Provide an uploaded asset.");
    await db.transaction(async (tx) => {
      if (v.documentId) {
        const doc = await tx.query(
          "SELECT id FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
          [ws, v.documentId],
        );
        if (!doc.rows.length) throw notFound();
      }
      if (v.assetId) await asset(tx, ws, v.assetId);
      if (v.kind !== "bibliography" && !v.assetId) {
        const a = await createAsset(
          tx,
          ws,
          v.metadata || {
            title: v.url || "Pasted source",
            authors: [],
            year: "",
          },
          v.kind === "url" ? "snapshot.txt" : "source.txt",
          "text/plain",
        );
        v.assetId = a.id;
      }
      if (v.kind === "bibliography")
        await tx.query(
          "INSERT INTO reference_imports(id,workspace_id,original,settings) VALUES($1,$2,$3,$4)",
          [
            id,
            ws,
            v.text || "",
            JSON.stringify({
              externalAccess: v.externalAccess,
              originAssetId: v.assetId,
            }),
          ],
        );
      await tx.query(
        "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,$3,$4)",
        [id, ws, v.kind, JSON.stringify(v)],
      );
      await enqueue(tx, ws, "import", id);
    });
    res.status(202).json({
      id,
      referenceImportVersionId: v.kind === "bibliography" ? id : undefined,
    });
  });
  r.get("/source-imports/:id", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    const row = (
      await db.query(
        "SELECT id,kind,status,result FROM source_imports WHERE workspace_id=$1 AND id=$2",
        [ws, id],
      )
    ).rows[0];
    if (!row) throw notFound();
    const entries = (
      await db.query(
        "SELECT * FROM reference_entries WHERE workspace_id=$1 AND import_id=$2 ORDER BY ordinal",
        [ws, id],
      )
    ).rows;
    res.json({ ...row, entries });
  });
  r.post("/reference-imports/:id/citations", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    const overrides = z
      .object({
        punctuationInQuote: z.boolean().optional(),
        includeDoi: z.boolean().optional(),
        includeUrl: z.boolean().optional(),
      })
      .parse(req.body || {});
    const imp = (
      await db.query(
        "SELECT id FROM reference_imports WHERE workspace_id=$1 AND id=$2",
        [ws, id],
      )
    ).rows[0];
    if (!imp) throw notFound();
    const entries = (
      await db.query(
        "SELECT id,original,parsed,status FROM reference_entries WHERE workspace_id=$1 AND import_id=$2 ORDER BY ordinal",
        [ws, id],
      )
    ).rows;
    res.json({
      items: entries.map((entry) => ({
        id: entry.id,
        status: entry.status,
        ...formatReference(entry.parsed, {
          id: entry.id,
          original: entry.original,
          overrides,
        }),
      })),
    });
  });
  r.patch("/reference-entries/:id", async (req, res) => {
    const v = z
        .object({
          parsed: z.record(z.string(), z.unknown()).optional(),
          assetId: z.string().uuid().optional(),
        })
        .parse(req.body),
      ws = res.locals.workspace;
    const result = await db.transaction(async (tx) => {
      const e = (
        await tx.query(
          "SELECT * FROM reference_entries WHERE workspace_id=$1 AND id=$2",
          [ws, uuid(req.params.id)],
        )
      ).rows[0];
      if (!e) throw notFound();
      if (v.assetId) await asset(tx, ws, v.assetId);
      const imp = (
        await tx.query(
          "SELECT * FROM reference_imports WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [ws, e.import_id],
        )
      ).rows[0];
      const id = randomUUID();
      await tx.query(
        "INSERT INTO reference_imports(id,workspace_id,version,status,original,settings) VALUES($1,$2,$3,'complete',$4,$5)",
        [id, ws, imp.version + 1, imp.original, imp.settings],
      );
      const rows = (
        await tx.query(
          "SELECT * FROM reference_entries WHERE workspace_id=$1 AND import_id=$2",
          [ws, e.import_id],
        )
      ).rows;
      for (const entry of rows)
        await tx.query(
          "INSERT INTO reference_entries(id,workspace_id,import_id,ordinal,original,parsed,status,candidates,asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            ws,
            id,
            entry.ordinal,
            entry.original,
            entry.id === e.id ? { ...entry.parsed, ...v.parsed } : entry.parsed,
            entry.id === e.id
              ? v.assetId
                ? "matched_ready"
                : "unidentified"
              : entry.status,
            JSON.stringify(entry.id === e.id ? [] : entry.candidates),
            entry.id === e.id ? v.assetId || null : entry.asset_id,
          ],
        );
      return { referenceImportVersionId: id };
    });
    res.json(result);
  });
  r.post("/runs", async (req, res) => {
    const run = await createRun(
      db,
      res.locals.workspace,
      runInput.parse(req.body),
      req.get("Idempotency-Key") || "",
    );
    res.status(202).json({ id: run.id, status: run.status });
  });
  r.get("/runs/:id", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id),
      run = await ownedRun(db, ws, id);
    const usage = (
      await db.query(
        "SELECT provider,status,count(*)::int AS requests,jsonb_agg(usage) AS usage FROM provider_calls WHERE workspace_id=$1 AND run_id=$2 GROUP BY provider,status",
        [ws, id],
      )
    ).rows;
    res.json({ ...run, usage });
  });
  r.get("/runs/:id/research", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await ownedRun(db, ws, id);
    const rows = (
      await db.query(
        "SELECT data FROM research_results WHERE workspace_id=$1 AND run_id=$2",
        [ws, id],
      )
    ).rows;
    const assessed = (
      await db.query(
        "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2",
        [ws, id],
      )
    ).rows.flatMap((r) => r.data.evidence || []);
    res.json({
      items: rows
        .filter((r) => r.data.kind !== "candidate_resolution")
        .map((r) => ({
          ...r.data,
          candidates: r.data.candidates.map((c: any) => ({
            ...c,
            status: assessed.some(
              (e: any) =>
                e.assetId === c.assetId && e.support !== "not_verified",
            )
              ? "checked_evidence"
              : "promising",
          })),
        })),
    });
  });
  r.get("/runs/:id/findings", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await ownedRun(db, ws, id);
    const result = await db.query(
      "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal LIMIT $3 OFFSET $4",
      [
        ws,
        id,
        page(req.query.limit, 50, 100),
        page(req.query.offset, 0, 1_000_000),
      ],
    );
    res.json({ items: result.rows.map((r) => r.data) });
  });
  r.get("/runs/:id/events", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await ownedRun(db, ws, id);
    let cursor = page(
        req.get("Last-Event-ID") || req.query.after,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      closed = false;
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    req.on("close", () => {
      closed = true;
    });
    while (!closed) {
      try {
        const run = await ownedRun(db, ws, id);
        const rows = (
          await db.query(
            "SELECT * FROM run_events WHERE workspace_id=$1 AND run_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 100",
            [ws, id, cursor],
          )
        ).rows;
        for (const e of rows) {
          res.write(
            `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`,
          );
          cursor = Number(e.sequence);
        }
        if (!["queued", "running"].includes(run.status) && rows.length < 100)
          break;
        res.write(": keepalive\n\n");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        break;
      }
    }
    res.end();
  });
  r.post("/runs/:id/cancel", async (req, res) => {
    const ws = res.locals.workspace,
      id = uuid(req.params.id);
    await db.transaction(async (tx) => {
      const run = await ownedRun(tx, ws, id, true);
      if (["queued", "running"].includes(run.status)) {
        await tx.query(
          "UPDATE runs SET cancel_requested=true,status='cancelled',updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        );
        await event(tx, ws, id, "cancelled", { partialReport: true });
      }
    });
    res.status(202).json({ id, status: "cancel_requested" });
  });
  r.post("/documents/:id/apply-fix", async (req, res) => {
    const v = z
      .object({
        approved: z.literal(true),
        documentVersionId: z.string().uuid(),
        findingId: z.string().uuid(),
      })
      .parse(req.body);
    res.json(
      await applyFix(
        db,
        res.locals.workspace,
        uuid(req.params.id),
        v.documentVersionId,
        v.findingId,
      ),
    );
  });
  r.post("/documents/:id/apply-fixes", async (req, res) => {
    const value = z
      .strictObject({
        approved: z.literal(true),
        documentVersionId: z.string().uuid(),
        findingIds: z.array(z.string().uuid()).min(1).max(100),
      })
      .parse(req.body);
    res.json(
      await applyVerifiedFixes(
        db,
        res.locals.workspace,
        uuid(req.params.id),
        value.documentVersionId,
        value.findingIds,
        req.get("Idempotency-Key") || "",
      ),
    );
  });
  r.get("/runs/:id/citation-plan", async (req, res) => {
    res.json(await citationPlan(db, res.locals.workspace, uuid(req.params.id)));
  });
  r.post("/runs/:id/citation-plan", async (req, res) => {
    res.json(await citationPlan(db, res.locals.workspace, uuid(req.params.id)));
  });
  r.post("/documents/:id/citation-plans/:planId/apply", async (req, res) => {
    const value = z
      .strictObject({
        approved: z.literal(true),
        documentVersionId: z.string().uuid(),
        operationIds: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(req.body);
    res.json(
      await applyCitationPlan(
        db,
        res.locals.workspace,
        uuid(req.params.id),
        uuid(req.params.planId),
        value.documentVersionId,
        value.operationIds,
        req.get("Idempotency-Key") || "",
      ),
    );
  });
  r.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(
          error instanceof HttpError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 500,
        )
        .json({
          error:
            error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join("; ")
              : error instanceof HttpError
                ? error.message
                : "The backend could not complete this request.",
        });
    },
  );
  return r;
}
