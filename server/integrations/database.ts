import {
  database,
  migrate as migrateBackend,
  type Database,
  type Sql,
} from "../backend/db.js";
export type { Database, Sql } from "../backend/db.js";
export const postgres = database;
export const migration = `
CREATE TABLE IF NOT EXISTS proof_integration_locks (id text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS proof_platform_grants (
 id uuid PRIMARY KEY, owner text NOT NULL, issuer text NOT NULL, subject text NOT NULL, client_id text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('chatgpt','claude')), scopes jsonb NOT NULL, source_ids jsonb NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject,client_id)
);
CREATE TABLE IF NOT EXISTS proof_connector_submissions (
 id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, owner text NOT NULL, grant_id uuid REFERENCES proof_platform_grants(id),
 idempotency_key text NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL, text_hash text NOT NULL, schema_version text NOT NULL,
 budget_usd double precision NOT NULL, reserved_usd double precision NOT NULL DEFAULT 0, UNIQUE(owner,idempotency_key)
);
CREATE TABLE IF NOT EXISTS proof_connector_imports (
 id uuid PRIMARY KEY, owner text NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id), grant_id uuid REFERENCES proof_platform_grants(id),
 idempotency_key text NOT NULL, input_hash text NOT NULL, entries jsonb NOT NULL, UNIQUE(owner,idempotency_key)
);
CREATE TABLE IF NOT EXISTS proof_connector_budgets (
 bucket text NOT NULL, day date NOT NULL, usd double precision NOT NULL, calls integer NOT NULL, PRIMARY KEY(bucket,day)
);
`;
export async function lock(sql: Sql, id: string) {
  await sql.query(
    "INSERT INTO proof_integration_locks(id) VALUES($1) ON CONFLICT DO NOTHING",
    [id],
  );
  await sql.query(
    "SELECT id FROM proof_integration_locks WHERE id=$1 FOR UPDATE",
    [id],
  );
}
export async function migrateIntegrationTables(db: Database) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS proof_integration_locks(id text PRIMARY KEY)",
  );
  await db.transaction(async (sql) => {
    await lock(sql, "integration-migration");
    for (const statement of migration.split(";").filter((s) => s.trim()))
      await sql.query(statement);
  });
}
export async function migrate(db: Database) {
  await migrateBackend(db);
  await migrateIntegrationTables(db);
}
