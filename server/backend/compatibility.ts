import { attachSource } from "./work-sources.js";
import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  BackendFinding,
  RunInput,
  Selection,
} from "../../shared/backend.js";
import type { Finding, Source, Status } from "../../shared/types.js";
import type { ClassPaper } from "../../shared/classroom.js";
import type { SearchCandidate, SearchReport } from "../../shared/discovery.js";
import type { EvidenceReport } from "../../shared/evidence.js";
import { reviewClass, allSentences } from "../classroom.js";
import { citations } from "../parse.js";
import { withUsage } from "../usage.js";
import { type Database, type Sql, workspace, enqueue } from "./db.js";
import { HttpError, notFound } from "./config.js";
import { checksum, createAsset } from "./library.js";
import { processImport } from "./imports.js";
import { createRun, ownedRun } from "./service.js";
import type { BlobStore } from "./storage.js";

const sourceInput = z
  .object({
    label: z.string().max(300),
    url: z.string().url().max(2000).optional(),
    text: z.string().max(100000).optional(),
  })
  .refine(
    (s) => !!s.url || (s.text?.trim().length || 0) >= 40,
    "Provide a source URL or at least 40 characters of text.",
  );
const evidenceInput = z
  .object({
    text: z.string().min(10).max(100000),
    mode: z.enum(["supplied", "public"]),
    sources: z.array(sourceInput).max(8).default([]),
  })
  .refine(
    (v) => v.mode !== "supplied" || v.sources.length > 0,
    "Add at least one source first.",
  );
const searchInput = z.object({
  claim: z.string().min(10).max(4000),
  query: z.string().max(500).optional(),
});
const field = z.string().max(2000);
const paperInput = z.object({
  id: z.string().max(100),
  mla: z.object({
    authors: field,
    title: field,
    journal: field,
    year: field,
    volume: field,
    issue: field,
    pages: field,
    doi: field,
  }),
  url: z.string().max(2000),
  accessed: z.string().max(10),
  filename: z.string().max(300).optional(),
  firstPage: z.number().int().min(1).max(99999).optional(),
  pages: z
    .array(
      z.object({
        index: z.number().int().min(1).max(100),
        label: z.string().max(50).optional(),
        text: z.string().max(60000),
      }),
    )
    .max(100)
    .refine(
      (p) => p.every((v, i) => v.index === i + 1),
      "Pages must be in file order.",
    ),
});
const reviewInput = z
  .object({
    text: z.string().min(10).max(100000),
    assignment: z.enum(["draft", "bibliography"]),
    papers: z.array(paperInput).max(8),
  })
  .refine(
    (v) =>
      v.papers.reduce(
        (n, p) => n + p.pages.reduce((m, page) => m + page.text.length, 0),
        0,
      ) <= 2_000_000,
    "Use up to two million source characters.",
  );
type Kind = "evidence" | "search" | "review";
async function job(db: Sql, ws: string, id: string, kind?: Kind) {
  const row = (
    await db.query(
      "SELECT * FROM compatibility_jobs WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    )
  ).rows[0];
  if (!row || (kind && row.kind !== kind)) throw notFound();
  return row;
}
export async function submitCompatibilityJob(
  db: Database,
  ws: string,
  kind: Kind,
  input: unknown,
  key: string = randomUUID(),
) {
  if (!key || key.length > 200)
    throw new HttpError(400, "Use an idempotency key of 1 to 200 characters.");
  const hash = checksum(JSON.stringify({ kind, input }));
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
    const prior = (
      await tx.query(
        "SELECT * FROM compatibility_jobs WHERE workspace_id=$1 AND idempotency_key=$2",
        [ws, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new HttpError(
          409,
          "This idempotency key was used for different inputs.",
        );
      return prior;
    }
    const active = (
      await tx.query(
        "SELECT count(*)::int AS n FROM compatibility_jobs WHERE workspace_id=$1 AND status IN ('queued','running')",
        [ws],
      )
    ).rows[0].n;
    if (active >= 3)
      throw new HttpError(429, "This workspace already has three active jobs.");
    const id = randomUUID();
    const row = (
      await tx.query(
        "INSERT INTO compatibility_jobs(id,workspace_id,kind,input,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [id, ws, kind, JSON.stringify(input), key, hash],
      )
    ).rows[0];
    await enqueue(tx, ws, "compatibility", id);
    return row;
  });
}

// The queue owns this work. Every generated document and import is checkpointed
// before I/O, so a worker restart reuses its inputs and the same engine run.
export async function processCompatibilityJob(
  db: Database,
  blobs: BlobStore,
  ws: string,
  id: string,
) {
  let current = await job(db, ws, id);
  if (["complete", "handed_off"].includes(current.status)) return;
  const input = current.input;
  await db.transaction(async (tx) => {
    const locked = (
      await tx.query(
        "SELECT * FROM compatibility_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ws, id],
      )
    ).rows[0];
    if (!locked) throw notFound();
    if (locked.result.documentVersionId) return;
    const documentId = randomUUID(),
      documentVersionId = randomUUID();
    const text = current.kind === "search" ? input.claim : input.text;
    await tx.query(
      "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,$3,$4)",
      [documentId, ws, `Imported ${current.kind}`, documentVersionId],
    );
    await tx.query(
      "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
      [documentVersionId, ws, documentId, text],
    );
    const imports: string[] = [];
    const assetIds: string[] = [];
    const sources =
      current.kind === "evidence" && input.mode === "supplied"
        ? input.sources
        : current.kind === "review"
          ? input.papers
              .filter((p: any) => p.pages.some((v: any) => v.text.trim()))
              .map((p: any) => ({
                label: p.mla.title || p.filename || "Imported source",
                text: p.pages.map((v: any) => v.text).join("\f"),
                metadata: {
                  title: (p.mla.title || p.filename || "Imported source").slice(
                    0,
                    500,
                  ),
                  authors: p.mla.authors
                    .split("\n")
                    .filter(Boolean)
                    .map((s: string) => s.slice(0, 200))
                    .slice(0, 100),
                  year: p.mla.year.slice(0, 10),
                  doi: p.mla.doi || undefined,
                  assetKind: "legacy_extracted_text_snapshot",
                  originalFilename: p.filename,
                  originalPages: p.pages.map((v: any) => ({
                    index: v.index,
                    label: v.label,
                  })),
                },
              }))
          : [];
    for (const source of sources) {
      const metadata = source.metadata || {
        title: source.label || source.url || "Pasted source",
        authors: [],
        year: "",
      };
      const a = await createAsset(tx, ws, metadata, "source.txt", "text/plain");
      await attachSource(tx, ws, documentId, a.id);
      assetIds.push(a.id);
      const importId = randomUUID();
      // Prefer the supplied bytes over a link if both are present.
      const kind = source.text?.trim() ? "text" : "url";
      await tx.query(
        "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,$3,$4)",
        [
          importId,
          ws,
          kind,
          JSON.stringify({
            kind,
            documentId,
            assetId: a.id,
            text: source.text,
            url: source.url,
            externalAccess: kind === "url",
          }),
        ],
      );
      imports.push(importId);
    }
    await tx.query(
      "UPDATE compatibility_jobs SET status='running',progress='Preparing saved sources',result=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",
      [
        ws,
        id,
        JSON.stringify({ documentId, documentVersionId, imports, assetIds }),
      ],
    );
  });
  current = await job(db, ws, id);
  const selectedSources: Selection[] = [];
  for (const importId of current.result.imports || []) {
    await processImport(db, blobs, ws, importId);
    const imported = (
      await db.query(
        "SELECT result FROM source_imports WHERE workspace_id=$1 AND id=$2",
        [ws, importId],
      )
    ).rows[0];
    if (!imported) throw notFound();
    selectedSources.push({
      assetId: imported.result.assetId,
      extractionId: imported.result.extractionId,
      pageRanges: [],
    });
  }
  if (current.kind === "review") {
    const papers: ClassPaper[] = input.papers.map((p: any) => ({
      ...p,
      metadata: {
        id: p.id,
        title: p.mla.title,
        authors: p.mla.authors.split("\n"),
        year: p.mla.year,
        access: "uploaded",
        passages: [],
        provider: "Saved source, not refreshed",
        retrievedAt: "",
      },
      checks: [],
    }));
    const { result, usage } = await withUsage(() =>
      reviewClass(input.text, papers, input.assignment),
    );
    await db.query(
      "UPDATE compatibility_jobs SET status='complete',progress='Review complete',result=result || $3::jsonb,updated_at=now() WHERE workspace_id=$1 AND id=$2",
      [ws, id, JSON.stringify({ report: { ...result, usage, reviewId: id } })],
    );
    return;
  }
  const sourceCheck = current.kind === "evidence" && input.mode === "supplied";
  const runInput: RunInput = {
    citationProfile: "mla9",
    citationOutput: "audit",
    documentVersionId: current.result.documentVersionId,
    mode: sourceCheck
      ? "source_check"
      : current.kind === "search"
        ? "discover"
        : "fact_check",
    checkScope: "selected_library",
    selectedSources,
    externalAccess: sourceCheck ? "none" : "research",
    sourcePolicy: sourceCheck ? "user_supplied" : "academic",
    allowProviderProcessing: true,
    budgetPreset: "standard",
    ...(current.kind === "search"
      ? { claimSpans: [{ start: 0, end: input.claim.length }] }
      : {}),
  };
  const run = await createRun(
    db,
    ws,
    runInput,
    `compatibility:${id}`,
    current.kind === "search" ? { researchQuery: input.query } : {},
  );
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE compatibility_jobs SET status='handed_off',progress='Checking evidence',run_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",
      [ws, id, run.id],
    );
  });
}

function legacyStatus(support: BackendFinding["support"]): Status {
  return support === "mixed" || support === "not_verified"
    ? "uncertain"
    : support;
}
export function legacyCandidate(
  finding: BackendFinding,
  source: Source,
): SearchCandidate {
  const evidence = finding.evidence.filter((e) => e.assetId === source.id);
  const values = evidence.map((e) => e.support);
  const support =
    values.includes("contradicted") && values.includes("supported")
      ? "mixed"
      : values.includes("contradicted")
        ? "contradicted"
        : values.includes("overstated")
          ? "overstated"
          : values.includes("partial")
            ? "partial"
            : values.includes("supported")
              ? "supported"
              : "not_verified";
  const assessment: Finding = {
    id: finding.id,
    ...finding.claim,
    citations: citations(finding.claim.text),
    status: legacyStatus(support),
    sourceId: source.id,
    evidence: evidence[0]?.text,
    checkedPassages: source.passages,
    explanation: finding.explanation.join(" "),
    method: finding.processing === "complete" ? "Jev" : "unverified",
  };
  // Versioned fixes are applied through /v1/documents/:id/apply-fix only.
  return { source, finding: assessment };
}
async function legacyReport(
  db: Database,
  ws: string,
  current: any,
  run: any,
): Promise<SearchReport | EvidenceReport> {
  const findings: BackendFinding[] = (
    await db.query(
      "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
      [ws, run.id],
    )
  ).rows.map((r) => r.data);
  const claims = (
    await db.query(
      "SELECT id,data FROM claims WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
      [ws, run.id],
    )
  ).rows;
  const ids = [
    ...new Set(
      findings
        .flatMap((f) => f.evidence.map((e) => e.assetId))
        .concat(run.input.selectedSources.map((s: Selection) => s.assetId)),
    ),
  ];
  const checked = [...new Set(findings.flatMap((f) => f.checkedPassageIds))];
  const passages = checked.length
    ? (
        await db.query(
          "SELECT p.id,p.text,e.asset_id FROM source_passages p JOIN extractions e ON e.id=p.extraction_id AND e.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=ANY($2::uuid[])",
          [ws, checked],
        )
      ).rows
    : [];
  for (const p of passages) if (!ids.includes(p.asset_id)) ids.push(p.asset_id);
  const assets = ids.length
    ? (
        await db.query(
          "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
          [ws, ids],
        )
      ).rows
    : [];
  const sources: Source[] = assets.map((a) => ({
    ...a.metadata,
    id: a.id,
    title: a.metadata.title,
    authors: a.metadata.authors || [],
    year: a.metadata.year || "",
    access: [
      "full_text",
      "abstract",
      "metadata",
      "unavailable",
      "uploaded",
    ].includes(a.access)
      ? a.access
      : a.access === "retrieved"
        ? "full_text"
        : "uploaded",
    passages: passages.filter((p) => p.asset_id === a.id).map((p) => p.text),
    provider: "Persistent source library",
    retrievedAt: new Date(a.created_at).toISOString(),
  }));
  const notices = [
    "This report uses the persistent analysis backend. Open the run for source locations and separate support, citation, and processing results.",
    ...(run.status === "partial"
      ? [
          "Some checks are incomplete. Unchecked claims have not been marked correct.",
        ]
      : []),
    ...(run.coverage.unprocessedSpans?.length
      ? [
          `${run.coverage.unprocessedSpans.length} claim spans were not processed within this run's budget.`,
        ]
      : []),
  ];
  const rows = claims.map((c) => {
    const f = findings.find(
      (v) => v.claim.start === c.data.start && v.claim.end === c.data.end,
    );
    const checkedAssets = f
      ? passages
          .filter((p) => f.checkedPassageIds.includes(p.id))
          .map((p) => p.asset_id)
      : [];
    return {
      id: f?.id || c.id,
      text: c.data.text,
      start: c.data.start,
      end: c.data.end,
      candidates: f
        ? sources
            .filter(
              (s) =>
                checkedAssets.includes(s.id) ||
                f.evidence.some((e) => e.assetId === s.id),
            )
            .map((s) => legacyCandidate(f, s))
        : [],
      notices: f?.explanation || ["This claim has not been checked."],
      completed: f?.processing === "complete",
    };
  });
  if (current.kind === "search")
    return {
      claim: current.input.claim,
      query: current.input.query || current.input.claim,
      candidates: rows.flatMap((r) => r.candidates),
      notices: [...notices, ...rows.flatMap((r) => r.notices)],
    };
  return {
    text: current.input.text,
    mode: current.input.mode,
    rows,
    sources,
    total: run.coverage.totalClaims ?? claims.length,
    completed: rows.filter((r) => r.completed).length,
  };
}
export function compatibilityRouter(db: Database, _blobs: BlobStore) {
  const router = Router();
  router.use(async (_req, res, next) => {
    try {
      if (!res.locals.proofSession)
        throw new HttpError(401, "Authentication required.");
      res.locals.workspace = await workspace(db, res.locals.proofSession);
      next();
    } catch (error) {
      next(error);
    }
  });
  for (const [path, kind, schema] of [
    ["evidence-checks", "evidence", evidenceInput],
    ["searches", "search", searchInput],
    ["reviews", "review", reviewInput],
  ] as const) {
    router.post(`/${path}`, async (req, res) => {
      const input = schema.parse(req.body);
      if ("text" in input && allSentences(input.text).length > 1000)
        throw new HttpError(400, "Use up to 1,000 sentences.");
      const saved = await submitCompatibilityJob(
        db,
        res.locals.workspace,
        kind,
        input,
        req.get("Idempotency-Key"),
      );
      res.status(202).json({ id: saved.id });
    });
    router.get(`/${path}/:id`, async (req, res) => {
      const ws = res.locals.workspace,
        current = await job(
          db,
          ws,
          z.string().uuid().parse(req.params.id),
          kind,
        );
      if (!current.run_id) {
        res.json({
          id: current.id,
          status:
            current.status === "complete"
              ? "complete"
              : current.status === "failed"
                ? "failed"
                : "running",
          progress: current.progress,
          report: current.result.report,
          error: current.error,
        });
        return;
      }
      const run = await ownedRun(db, ws, current.run_id);
      const status = ["complete", "partial"].includes(run.status)
        ? "complete"
        : ["failed", "cancelled"].includes(run.status)
          ? "failed"
          : "running";
      res.json({
        id: current.id,
        runId: run.id,
        status,
        progress: `${run.stage}: ${run.coverage.completedClaims || 0} claims checked`,
        report: await legacyReport(db, ws, current, run),
        error: run.error,
        processingStatus: run.status,
      });
    });
  }
  router.post("/reviews/:id/retry", async (req, res) => {
    const ws = res.locals.workspace,
      current = await job(
        db,
        ws,
        z.string().uuid().parse(req.params.id),
        "review",
      );
    if (current.status !== "complete")
      throw new HttpError(409, "Wait for this review to finish.");
    if (!current.result.report?.sentences?.some((s: any) => !s.completed))
      throw new HttpError(
        400,
        "This report has no incomplete language checks.",
      );
    const next = await submitCompatibilityJob(
      db,
      ws,
      "review",
      current.input,
      req.get("Idempotency-Key"),
    );
    res.status(202).json({ id: next.id });
  });
  router.use(
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
            error instanceof HttpError
              ? error.message
              : error instanceof z.ZodError
                ? error.issues.map((i) => i.message).join("; ")
                : "The saved job could not be processed.",
        });
    },
  );
  return router;
}
