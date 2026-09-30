import { database, migrate } from "../server/backend/db.js";

const db = database();
try {
  await migrate(db);
  console.log("Persistent backend schema is ready.");
} finally {
  await db.close();
}
