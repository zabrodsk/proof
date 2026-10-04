import { randomUUID } from "node:crypto";
import { documentReferences } from "../../shared/document-sources.js";
import { enqueue, type Sql } from "./db.js";
import { limits, HttpError } from "./config.js";
import { reconstructReferences } from "./references.js";

export async function queueDocumentSources(
  tx: Sql,
  ws: string,
  documentId: string,
  text: string,
  externalAccess: boolean,
) {
  const references = documentReferences(text);
  if (!references) return;
  if (reconstructReferences(references).length > limits.bibliographyEntries)
    throw new HttpError(
      422,
      `The document exceeds the ${limits.bibliographyEntries}-reference import limit. Import a shorter section.`,
    );
  const previous = (
    await tx.query(
      "SELECT id FROM source_imports WHERE workspace_id=$1 AND kind='bibliography' AND input->>'documentId'=$2 AND input->>'text'=$3 AND input->>'automatic'='true' AND input->>'externalAccess'=$4 ORDER BY created_at DESC LIMIT 1",
      [ws, documentId, references, String(externalAccess)],
    )
  ).rows[0];
  if (previous) return previous.id;
  const id = randomUUID();
  await tx.query(
    "INSERT INTO reference_imports(id,workspace_id,original,settings) VALUES($1,$2,$3,$4)",
    [
      id,
      ws,
      references,
      JSON.stringify({ externalAccess, automatic: true, documentId }),
    ],
  );
  await tx.query(
    "INSERT INTO source_imports(id,workspace_id,kind,input) VALUES($1,$2,'bibliography',$3)",
    [
      id,
      ws,
      JSON.stringify({
        documentId,
        text: references,
        externalAccess,
        automatic: true,
      }),
    ],
  );
  await enqueue(tx, ws, "import", id);
  return id;
}
