import express from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { apiKey } from "./judge.js";
import { resolveDOI, saveSource, splitPassages } from "./sources.js";
import { parseDocument, uploadFilename } from "./documents.js";
import { auditDocument } from "./audit.js";
import { createWaitlistRouter } from "./waitlist.js";
import { installAccess } from "./access.js";
import { classroomRouter } from "./classroom.js";
import { evidenceRouter } from "./evidence.js";
import { discoveryRouter } from "./discovery.js";
import { database } from "./backend/db.js";
import { migrate } from "./integrations/database.js";
import { IntegrationStore } from "./integrations/store.js";
import { IntegrationService } from "./integrations/service.js";
import { OAuthVerifier, oauthConfig } from "./integrations/auth.js";
import { mcpRouter } from "./integrations/mcp.js";
import { integrationApi, integrationErrors } from "./integrations/http.js";
import { storage } from "./backend/storage.js";
import { compatibilityRouter } from "./backend/compatibility.js";
import { backendRouter } from "./backend/router.js";
import { publicPages } from "./public-pages.js";
const app = express();
const hosted = process.env.PROOF_HOSTED === "true";
if (hosted) app.set("trust proxy", 1);
const port = Number(process.env.PORT || 4317);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 1,
    fields: 6,
    fieldSize: 100000,
  },
});
app.disable("x-powered-by");
app.use((req, res, next) => {
  // Local app: never accept cross-site requests that could spend credentials.
  const host = req.headers.host?.split(":")[0];
  if (!hosted && !["127.0.0.1", "localhost", "[::1]"].includes(host || ""))
    return res
      .status(403)
      .json({ error: "Proof is available only on localhost." });
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host)
        return res
          .status(403)
          .json({ error: "Cross-site requests are not allowed." });
    } catch {
      return res.status(403).json({ error: "Invalid origin." });
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "18mb" }));
let integrations: IntegrationService | undefined;
let oauth: OAuthVerifier | undefined;
if (
  process.env.DATABASE_URL ||
  process.env.PROOF_INTEGRATIONS_ENABLED === "true"
) {
  const db = database();
  await migrate(db);
  integrations = new IntegrationService(
    new IntegrationStore(db, storage()),
    (process.env.PROOF_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(
      /\/$/,
      "",
    ),
  );
  if (
    process.env.PROOF_INTEGRATIONS_ENABLED === "true" &&
    process.env.PROOF_MCP_ENABLED === "true"
  ) {
    oauth = new OAuthVerifier(oauthConfig(), integrations.store);
    app.use(mcpRouter(integrations, oauth));
  }
}
app.all("/mcp", (_req, res) =>
  res
    .status(503)
    .json({ error: "Proof MCP is not enabled on this deployment." }),
);
app.use(publicPages());
installAccess(app);
if (integrations) {
  app.use(
    "/api/v1",
    backendRouter(integrations.store.db, integrations.store.blobs),
  );
  app.use(
    "/api/class",
    compatibilityRouter(integrations.store.db, integrations.store.blobs),
  );
  if (process.env.PROOF_INTEGRATIONS_ENABLED === "true")
    app.use("/api/integrations", integrationApi(integrations, oauth));
} else
  app.use("/api/v1", (_req, res) =>
    res.status(503).json({
      error:
        "The persistent backend requires DATABASE_URL and a running worker.",
    }),
  );
app.get("/api/integrations/configuration", (_req, res) =>
  res.json({ mcpEnabled: false, platforms: [] }),
);
app.use("/api/integrations", (_req, res) =>
  res.status(503).json({
    error: "Durable integrations are not enabled on this deployment.",
  }),
);

if (hosted) app.get("/", (_req, res) => res.redirect("/app"));
app.use("/api/class", classroomRouter());
app.use("/api/class", discoveryRouter());
app.use("/api/class", evidenceRouter());
app.use("/api/waitlist", createWaitlistRouter());
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    jevConfigured: !!apiKey(),
    model: process.env.JEV_MODEL || "jev-latest",
  }),
);
app.post("/api/sources/resolve", async (req, res) => {
  const { doi } = z.object({ doi: z.string().min(5).max(250) }).parse(req.body);
  res.json(await resolveDOI(doi));
});
app.post("/api/documents/import", upload.single("file"), async (req, res) => {
  if (!req.file) throw new Error("Choose a document to import.");
  const filename = uploadFilename(req.file.originalname);
  res.json({
    text: await parseDocument(req.file.buffer, filename),
    title: filename.replace(/\.[^.]+$/, ""),
  });
});
app.post("/api/sources/upload", upload.single("file"), async (req, res) => {
  const data = z
    .object({
      title: z.string().min(1).max(300),
      author: z.string().min(1).max(200),
      year: z.string().regex(/^(?:19|20)\d{2}$/),
      text: z.string().max(100000).optional(),
    })
    .parse(req.body);
  const text = req.file
    ? await parseDocument(req.file.buffer, req.file.originalname)
    : data.text;
  if (!text || text.trim().length < 40)
    throw new Error(
      "Upload the paper or paste at least 40 characters of source text.",
    );
  res.json(
    saveSource({
      title: data.title,
      authors: [data.author],
      year: data.year,
      access: "uploaded",
      provider: "User upload",
      passages: splitPassages(text),
      notice:
        "User-supplied source text. Identity, completeness, and peer-review status have not been independently verified.",
    }),
  );
});
let activeAudits = 0;
app.post("/api/audit", async (req, res) => {
  const input = z
    .object({
      text: z.string().min(20).max(150000),
      mode: z.enum(["audit", "strict"]),
      sourceIds: z.array(z.string().uuid()).max(40).default([]),
    })
    .parse(req.body);
  if (activeAudits >= 2)
    return res.status(429).json({
      error: "Two audits are already running. Wait for one to finish.",
    });
  activeAudits++;
  try {
    res.json(await auditDocument(input.text, input.mode, input.sourceIds));
  } finally {
    activeAudits--;
  }
});
// Short-lived, single-use exports use ordinary HTTP downloads, including in embedded browsers.
const exports = new Map<
  string,
  { name: string; text: string; type: string; expires: number }
>();
app.post("/api/exports", (req, res) => {
  const input = z
    .object({
      name: z.string().min(1).max(150),
      text: z.string().max(500000),
      type: z.enum(["text/plain", "text/markdown"]),
    })
    .parse(req.body);
  for (const [id, item] of exports)
    if (item.expires < Date.now()) exports.delete(id);
  if (exports.size >= 20) exports.delete(exports.keys().next().value!);
  const id = randomUUID();
  exports.set(id, {
    ...input,
    name: input.name.replace(/[^\p{L}\p{N} ._-]/gu, "_"),
    expires: Date.now() + 60000,
  });
  setTimeout(() => exports.delete(id), 60000).unref();
  res.json({ url: "/api/exports/" + id });
});
app.get("/api/exports/:id", (req, res) => {
  const item = exports.get(req.params.id);
  exports.delete(req.params.id);
  if (!item || item.expires < Date.now())
    return res
      .status(404)
      .json({ error: "This download expired. Export the document again." });
  res.setHeader("Cache-Control", "no-store");
  res.attachment(item.name).type(item.type).send(item.text);
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown API route." }),
);
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
integrationErrors(app);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
      });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Files must be smaller than 12 MB."
            : "The upload could not be read.",
      });
    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "The request failed. Try again.",
    });
  },
);
app.listen(
  port,
  process.env.PROOF_BIND_HOST || (hosted ? "0.0.0.0" : "127.0.0.1"),
  (error?: Error) => {
    if (error) {
      console.error(`Proof could not start: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Proof is ready at http://127.0.0.1:${port}`);
  },
);
