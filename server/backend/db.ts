import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export interface Sql {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function database(url = process.env.DATABASE_URL): Database {
  if (!url)
    throw new Error("DATABASE_URL is required for the persistent backend.");
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
  });
  return {
    query: (sql, args) => pool.query(sql, args),
    close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(
    new URL("../../migrations/001_backend.sql", import.meta.url),
    "utf8",
  );
  const connectors = await readFile(
    new URL("../../migrations/002_integrations.sql", import.meta.url),
    "utf8",
  );
  const citations = await readFile(
    new URL("../../migrations/003_citation_plans.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(90731001)");
    await tx.query(sql);
    await tx.query(connectors);
    await tx.query(citations);
  });
}
export async function workspace(db: Sql, owner: string): Promise<string> {
  const r = await db.query(
    "INSERT INTO workspaces(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET owner_id=excluded.owner_id RETURNING id",
    [randomUUID(), owner],
  );
  return r.rows[0].id;
}
export async function enqueue(
  tx: Sql,
  ws: string,
  kind: string,
  target: string,
) {
  await tx.query(
    "INSERT INTO job_outbox(id,workspace_id,kind,target_id) VALUES($1,$2,$3,$4) ON CONFLICT(kind,target_id) DO NOTHING",
    [randomUUID(), ws, kind, target],
  );
}
export async function event(
  tx: Sql,
  ws: string,
  run: string,
  type: string,
  data: unknown = {},
) {
  await tx.query(
    "INSERT INTO run_events(workspace_id,run_id,type,data) VALUES($1,$2,$3,$4)",
    [ws, run, type, JSON.stringify(data)],
  );
}
