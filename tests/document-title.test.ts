import assert from "node:assert/strict";
import test from "node:test";
import { readableDocumentTitle } from "../src/document-title";

test("repairs a stored filename decoded as Latin-1", () => {
  const title = "INS Essay_Dušan Zábrodský (1)";
  assert.equal(
    readableDocumentTitle(Buffer.from(title, "utf8").toString("latin1")),
    title,
  );
});

test("preserves correctly decoded and invalid filenames", () => {
  for (const title of [
    "Dušan Zábrodský",
    "Résumé",
    "Åland",
    "研究 📚",
    "Ã notes",
    "Å¡ café",
  ])
    assert.equal(readableDocumentTitle(title), title);
});
