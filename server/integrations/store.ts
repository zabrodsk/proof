import { attachSource, requireWorkSource } from "../backend/work-sources.js";
import { createHash, randomUUID } from "node:crypto";
import { workspace, enqueue, type Database, type Sql } from "../backend/db.js";
import { createRun as sharedCreateRun, ownedRun } from "../backend/service.js";
import {
  createAsset,
  asset,
  deleteAsset,
  validateSelection,
} from "../backend/library.js";
import { HttpError } from "../backend/config.js";
import type { BlobStore } from "../backend/storage.js";
import { lock } from "./database.js";
import {
  SCHEMA_VERSION,
  type Principal,
  type Scope,
  type RunInput,
  type ImportInput,
  type ChapterMap,
} from "../../shared/integrations/contracts.js";
import type { Selection } from "../../shared/backend.js";
import { decodeFile } from "./files.js";
export class IntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => hash(JSON.stringify(value));
export function requireScope(p: Principal, s: Scope) {
  if (!p.scopes.includes(s))
    throw new IntegrationError(
      "insufficient_scope",
      `Permission required: ${s}`,
      403,
    );
}
const unavailable = () =>
  new IntegrationError(
    "not_found",
    "The item is unavailable or access was revoked.",
    404,
  );
export type Grant = {
  id: string;
  owner: string;
  issuer: string;
  subject: string;
  client_id: string;
  platform: "chatgpt" | "claude";
  scopes: string[];
  source_ids: string[];
  active: boolean;
};
export class IntegrationStore {
  constructor(
    public db: Database,
    public blobs: BlobStore,
  ) {}
  async authorize(
    p: Principal,
    sql: Sql = this.db,
  ): Promise<Grant | undefined> {
    if (!p.owner || p.owner === "local")
      throw new IntegrationError(
        "unauthorized",
        "Sign in to a named Proof account.",
        401,
      );
    if (!p.grantId) return;
    const g = (
      await sql.query(
        "SELECT * FROM proof_platform_grants WHERE id=$1 AND owner=$2 AND active=true",
        [p.grantId, p.owner],
      )
    ).rows[0] as Grant;
    if (!g)
      throw new IntegrationError(
        "grant_revoked",
        "This platform grant was revoked. Reconnect Proof.",
        401,
      );
    if (!p.scopes.every((s) => g.scopes.includes(s)))
      throw new IntegrationError(
        "insufficient_scope",
        "This platform grant no longer permits the action.",
        403,
      );
    return g;
  }
  async workspace(p: Principal, sql: Sql = this.db) {
    await this.authorize(p, sql);
    return workspace(sql, p.owner);
  }
  async grantFor(issuer: string, subject: string, client: string) {
    return (
      await this.db.query(
        "SELECT * FROM proof_platform_grants WHERE issuer=$1 AND subject=$2 AND client_id=$3 AND active=true",
        [issuer, subject, client],
      )
    ).rows[0] as Grant | undefined;
  }
  async saveGrant(
    owner: string,
    identity: {
      issuer: string;
      subject: string;
      clientId: string;
      platform: string;
      scopes: string[];
    },
    sourceIds: string[],
  ) {
    return this.db.transaction(async (tx) => {
      await lock(tx, "grants");
      await this.authorize({ owner, scopes: [] }, tx);
      const old = (
        await tx.query(
          "SELECT * FROM proof_platform_grants WHERE issuer=$1 AND subject=$2 AND client_id=$3",
          [identity.issuer, identity.subject, identity.clientId],
        )
      ).rows[0];
      if (old && old.owner !== owner)
        throw new IntegrationError(
          "account_mismatch",
          "This authorization belongs to another Proof account.",
          403,
        );
      const ws = await workspace(tx, owner);
      for (const id of sourceIds) await asset(tx, ws, id);
      const id = old?.id || randomUUID();
      await tx.query(
        "INSERT INTO proof_platform_grants(id,owner,issuer,subject,client_id,platform,scopes,source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(issuer,subject,client_id) DO UPDATE SET active=true,scopes=EXCLUDED.scopes,source_ids=EXCLUDED.source_ids",
        [
          id,
          owner,
          identity.issuer,
          identity.subject,
          identity.clientId,
          identity.platform,
          JSON.stringify(identity.scopes),
          JSON.stringify([...new Set(sourceIds)]),
        ],
      );
      return {
        id,
        platform: identity.platform,
        scopes: identity.scopes,
        sourceIds,
      };
    });
  }
  async grants(owner: string) {
    await this.authorize({ owner, scopes: [] });
    return (
      await this.db.query(
        'SELECT id,platform,scopes,source_ids AS "sourceIds",active FROM proof_platform_grants WHERE owner=$1',
        [owner],
      )
    ).rows;
  }
  async selectGrantSources(owner: string, id: string, sourceIds: string[]) {
    return this.db.transaction(async (tx) => {
      await lock(tx, "grants");
      const grant = (
        await tx.query(
          "SELECT * FROM proof_platform_grants WHERE id=$1 AND owner=$2 AND active=true",
          [id, owner],
        )
      ).rows[0];
      if (!grant) throw unavailable();
      const ws = await workspace(tx, owner);
      for (const s of sourceIds) await asset(tx, ws, s);
      await tx.query(
        "UPDATE proof_platform_grants SET source_ids=$2 WHERE id=$1",
        [id, JSON.stringify([...new Set(sourceIds)])],
      );
      const runs = (
        await tx.query(
          "SELECT r.id,r.input FROM runs r JOIN proof_connector_submissions c ON c.id=r.id WHERE c.grant_id=$1 AND r.status IN ('queued','running')",
          [id],
        )
      ).rows;
      for (const r of runs)
        if (
          r.input.selectedSources.some(
            (s: Selection) => !sourceIds.includes(s.assetId),
          )
        )
          await this.cancelNative(tx, ws, r.id, "Source access was revoked.");
    });
  }
  async revokeGrant(owner: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lock(tx, "grants");
      const g = (
        await tx.query(
          "UPDATE proof_platform_grants SET active=false WHERE id=$1 AND owner=$2 RETURNING id",
          [id, owner],
        )
      ).rows[0];
      if (!g) throw unavailable();
      const ws = await workspace(tx, owner);
      const rows = (
        await tx.query(
          "SELECT id FROM proof_connector_submissions WHERE grant_id=$1",
          [id],
        )
      ).rows;
      for (const r of rows)
        await this.cancelNative(
          tx,
          ws,
          r.id,
          "Platform authorization revoked.",
        );
      return { revoked: true, checksCancelled: true, importsMayFinish: true };
    });
  }
  async allowReconnection(owner: string, id: string) {
    await this.authorize({ owner, scopes: [] });
    const r = (
      await this.db.query(
        "UPDATE proof_platform_grants SET active=true WHERE id=$1 AND owner=$2 RETURNING id",
        [id, owner],
      )
    ).rows[0];
    if (!r) throw unavailable();
    return { id, active: true };
  }
  async librarySource(
    p: Principal,
    id: string,
    version?: string,
    sql: Sql = this.db,
  ) {
    const g = await this.authorize(p, sql);
    if (g && !g.source_ids.includes(id)) throw unavailable();
    const ws = await workspace(sql, p.owner);
    const a = await asset(sql, ws, id);
    const ext = (
      await sql.query(
        "SELECT id,status,coverage FROM extractions WHERE workspace_id=$1 AND asset_id=$2 ORDER BY created_at DESC,id LIMIT 1",
        [ws, id],
      )
    ).rows[0];
    if (version && ext?.id !== version) throw unavailable();
    return { ...a, extraction: ext };
  }
  async confirmChapterMap(owner: string, id: string, input: ChapterMap) {
    const p = { owner, scopes: [] };
    const ws = await this.workspace(p);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
      const a = await this.librarySource(p, id, input.version, tx);
      if (!/\.pdf$/i.test(a.filename))
        throw new IntegrationError(
          "invalid_mapping",
          "Chapter page mappings require the original PDF.",
        );
      await validateSelection(tx, ws, [
        {
          assetId: id,
          extractionId: input.version,
          pageRanges: input.mappings,
        },
      ]);
      await tx.query(
        "UPDATE source_assets SET metadata=metadata || $3::jsonb WHERE workspace_id=$1 AND id=$2",
        [
          ws,
          id,
          JSON.stringify({
            chapterMap: {
              extractionId: input.version,
              mappings: input.mappings,
              confirmedBy: owner,
            },
          }),
        ],
      );
      return { id, version: input.version, mappings: input.mappings };
    });
  }
  async searchLibrary(p: Principal, query: string, offset = 0, limit = 20) {
    requireScope(p, "library:read");
    const g = await this.authorize(p);
    const ws = await workspace(this.db, p.owner);
    const rows = (
      await this.db.query(
        "SELECT a.*,e.id AS extraction_id,e.status AS extraction_status FROM source_assets a LEFT JOIN LATERAL (SELECT id,status FROM extractions WHERE workspace_id=a.workspace_id AND asset_id=a.id ORDER BY created_at DESC,id LIMIT 1) e ON true WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND (a.metadata->>'title') ILIKE $2 AND (a.metadata->>'retrievedByRunId' IS NULL OR a.metadata->>'librarySelected'='true') ORDER BY a.created_at,a.id",
        [ws, `%${query.replace(/[\\%_]/g, "\\$&")}%`],
      )
    ).rows.filter((r) => !g || g.source_ids.includes(r.id));
    return {
      sources: rows.slice(offset, offset + limit).map((r) => ({
        id: r.id,
        version: r.extraction_id,
        title: r.metadata.title,
        origin: r.metadata.connectorOrigin || "library",
        access: r.access,
        status: r.status,
        pdf: /\.pdf$/i.test(r.filename),
        chapterMappings:
          r.metadata.chapterMap?.extractionId === r.extraction_id
            ? r.metadata.chapterMap.mappings
            : [],
        notices:
          r.extraction_status === "partial"
            ? [
                "Some original content could not be extracted. Inspect extraction coverage.",
              ]
            : [],
      })),
      nextOffset: offset + limit < rows.length ? offset + limit : undefined,
    };
  }
  async ensureRunAccess(p: Principal, run: any, sql: Sql = this.db) {
    await this.authorize(p, sql);
    const ws = await workspace(sql, p.owner);
    if (run.workspace_id !== ws || run.invalidated) throw unavailable();
    for (const s of run.input.selectedSources)
      await this.librarySource(p, s.assetId, s.extractionId, sql);
    return ws;
  }
  async createRun(
    p: Principal,
    input: RunInput,
    enabled = process.env.PROOF_CHECK_CREATION_ENABLED !== "false",
  ) {
    requireScope(p, "checks:run");
    if (input.kind === "check_sources") requireScope(p, "library:read");
    const ws = await this.workspace(p);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
      await this.authorize(p, tx);
      const requestHash = digest({ ...input, idempotencyKey: undefined });
      const old = (
        await tx.query(
          "SELECT id,input_hash FROM proof_connector_submissions WHERE owner=$1 AND idempotency_key=$2",
          [p.owner, input.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== requestHash)
          throw new IntegrationError(
            "idempotency_conflict",
            "This key was already used for different input.",
            409,
          );
        const r = await ownedRun(tx, ws, old.id);
        await this.ensureRunAccess(p, r, tx);
        return {
          ...r,
          receipt: (
            await tx.query(
              "SELECT * FROM proof_connector_submissions WHERE id=$1",
              [r.id],
            )
          ).rows[0],
        };
      }
      if (!enabled)
        throw new IntegrationError(
          "creation_disabled",
          "New checks are temporarily disabled. Existing reports remain readable.",
          503,
        );
      const selections: Selection[] = [];
      for (const s of input.sources) {
        const a = await this.librarySource(p, s.id, s.version, tx);
        let pageRanges = s.range?.pages ? [s.range.pages] : [];
        if (s.range?.chapters) {
          const map = a.metadata.chapterMap;
          const range = s.range.chapters;
          if (
            !map ||
            map.extractionId !== s.version ||
            range.to - range.from >= 100
          )
            throw new IntegrationError(
              "unmapped_range",
              "Chapter ranges need a confirmed page mapping for this exact extraction.",
            );
          pageRanges = [];
          for (let chapter = range.from; chapter <= range.to; chapter++) {
            const mapped = map.mappings.find((m: any) => m.chapter === chapter);
            if (!mapped)
              throw new IntegrationError(
                "unmapped_range",
                `Chapter ranges include chapter ${chapter}, which has no confirmed PDF page mapping.`,
              );
            pageRanges.push({ from: mapped.from, to: mapped.to });
          }
        }
        selections.push({ assetId: s.id, extractionId: s.version, pageRanges });
      }
      await validateSelection(tx, ws, selections);
      let documentVersion = input.documentVersion;
      if (documentVersion) {
        const doc = (
          await tx.query(
            "SELECT text,document_id FROM document_versions WHERE workspace_id=$1 AND id=$2",
            [ws, documentVersion],
          )
        ).rows[0];
        if (!doc || doc.text !== input.text)
          throw new IntegrationError(
            "document_mismatch",
            "The authorized document version does not contain the exact submitted text.",
            409,
          );
        for (const selection of selections)
          await requireWorkSource(tx, ws, doc.document_id, selection.assetId);
      } else {
        const document = randomUUID();
        documentVersion = randomUUID();
        await tx.query(
          "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,$3,$4)",
          [document, ws, "Explicitly submitted passage", documentVersion],
        );
        await tx.query(
          "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
          [documentVersion, ws, document, input.text],
        );
        for (const selection of selections)
          await attachSource(tx, ws, document, selection.assetId);
      }
      const transactionDb: Database = {
        query: (s, v) => tx.query(s, v),
        transaction: (work) => work(tx),
        close: async () => {},
      };
      const run = await sharedCreateRun(
        transactionDb,
        ws,
        {
          documentVersionId: documentVersion!,
          mode:
            input.kind === "check_sources"
              ? "source_check"
              : input.kind === "find_sources"
                ? "discover"
                : "fact_check",
          checkScope: "selected_library",
          selectedSources: selections,
          externalAccess: input.kind === "check_sources" ? "none" : "research",
          sourcePolicy:
            input.kind === "check_sources" ? "user_supplied" : "academic",
          citationProfile: "mla9",
          citationOutput: "audit",
          allowProviderProcessing: true,
          budgetPreset: "standard",
          ...(input.kind === "find_sources"
            ? { claimSpans: [{ start: 0, end: input.text.length }] }
            : {}),
        },
        `connector:${input.idempotencyKey}`,
      );
      await tx.query(
        "INSERT INTO proof_connector_submissions(id,owner,grant_id,idempotency_key,input_hash,input,text_hash,schema_version,budget_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          run.id,
          p.owner,
          p.grantId || null,
          input.idempotencyKey,
          requestHash,
          JSON.stringify({ ...input, documentVersion }),
          hash(input.text),
          SCHEMA_VERSION,
          input.budgetUsd,
        ],
      );
      return {
        ...run,
        receipt: (
          await tx.query(
            "SELECT * FROM proof_connector_submissions WHERE id=$1",
            [run.id],
          )
        ).rows[0],
      };
    });
  }
  async getRun(p: Principal, id: string) {
    requireScope(p, "reports:read");
    const ws = await this.workspace(p);
    try {
      const run = await ownedRun(this.db, ws, id);
      await this.ensureRunAccess(p, run);
      return {
        ...run,
        receipt: (
          await this.db.query(
            "SELECT * FROM proof_connector_submissions WHERE id=$1 AND owner=$2",
            [id, p.owner],
          )
        ).rows[0],
      };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw unavailable();
      throw e;
    }
  }
  private async cancelNative(tx: Sql, ws: string, id: string, error: string) {
    await tx.query(
      "UPDATE runs SET status='cancelled',cancel_requested=true,error=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status IN ('queued','running')",
      [ws, id, error],
    );
  }
  async cancel(p: Principal, id: string) {
    requireScope(p, "checks:run");
    const ws = await this.workspace(p);
    const run = await ownedRun(this.db, ws, id);
    await this.ensureRunAccess(p, run);
    return this.db.transaction(async (tx) => {
      await this.authorize(p, tx);
      await this.cancelNative(tx, run.workspace_id, id, "Cancelled by user.");
      return { id, status: (await ownedRun(tx, run.workspace_id, id)).status };
    });
  }
  async deleteSource(owner: string, id: string) {
    const ws = await this.workspace({ owner, scopes: [] });
    await deleteAsset(this.db, ws, id);
    return { deleted: true, status: "deleting" };
  }
  async enqueueImport(p: Principal, input: ImportInput) {
    requireScope(p, "sources:import");
    const ws = await this.workspace(p);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
      await this.authorize(p, tx);
      const inputHash = digest(input.items);
      const old = (
        await tx.query(
          "SELECT * FROM proof_connector_imports WHERE owner=$1 AND idempotency_key=$2",
          [p.owner, input.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== inputHash)
          throw new IntegrationError(
            "idempotency_conflict",
            "This import key was used for different input.",
            409,
          );
        return { id: old.id, status: "queued" };
      }
      if (process.env.PROOF_CHECK_CREATION_ENABLED === "false")
        throw new IntegrationError(
          "creation_disabled",
          "New imports are temporarily disabled.",
          503,
        );
      const inventory = (
        await tx.query(
          "SELECT count(*)::int AS assets FROM source_assets WHERE workspace_id=$1 AND deleted_at IS NULL",
          [ws],
        )
      ).rows[0];
      const pending = (
        await tx.query(
          "SELECT count(*)::int AS imports FROM source_imports WHERE workspace_id=$1 AND status IN ('queued','running')",
          [ws],
        )
      ).rows[0];
      const newAssets = input.items.filter(
        (i) => i.kind !== "candidate" && i.kind !== "bibliography",
      ).length;
      if (
        Number(inventory.assets) + newAssets > 1000 ||
        Number(pending.imports) + input.items.length > 16
      )
        throw new IntegrationError(
          "import_limit",
          "Finish pending imports or remove unused sources before importing more.",
          429,
        );
      const entries: any[] = [];
      for (const item of input.items) {
        if (item.kind === "candidate") {
          requireScope(p, "reports:read");
          const run = await ownedRun(tx, ws, item.checkId);
          await this.ensureRunAccess(p, run, tx);
          if (run.input.mode === "source_check") throw unavailable();
          const candidates = (
            await tx.query(
              "SELECT data FROM research_results WHERE workspace_id=$1 AND run_id=$2",
              [ws, item.checkId],
            )
          ).rows.flatMap((r) => r.data.candidates || []);
          if (!candidates.some((c) => c.assetId === item.sourceId))
            throw unavailable();
          const a = await asset(tx, ws, item.sourceId);
          await tx.query(
            "UPDATE source_assets SET metadata=metadata || '{\"librarySelected\":true}'::jsonb WHERE workspace_id=$1 AND id=$2",
            [ws, a.id],
          );
          entries.push({ assetId: a.id, reused: true });
        } else {
          const id = randomUUID();
          let assetId: string | undefined;
          if (item.kind === "bibliography") {
            await tx.query(
              "INSERT INTO reference_imports(id,workspace_id,original,settings) VALUES($1,$2,$3,$4)",
              [id, ws, item.text, JSON.stringify({ externalAccess: false })],
            );
          } else {
            const bytes = item.kind === "file" ? decodeFile(item) : undefined;
            const metadata = {
              title:
                item.title ||
                (item.kind === "file"
                  ? item.filename
                  : item.kind === "link"
                    ? item.url
                    : "Source"),
              authors: [],
              year: "",
              ...("edition" in item && item.edition
                ? { edition: item.edition }
                : {}),
              connectorOrigin: item.kind,
              allowExternalProcessing: false,
            };
            const a = await createAsset(
              tx,
              ws,
              metadata,
              item.kind === "file" ? item.filename : "source.txt",
              item.kind === "file" ? item.contentType : "text/plain",
              bytes?.length,
            );
            assetId = a.id;
            if (bytes) {
              await this.blobs.put(
                a.key,
                bytes,
                item.kind === "file" ? item.contentType : "text/plain",
              );
              await tx.query(
                "UPDATE source_assets SET checksum=$3,status='queued' WHERE workspace_id=$1 AND id=$2",
                [ws, a.id, createHash("sha256").update(bytes).digest("hex")],
              );
            }
          }
          const kind = item.kind === "link" ? "url" : item.kind;
          const native = {
            kind,
            assetId,
            ...("text" in item ? { text: item.text } : {}),
            ...(item.kind === "link"
              ? { url: item.url, externalAccess: true }
              : {}),
            externalAccess: item.kind === "link",
          };
          await tx.query(
            "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,$3,$4)",
            [id, ws, kind, JSON.stringify(native)],
          );
          await enqueue(tx, ws, "import", id);
          entries.push({ importId: id, assetId });
        }
      }
      if (p.grantId) {
        const selected = entries.filter((e) => e.assetId).map((e) => e.assetId);
        await tx.query(
          "UPDATE proof_platform_grants SET source_ids=source_ids || $2::jsonb WHERE id=$1",
          [p.grantId, JSON.stringify(selected)],
        );
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO proof_connector_imports(id,owner,workspace_id,grant_id,idempotency_key,input_hash,entries) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          p.owner,
          ws,
          p.grantId || null,
          input.idempotencyKey,
          inputHash,
          JSON.stringify(entries),
        ],
      );
      return { id, status: "queued" };
    });
  }
  async getImport(p: Principal, id: string) {
    requireScope(p, "reports:read");
    await this.authorize(p);
    const row = (
      await this.db.query(
        "SELECT * FROM proof_connector_imports WHERE id=$1 AND owner=$2",
        [id, p.owner],
      )
    ).rows[0];
    if (!row || (p.grantId && row.grant_id !== p.grantId)) throw unavailable();
    const imports = row.entries
      .filter((e: any) => e.importId)
      .map((e: any) => e.importId);
    const records = imports.length
      ? (
          await this.db.query(
            "SELECT id,status,result FROM source_imports WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
            [row.workspace_id, imports],
          )
        ).rows
      : [];
    const status = records.some((r) => r.status === "failed")
      ? "failed"
      : records.length === imports.length &&
          records.every((r) => r.status === "complete")
        ? "complete"
        : "queued";
    const bibliography = imports.length
      ? (
          await this.db.query(
            "SELECT original,status FROM reference_entries WHERE workspace_id=$1 AND import_id=ANY($2::uuid[]) ORDER BY ordinal",
            [row.workspace_id, imports],
          )
        ).rows
      : [];
    return {
      id,
      kind: "import_sources",
      status,
      result: {
        sources: row.entries
          .filter((e: any) => e.assetId)
          .map((e: any) => ({ id: e.assetId, reused: e.reused })),
        referenceImportVersionIds: imports.filter(
          (i: string) =>
            records.find((r) => r.id === i)?.result.referenceImportVersionId,
        ),
        notices: bibliography
          .filter((r) => r.status !== "matched_ready")
          .map((r) => `Unresolved reference: ${r.original}`),
      },
      error:
        status === "failed"
          ? "One or more sources could not be imported. Inspect source status; unusable sources were not treated as evidence."
          : undefined,
    };
  }
}
