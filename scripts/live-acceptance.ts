import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { chromium } from "@playwright/test";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { backendRouter } from "../server/backend/router.js";
import { localStorage } from "../server/backend/storage.js";
import { startWorker } from "../server/backend/queue.js";
import { apiKey } from "../server/judge.js";
import { providerKey } from "../server/backend/providers.js";
import { parseDocument, uploadFilename } from "../server/documents.js";

// Opt-in real-provider acceptance. Uses generated text, an isolated local
// account, local files, and the actual durable worker. Never logs credentials.
if (!apiKey() || !providerKey("EXA_API_KEY"))
  throw Error("Live acceptance needs configured Jev and Exa.");
process.env.PROOF_EMBEDDINGS = "false";
process.env.PROOF_WORKER_CONCURRENCY = "1";
const marker = randomUUID();
const root = `.data/live-acceptance/${marker}`;
await mkdir(root, { recursive: true, mode: 0o700 });
const pg = new PGlite({ dataDir: `${root}/database`, extensions: { vector } });
function adapter(c: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(q, v) {
      if (v?.length) {
        const r = await c.query(q, v);
        return { rows: r.rows, rowCount: r.affectedRows };
      }
      const r = (await c.exec(q)).at(-1);
      return { rows: r?.rows || [], rowCount: r?.affectedRows };
    },
  };
}
const db: Database = {
  ...adapter(pg),
  transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
  close: () => pg.close(),
};
await migrate(db);
const owner = `live-acceptance-${marker}`;
await workspace(db, owner);
const blobs = localStorage(`${root}/files`);
const app = express();
app.use(express.json({ limit: "18mb" }));
app.get("/api/session", (_q, r) =>
  r.json({
    authenticated: true,
    hosted: false,
    user: { id: owner, name: "Synthetic acceptance account" },
  }),
);
app.use((_q, r, n) => {
  r.locals.proofSession = owner;
  n();
});
app.use("/api/v1", backendRouter(db, blobs));
app.post(
  "/api/documents/import",
  multer({ storage: multer.memoryStorage() }).single("file"),
  async (q, r) => {
    if (!q.file) return void r.status(400).json({ error: "Choose a file." });
    const name = uploadFilename(q.file.originalname);
    r.json({
      text: await parseDocument(q.file.buffer, name),
      title: name.replace(/\.[^.]+$/, ""),
    });
  },
);
app.use(
  (
    e: Error & { status?: number },
    _q: express.Request,
    r: express.Response,
    _n: express.NextFunction,
  ) => r.status(e.status || 400).json({ error: "Acceptance request failed." }),
);
app.use(express.static("dist"));
app.get("/{*path}", (_q, r) =>
  r.sendFile("index.html", { root: process.cwd() + "/dist" }),
);
const server = app.listen(4344, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const worker = await startWorker(db, blobs, { backend: "pglite" });
const browser = await chromium.launch();
const page = await browser.newPage();
const report: any = {
  kind: "live providers with generated text",
  database: "Persistent PGlite PostgreSQL with pg-boss",
  authentication: "Isolated synthetic local session",
  checks: [],
  started: new Date().toISOString(),
};
const base = "http://127.0.0.1:4344";
async function json(path: string, body?: unknown, status = 200) {
  const r = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  assert.equal(r.status, status, `${path} returned ${r.status}`);
  return r.json();
}
async function wait<T>(
  read: () => Promise<T>,
  ready: (v: T) => boolean,
  max = 240000,
) {
  const until = Date.now() + max;
  while (Date.now() < until) {
    const v = await read();
    if (ready(v)) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Live worker did not finish within its deadline.");
}
try {
  const draftText = "Jane Smith.\nThe trial included 120 adults.";
  await page.goto(base + "/app");
  await page
    .getByRole("button", { name: "Add new work", exact: true })
    .first()
    .click();
  await page.locator('.ps-new-work input[type="file"]').setInputFiles({
    name: "Synthetic acceptance draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(draftText),
  });
  await page.getByRole("button", { name: "Create work", exact: true }).click();
  await page.getByRole("textbox", { name: "Document text" }).waitFor();
  const documentId = page.url().split("/works/")[1];
  assert.ok(documentId);
  await page.locator('.ps-setup-upload input[type="file"]').setInputFiles({
    name: "Synthetic trial source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("The trial included 218 adults."),
  });
  await page
    .getByRole("checkbox", {
      name: "Synthetic trial source.txt Ready",
      exact: true,
    })
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("checkbox", {
      name: "Synthetic trial source.txt Ready",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await page
    .getByRole("button", { name: "Check my text", exact: true })
    .click();
  const run = await wait<any>(
    async () => (await json(`/api/v1/documents/${documentId}/runs`)).items[0],
    (r) => r && !["queued", "running"].includes(r.status),
  );
  const findings = (await json(`/api/v1/runs/${run.id}/findings`)).items;
  assert.equal(findings.length, 1);
  const finding = findings[0];
  report.numericFinding = finding;
  assert.equal(finding.support, "contradicted");
  if (finding.fix)
    assert.equal(finding.fix.replacement, "The trial included 218 adults.");
  assert.ok(finding.evidence.length > 0);
  for (const e of finding.evidence) {
    const stored = await json(`/api/v1/passages/${e.id}`);
    assert.equal(stored.text, e.text);
  }
  await page
    .getByText("1 of 1 selected claims checked.", { exact: false })
    .waitFor({ timeout: 30000 });
  await page.locator(".ps-change-head").click();
  await page.screenshot({
    path: "output/proof-audit/live-correction-evidence.png",
    fullPage: true,
  });
  if (finding.fix) {
    await page.getByRole("button", { name: "Accept", exact: true }).click();
  } else {
    assert.equal(
      await page.getByRole("button", { name: "Accept", exact: true }).count(),
      0,
    );
    await page
      .getByRole("textbox", { name: "Document text" })
      .fill(draftText.replace("120", "218"));
    await page.getByRole("textbox", { name: "Document text" }).blur();
    await page.getByText("Saved", { exact: true }).waitFor();
  }
  await wait(
    async () =>
      page.getByRole("textbox", { name: "Document text" }).inputValue(),
    (text) => text === draftText.replace("120", "218"),
  );
  await page.reload();
  assert.equal(
    await page.getByRole("textbox", { name: "Document text" }).inputValue(),
    draftText.replace("120", "218"),
  );
  const usage = (await json(`/api/v1/runs/${run.id}`)).usage;
  assert.ok(!usage.some((u: any) => u.provider === "exa"));
  report.checks.push({
    workflow:
      "UI draft import, worker source ingestion, live Jev numeric finding, exact stored passage, saved version and reload",
    status: "passed",
    support: finding.support,
    correction: finding.fix
      ? "Approved exact correction"
      : "No validated automatic correction; manual edit saved and reopened",
    usage,
  });
  console.log("Live browser correction workflow passed.");
  // Run a small real public-source search and retain its honest evidence gaps.
  const publicText = "The Moon orbits Earth.";
  const doc = await json(
    "/api/v1/documents",
    { title: "Synthetic public research acceptance", text: publicText },
    201,
  );
  const research = await json(
    "/api/v1/runs",
    {
      documentVersionId: doc.documentVersionId,
      mode: "discover",
      externalAccess: "research",
      sourcePolicy: "matched",
      allowProviderProcessing: true,
      budgetPreset: "small",
    },
    202,
  );
  const finished = await wait<any>(
    () => json(`/api/v1/runs/${research.id}`),
    (r) => !["queued", "running"].includes(r.status),
  );
  assert.ok(["complete", "partial"].includes(finished.status));
  assert.equal(finished.coverage.completedClaims, 1);
  const candidates = (await json(`/api/v1/runs/${research.id}/research`)).items;
  assert.ok(candidates.some((item: any) => item.candidates.length > 0));
  assert.ok(
    finished.usage.some(
      (u: any) => u.provider === "exa" && u.status === "complete",
    ),
  );
  const researchFindings = (await json(`/api/v1/runs/${research.id}/findings`))
    .items;
  for (const f of researchFindings)
    for (const e of f.evidence) {
      const stored = await json(`/api/v1/passages/${e.id}`);
      assert.equal(stored.text, e.text);
    }
  await page.goto(base + `/app/works/${doc.id}`);
  await page.getByRole("button", { name: "Find sources", exact: true }).click();
  await page
    .getByText("Retrieved sources and access gaps", { exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByText("Retrieved sources and access gaps", { exact: true })
    .click();
  await page.screenshot({
    path: "output/proof-audit/live-research-deliverable.png",
    fullPage: true,
  });
  report.checks.push({
    workflow:
      "Live Exa authoritative research, retrieval, durable findings and visible access gaps",
    status: researchFindings.some((f: any) => f.evidence.length)
      ? "passed with inspectable evidence"
      : "finished with explicit evidence gaps",
    runStatus: finished.status,
    usage: finished.usage,
    candidates: candidates.flatMap((r: any) =>
      r.candidates.map((c: any) => ({
        title: c.title,
        access: c.access,
        eligibility: c.eligibility,
        reason: c.reason,
      })),
    ),
    findings: researchFindings.map((f: any) => ({
      support: f.support,
      processing: f.processing,
      evidenceCount: f.evidence.length,
      evidenceGap: f.evidenceGap,
    })),
  });
  console.log("Live public research completed; evidence status recorded.");
} catch (error) {
  report.failure = (error as Error).message;
  report.sources = (await json("/api/v1/sources")).items.map((source: any) => ({
    title: source.metadata.title,
    status: source.status,
    extractionStatus: source.extraction_status,
  }));
  report.page = await page.locator("main").innerText();
  await page.screenshot({
    path: "output/proof-audit/live-failure.png",
    fullPage: true,
  });
  process.exitCode = 1;
  console.log(
    "Live acceptance failed; inspect output/proof-audit/live-acceptance.json.",
  );
} finally {
  report.finished = new Date().toISOString();
  await mkdir("output/proof-audit", { recursive: true });
  await writeFile(
    "output/proof-audit/live-acceptance.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await worker.stop();
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
  await rm(root, { recursive: true, force: true });
}
