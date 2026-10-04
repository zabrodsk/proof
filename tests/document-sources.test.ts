import { test } from "node:test";
import assert from "node:assert/strict";
import { documentReferences } from "../shared/document-sources.js";

test("detects supplied references and identifiers without importing prose", () => {
  const text =
    "A claim (Smith 2024). See https://example.org/paper.\n\n## References\nSmith, Jane. “A study.” Journal, 2024.\n  https://doi.org/10.1234/study\n\nAppendix\nPrivate notes.";
  const references = documentReferences(text);
  assert.ok(references.includes("Smith, Jane. “A study.”"));
  assert.ok(references.includes("https://example.org/paper"));
  assert.equal(references.includes("A claim"), false);
  assert.equal(references.includes("Private notes"), false);
  assert.equal(references.match(/10\.1234\/study/g)?.length, 1);
});

test("author-only citations and ordinary prose do not invent sources", () => {
  assert.equal(documentReferences("Smith (2024) reports a finding."), "");
});

test("extracts bibliographic footnotes without treating numbered arguments as sources", () => {
  assert.equal(
    documentReferences(
      "1. Smith, Jane. “A study.” Journal, 2024.\n2. The experiment failed in 2024.",
    ),
    "1. Smith, Jane. “A study.” Journal, 2024.",
  );
});

test("detects bare DOIs and deduplicates source links", () => {
  assert.equal(
    documentReferences("DOI: 10.1234/Test. Again 10.1234/test."),
    "https://doi.org/10.1234/test",
  );
  assert.equal(
    documentReferences("https://example.org/a https://example.org/a."),
    "https://example.org/a",
  );
});
