import { HttpError } from "../backend/config.js";
import { Router, type Express } from "express";
import multer from "multer";
import { z } from "zod";
import { IntegrationService } from "./service.js";
import { IntegrationError } from "./store.js";
import { OAuthVerifier } from "./auth.js";
import {
  chapterMapSchema,
  scopes,
  type Principal,
} from "../../shared/integrations/contracts.js";

export function integrationApi(
  service: IntegrationService,
  verifier?: OAuthVerifier,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!res.locals.proofSession || res.locals.proofSession === "local")
      return res.status(401).json({
        error:
          "Sign in to a named Proof account to use durable checks and private sources.",
      });
    next();
  });
  const principal = (res: any): Principal => ({
    owner: String(res.locals.proofSession),
    scopes: [...scopes],
  });
  router.get("/configuration", (_req, res) =>
    res.json({
      mcpEnabled: !!verifier,
      mcpUrl: verifier?.config.resource,
      oauthClientIds: verifier
        ? Object.fromEntries(
            Object.entries(verifier.config.clients).map(([id, platform]) => [
              platform,
              id,
            ]),
          )
        : {},
      platforms: verifier
        ? [...new Set(Object.values(verifier.config.clients))]
        : [],
      scopes,
    }),
  );
  router.post("/checks", async (req, res) =>
    res.status(202).json(await service.start(principal(res), req.body)),
  );
  router.get("/checks/:id", async (req, res) => {
    const page = z
      .object({
        offset: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    res.json(
      await service.get(
        principal(res),
        z.string().uuid().parse(req.params.id),
        page.offset,
        page.limit,
      ),
    );
  });
  router.get("/checks/:id/evidence/:evidenceId", async (req, res) =>
    res.json(
      await service.evidence(
        principal(res),
        z.string().uuid().parse(req.params.id),
        z.string().uuid().parse(req.params.evidenceId),
      ),
    ),
  );
  router.post("/checks/:id/cancel", async (req, res) =>
    res.json(
      await service.store.cancel(
        principal(res),
        z.string().uuid().parse(req.params.id),
      ),
    ),
  );
  router.get("/library", async (req, res) => {
    const args = z
      .object({
        query: z.string().max(300).default(""),
        offset: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    res.json(
      await service.store.searchLibrary(
        principal(res),
        args.query,
        args.offset,
        args.limit,
      ),
    );
  });
  router.put("/library/:id/chapters", async (req, res) =>
    res.json(
      await service.store.confirmChapterMap(
        principal(res).owner,
        z.string().uuid().parse(req.params.id),
        chapterMapSchema.parse(req.body),
      ),
    ),
  );
  router.delete("/library/:id", async (req, res) =>
    res.json(
      await service.store.deleteSource(
        principal(res).owner,
        z.string().uuid().parse(req.params.id),
      ),
    ),
  );
  router.post("/imports", async (req, res) =>
    res.status(202).json(await service.import(principal(res), req.body)),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 12 * 1024 * 1024,
      files: 1,
      fields: 4,
      fieldSize: 1000,
    },
  });
  router.post("/uploads", upload.single("file"), async (req, res) => {
    if (!req.file)
      throw new IntegrationError("missing_file", "Choose a source document.");
    const meta = z
      .object({
        title: z.string().min(1).max(300),
        edition: z.string().max(300).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })
      .parse(req.body);
    res.status(202).json(
      await service.import(principal(res), {
        idempotencyKey: meta.idempotencyKey,
        items: [
          {
            kind: "file",
            title: meta.title,
            edition: meta.edition,
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            base64: req.file.buffer.toString("base64"),
          },
        ],
      }),
    );
  });
  router.get("/grants", async (_req, res) =>
    res.json({ grants: await service.store.grants(principal(res).owner) }),
  );
  router.post("/grants/link", async (req, res) => {
    if (!verifier)
      throw new IntegrationError(
        "mcp_disabled",
        "MCP authorization is not configured.",
        503,
      );
    const input = z
      .object({ sourceIds: z.array(z.string().uuid()).max(100).default([]) })
      .strict()
      .parse(req.body);
    const token = /^Bearer ([^\s]+)$/i.exec(
      req.headers.authorization || "",
    )?.[1];
    if (!token)
      throw new IntegrationError(
        "invalid_token",
        "A validated platform OAuth token is required to link this account.",
        401,
      );
    const identity = await verifier.identity(token);
    res.json(
      await service.store.saveGrant(
        principal(res).owner,
        identity,
        input.sourceIds,
      ),
    );
  });
  router.put("/grants/:id/sources", async (req, res) => {
    const owner = principal(res).owner;
    const id = z.string().uuid().parse(req.params.id);
    const input = z
      .object({ sourceIds: z.array(z.string().uuid()).max(100) })
      .strict()
      .parse(req.body);
    // The browser can select sources for an existing grant; the host model cannot alter that selection.
    await service.store.selectGrantSources(owner, id, input.sourceIds);
    res.json({ id, sourceIds: input.sourceIds });
  });
  router.post("/grants/:id/reconnect", async (req, res) =>
    res.json(
      await service.store.allowReconnection(
        principal(res).owner,
        z.string().uuid().parse(req.params.id),
      ),
    ),
  );
  router.delete("/grants/:id", async (req, res) =>
    res.json(
      await service.store.revokeGrant(
        principal(res).owner,
        z.string().uuid().parse(req.params.id),
      ),
    ),
  );
  return router;
}
export function integrationErrors(app: Express) {
  app.use((error: unknown, _req: any, res: any, next: any) => {
    if (!(error instanceof IntegrationError) && !(error instanceof HttpError))
      return next(error);
    res.status(error.status).json({
      error: error instanceof IntegrationError ? error.code : "request_failed",
      message: error.message,
    });
  });
}
