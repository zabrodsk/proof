import { readFile } from "node:fs/promises";
import {
  database,
  migrate as migrateBackend,
  type Database,
  type Sql,
} from "../backend/db.js";
export type { Database, Sql } from "../backend/db.js";
export const postgres = database;
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
  const migration = await readFile(
    new URL("../../migrations/002_integrations.sql", import.meta.url),
    "utf8",
  );
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
