import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Database, Sql } from "./db.js";

// One in-process connection shared by the local API and durable worker.
export async function localDatabase(
  directory = process.env.PROOF_LOCAL_DATABASE_DIR || ".data/database",
): Promise<Database> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pg = new PGlite({ dataDir: directory, extensions: { vector } });
  function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
    return {
      async query(sql, values) {
        if (values?.length) {
          const result = await connection.query(sql, values);
          return { rows: result.rows, rowCount: result.affectedRows };
        }
        const result = (await connection.exec(sql)).at(-1);
        return { rows: result?.rows || [], rowCount: result?.affectedRows };
      },
    };
  }
  await pg.waitReady;
  return {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
}
