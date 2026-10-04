import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { migrateIntegrationTables } from "../../server/integrations/database.js";
import { type Database, workspace, migrate } from "../../server/backend/db.js";
import { IntegrationStore } from "../../server/integrations/store.js";
import { IntegrationService } from "../../server/integrations/service.js";
import {
  scopes,
  runInputSchema,
  type Principal,
  type RunInput,
} from "../../shared/integrations/contracts.js";
import { createAsset, ingestAsset } from "../../server/backend/library.js";
import type { BlobStore } from "../../server/backend/storage.js";
import { processRun, type EngineDeps } from "../../server/backend/engine.js";
import {
  research,
  resolveSelectedReferences,
} from "../../server/backend/research.js";
import { processImport } from "../../server/backend/imports.js";
export const alice: Principal = { owner: "user_alice", scopes: [...scopes] };
export const bob: Principal = { owner: "user_bob", scopes: [...scopes] };
export async function fixture(path?: string) {
  const pg = new PGlite({ dataDir: path, extensions: { vector } });
  const db: Database = {
    query: async (s, p) => {
      if (p?.length) return pg.query(s, p);
      const results = await pg.exec(s);
      return results[results.length - 1] || { rows: [] };
    },
    transaction: (work) =>
      pg.transaction((tx) =>
        work({
          query: async (s, p) => {
            if (p?.length) return tx.query(s, p);
            const results = await tx.exec(s);
            return results.at(-1) || { rows: [] };
          },
        }),
      ),
    close: () => pg.close(),
  };
  await migrate(db);
  await migrateIntegrationTables(db);
  const objects = new Map<string, Buffer>();
  const blobs: BlobStore = {
    put: async (key, bytes) => {
      objects.set(key, bytes);
    },
    get: async (key) => {
      const bytes = objects.get(key);
      if (!bytes) throw Error("No object");
      return bytes;
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
  const store = new IntegrationStore(db, blobs);
  const service = new IntegrationService(store, "https://proof.example");
  return { db, blobs, objects, store, service, close: () => db.close() };
}
export const input = (v: Partial<RunInput> = {}): RunInput =>
  runInputSchema.parse({
    kind: "check_facts",
    text: "The study included 120 adults.",
    idempotencyKey: crypto.randomUUID(),
    ...v,
  });
export function source() {
  return {
    id: crypto.randomUUID(),
    version: "",
    text: "The trial included 120 adults. Reading was not measured.",
    title: "Original edition",
  };
}
export async function saveSource(
  store: IntegrationStore,
  s: ReturnType<typeof source>,
  owner = alice.owner,
) {
  const ws = await workspace(store.db, owner);
  const a = await store.db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      {
        title: s.title,
        authors: [],
        year: "",
        edition: "User-selected original edition",
      },
      "source.txt",
      "text/plain",
      Buffer.byteLength(s.text),
      s.id,
    ),
  );
  await store.blobs.put(a.key, Buffer.from(s.text), "text/plain");
  s.version = await ingestAsset(store.db, store.blobs, ws, s.id);
  return s;
}
export async function platform(
  store: IntegrationStore,
  p = alice,
  sourceIds: string[] = [],
  clientId = "chatgpt-client",
) {
  const g = await store.saveGrant(
    p.owner,
    {
      issuer: "https://auth.example",
      subject: p.owner,
      clientId,
      platform: clientId.includes("claude") ? "claude" : "chatgpt",
      scopes: p.scopes,
    },
    sourceIds,
  );
  return { ...p, grantId: g.id };
}
export async function runFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  judge: EngineDeps["judge"] = async (claim, s, passages) => ({
    ...claim,
    sourceId: s.id,
    status: "supported",
    method: "Jev",
    explanation:
      "Controlled regression fixture, not an evaluation of accuracy.",
    evidence: passages?.[0],
    checkedPassages: passages,
  }),
) {
  const row = (
    await f.db.query("SELECT workspace_id FROM runs WHERE id=$1", [id])
  ).rows[0];
  await processRun(f.db, f.blobs, row.workspace_id, id, {
    judge,
    research,
    resolveReferences: resolveSelectedReferences,
  });
}
export async function finishImports(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
) {
  const row = (
    await f.db.query("SELECT * FROM proof_connector_imports WHERE id=$1", [id])
  ).rows[0];
  for (const e of row.entries)
    if (e.importId)
      await processImport(f.db, f.blobs, row.workspace_id, e.importId);
}
