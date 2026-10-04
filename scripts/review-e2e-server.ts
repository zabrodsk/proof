// Isolated browser test server. Never imported by production. Provider judgments
// are deterministic fixtures; the HTTP API, database and review engine are real.
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { providerContext } from "../server/backend/providers.js";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { backendRouter } from "../server/backend/router.js";
import { processRun } from "../server/backend/engine.js";
import { processImport } from "../server/backend/imports.js";
import {
  checksum,
  createAsset,
  ingestAsset,
} from "../server/backend/library.js";
import { parseDocument, uploadFilename } from "../server/documents.js";
import { discoveryRouter } from "../server/discovery.js";
import type { BlobStore } from "../server/backend/storage.js";

process.env.PROOF_EMBEDDINGS = "false";
process.env.PROOF_USE_KEYCHAIN = "false";
process.env.TYPESAFE_API_KEY = "synthetic-e2e-key";
process.env.EXA_API_KEY = "synthetic-e2e-key";
// Test the actual adapters and typed judgment validation against controlled
// provider responses. No third-party traffic or production credentials.
const fixtureRequests: {
  runId?: string;
  workspaceId?: string;
  url: string;
  body?: Record<string, unknown>;
}[] = [];
const browserFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (/^https?:/.test(url) && !url.startsWith("http://127.0.0.1:")) {
    const context = providerContext.getStore();
    let body: Record<string, unknown> | undefined;
    try {
      body = JSON.parse(String(options?.body));
    } catch {}
    fixtureRequests.push({
      runId: context?.run,
      workspaceId: context?.ws,
      url,
      body,
    });
  }
  if (url.startsWith("https://api.exa.ai/search"))
    return Response.json({
      results: [
        {
          title: "Synthetic source",
          url: "https://doi.org/10.1234/e2e",
          doi: "10.1234/e2e",
        },
        {
          title: "Unavailable test paper",
          url: "https://doi.org/10.1234/unavailable",
          doi: "10.1234/unavailable",
        },
        {
          title: "Retracted test paper",
          url: "https://doi.org/10.1234/retracted",
          doi: "10.1234/retracted",
        },
      ],
    });
  if (url.startsWith("https://api.crossref.org/works/")) {
    const doi = decodeURIComponent(
      new URL(url).pathname.slice("/works/".length),
    );
    return Response.json({
      message: {
        DOI: doi,
        type: "journal-article",
        title: [
          doi === "10.1234/e2e"
            ? "Synthetic source"
            : doi === "10.1234/retracted"
              ? "Retracted test paper"
              : "Unavailable test paper",
        ],
        ...(doi === "10.1234/retracted"
          ? { "update-to": [{ type: "retraction" }] }
          : {}),
      },
    });
  }
  if (url.startsWith("https://api.typesafe.ai/v1/systemone")) {
    const request = JSON.parse(String(options?.body));
    if (request.state.claim.includes("The outage fixture"))
      throw new DOMException("Controlled provider timeout", "TimeoutError");
    const choicesByPassage = Object.entries(request.state.passages) as [
      string,
      string,
    ][];
    const hasParis = /Paris is the capital/.test(request.state.claim);
    const parisPassage = choicesByPassage.find(([, value]) =>
      value.includes("Paris is the capital of France."),
    );
    const hasTrial = /The trial included 218 adults/.test(request.state.claim);
    const trialPassage = choicesByPassage.find(([, value]) =>
      value.includes("The trial included 218 adults."),
    );
    const memoryClaim =
      request.state.claim.includes("Sparrow, Liu, and Wegner (2011)") &&
      request.state.claim.includes("lower recall") &&
      request.state.claim.includes("where it could be found");
    const memoryPassage = choicesByPassage.find(
      ([, value]) =>
        value.includes("lower rates of recall of the information itself") &&
        value.includes("where to access it"),
    );
    const supportingPassage = memoryClaim
      ? memoryPassage
      : hasTrial
        ? trialPassage
        : hasParis
          ? parisPassage
          : undefined;
    const numeric =
      /120 adults/.test(request.state.claim) &&
      choicesByPassage.some(([, value]) => value.includes("218 adults"));
    const supports =
      !!supportingPassage && !/population doubled/.test(request.state.claim);
    const conflictPassage = choicesByPassage.find(([, value]) =>
      value.includes("The moon is a rocky natural satellite"),
    );
    const conflict =
      /The moon is made of cheese/.test(request.state.claim) &&
      !!conflictPassage;
    const choices: Record<string, string> = {
      verdict: numeric
        ? "numeric_mismatch"
        : conflict
          ? "contradicted"
          : supports
            ? "supported"
            : hasParis || hasTrial
              ? "not_addressed"
              : "uncertain",
      passage: supports
        ? supportingPassage![0]
        : conflict
          ? conflictPassage![0]
          : "p0",
      replacement: "none",
      reason: numeric
        ? "numbers"
        : conflict
          ? "conflict"
          : supports
            ? "aligns"
            : hasParis || hasTrial
              ? "outcome"
              : "incomplete",
      numbers: numeric ? "n0" : "none",
    };
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(
        ([name, question]: [string, any]) => {
          const keys = Object.keys(question.criteria);
          const choice = keys.includes(choices[name]) ? choices[name] : "none";
          return [
            name,
            {
              type: "choice",
              choice,
              confidence: 0.99,
              probabilities: Object.fromEntries(
                keys.map((key) => [
                  key,
                  key === choice ? 0.99 : 0.01 / (keys.length - 1),
                ]),
              ),
            },
          ];
        },
      ),
    );
    return Response.json({
      answers,
      model: "synthetic-provider-fixture",
      usage: { input_tokens: 100 },
    });
  }
  if (/^https?:/.test(url) && !url.startsWith("http://127.0.0.1:"))
    throw new Error("Unexpected external request in deterministic E2E server.");
  return browserFetch(input, options);
};
const pg = new PGlite({ extensions: { vector } });
function adapter(c: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(q, v) {
      if (v) {
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
const files = new Map<string, Buffer>();
const blobs: BlobStore = {
  async put(k, b) {
    files.set(k, Buffer.from(b));
  },
  async get(k) {
    const b = files.get(k);
    if (!b) throw Error("Missing fixture");
    return b;
  },
  async delete(k) {
    files.delete(k);
  },
};
const ws = await workspace(db, "browser-e2e");
const sourceText =
  "The trial included 218 adults. John was born on the Reservation. Paris is the capital of France. Reading scores improved. The results were mixed.";
const asset = await db.transaction((tx) =>
  createAsset(
    tx,
    ws,
    {
      title: "Synthetic source",
      authors: ["Test Author"],
      year: "2026",
      doi: "10.1234/e2e",
    },
    "source.txt",
    "text/plain",
    Buffer.byteLength(sourceText),
  ),
);
await blobs.put(asset.key, Buffer.from(sourceText), "text/plain");
await ingestAsset(db, blobs, ws, asset.id);
await db.query(
  "UPDATE source_assets SET eligibility='eligible',access='full_text',metadata=metadata||$2::jsonb WHERE id=$1",
  [
    asset.id,
    JSON.stringify({
      assetKind: "retrieved_text_snapshot",
      pagination: "unavailable",
      textFingerprint: checksum(sourceText),
      retrievedAt: new Date().toISOString(),
    }),
  ],
);
// This PDF visibly prints page 21. The fixture confirms that printed locator
// after ingesting the real PDF, rather than treating a file index as a citation page.
const citedPdf = await PDFDocument.create();
const citedPage = citedPdf.addPage([612, 792]);
const citedFont = await citedPdf.embedFont(StandardFonts.Helvetica);
const citedLines = [
  "Citable source",
  "Maria Brown, Evidence Journal, 2024",
  "The trial included 218 adults.",
  "Paris is the capital of France.",
  "The moon is a rocky natural satellite of Earth.",
  "These observations concern present geography and astronomy.",
  "The reported observations do not address tutoring outcomes.",
  "21",
];
citedLines.forEach((line, index) =>
  citedPage.drawText(line, {
    x: 52,
    y: index === citedLines.length - 1 ? 32 : 730 - index * 30,
    size: 12,
    font: citedFont,
  }),
);
const otherPage = citedPdf.addPage([612, 792]);
[
  "Citable source, continued",
  "This page discusses map design and printed legends.",
  "The colors distinguish coastlines from boundaries.",
  "The text on this page does not identify any national capital.",
  "The diagrams are examples of map presentation conventions.",
  "22",
].forEach((line, index) =>
  otherPage.drawText(line, {
    x: 52,
    y: index === 5 ? 32 : 730 - index * 30,
    size: 12,
    font: citedFont,
  }),
);
const citedBytes = Buffer.from(await citedPdf.save());
const citable = await db.transaction((tx) =>
  createAsset(
    tx,
    ws,
    {
      title: "Citable source",
      authors: ["Maria Brown"],
      year: "2024",
      doi: "10.1234/citable",
    },
    "citable.pdf",
    "application/pdf",
    citedBytes.length,
  ),
);
await blobs.put(citable.key, citedBytes, "application/pdf");
const citableExtraction = await ingestAsset(db, blobs, ws, citable.id);
await db.query(
  "UPDATE source_assets SET eligibility='eligible',access='full_text',metadata=metadata||$2::jsonb WHERE id=$1",
  [
    citable.id,
    JSON.stringify({
      authorDetails: [{ given: "Maria", family: "Brown" }],
      journal: "Evidence Journal",
      volume: "4",
      issue: "2",
      pages: "21-22",
      publicationType: "journal-article",
    }),
  ],
);
await db.query(
  "UPDATE source_pages SET label=(20+page_index)::text,label_status='confirmed' WHERE extraction_id=$1",
  [citableExtraction],
);
// A single fixture worker consumes the real outbox and checkpoints. Durable
// pg-boss delivery/restart behavior is covered by the backend queue tests.
let processing = false;
const workerTimer = setInterval(async () => {
  if (processing) return;
  processing = true;
  try {
    const jobs = (
      await db.query(
        "SELECT * FROM job_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 1",
      )
    ).rows;
    for (const job of jobs) {
      if (job.kind === "run")
        await processRun(db, blobs, job.workspace_id, job.target_id);
      if (job.kind === "ingest")
        await ingestAsset(db, blobs, job.workspace_id, job.target_id);
      if (job.kind === "import")
        await processImport(db, blobs, job.workspace_id, job.target_id);
      await db.query("UPDATE job_outbox SET delivered_at=now() WHERE id=$1", [
        job.id,
      ]);
    }
  } catch (error) {
    console.error("Fixture worker failed:", (error as Error).message);
  } finally {
    processing = false;
  }
}, 50);
const app = express();
app.use(express.json({ limit: "18mb" }));
app.get("/health", (_q, r) => r.json({ ok: true, fixture: true }));
app.get("/api/session", (_q, r) =>
  r.json({
    authenticated: true,
    hosted: false,
    user: { id: "browser-e2e", name: "Browser QA" },
  }),
);
// Header-based identity changes exist only in this isolated test server.
// They exercise the production ownership checks without changing auth code.
app.use((q, r, n) => {
  r.locals.proofSession = q.get("x-proof-e2e-owner") || "browser-e2e";
  n();
});
app.get("/__e2e/provider-requests", (q, r) => {
  r.json({
    items: fixtureRequests.filter(
      (item) => !q.query.runId || item.runId === q.query.runId,
    ),
  });
});
app.post("/__e2e/sparrow-abstract", async (_q, r) => {
  const text =
    "When people expect to have future access to information, they have lower rates of recall of the information itself and enhanced recall instead for where to access it.";
  const metadata = {
    title:
      "Google effects on memory: Cognitive consequences of having information at our fingertips",
    authors: ["Betsy Sparrow", "Jenny Liu", "Daniel M. Wegner"],
    authorDetails: [
      { given: "Betsy", family: "Sparrow" },
      { given: "Jenny", family: "Liu" },
      { given: "Daniel M.", family: "Wegner" },
    ],
    year: "2011",
    doi: "10.1126/science.1207745",
    journal: "Science",
    containerTitle: "Science",
    type: "article-journal" as const,
    pagination: "unavailable",
    assetKind: "retrieved_text_snapshot",
  };
  const saved = await createAsset(
    db,
    ws,
    metadata,
    "abstract.txt",
    "text/plain",
    Buffer.byteLength(text),
  );
  await blobs.put(saved.key, Buffer.from(text), "text/plain");
  const extractionId = await ingestAsset(db, blobs, ws, saved.id);
  await db.query("UPDATE source_assets SET access='abstract' WHERE id=$1", [
    saved.id,
  ]);
  r.json({ id: saved.id, extractionId });
});
app.use("/api/v1", backendRouter(db, blobs));
app.use("/api/discovery", discoveryRouter());
app.post(
  "/api/documents/import",
  multer({ storage: multer.memoryStorage() }).single("file"),
  async (q, r) => {
    if (!q.file) {
      r.status(400).json({ error: "Choose a file" });
      return;
    }
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
  ) => r.status(e.status || 400).json({ error: e.message }),
);
app.use(express.static("dist"));
app.get("/{*path}", (_q, r) =>
  r.sendFile("index.html", { root: process.cwd() + "/dist" }),
);
const server = app.listen(
  Number(process.env.PROOF_E2E_PORT || 4333),
  "127.0.0.1",
  () => console.log("Review E2E fixture ready"),
);
process.on("SIGTERM", () => {
  clearInterval(workerTimer);
  server.close(() => void db.close().then(() => process.exit(0)));
});
