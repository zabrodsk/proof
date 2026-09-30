import { database } from "./backend/db.js";
import { migrate } from "./integrations/database.js";
import { storage } from "./backend/storage.js";
import { startWorker } from "./backend/queue.js";

const db = database();
try {
  await migrate(db);
  const worker = await startWorker(db, storage());
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    await db.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      shutdown().catch(() => {
        console.error("Worker shutdown failed.");
        process.exitCode = 1;
      });
    });
  console.log("Proof worker is consuming durable jobs.");
} catch {
  console.error(
    "Worker startup failed. Check database, migrations, and private storage configuration.",
  );
  await db.close();
  process.exitCode = 1;
}
