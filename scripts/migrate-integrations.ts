import { migrate, postgres } from "../server/integrations/database.js";
const db = postgres();
try {
  await migrate(db);
  console.log("Proof integration schema ready.");
} finally {
  await db.close();
}
