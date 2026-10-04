import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/test23-citations.json";
import {
  citationReferences,
  referenceMetadata,
} from "../server/backend/citation-mapping.js";
import { parseCitationOccurrences } from "../shared/citation-occurrences.js";
import { parseReference } from "../server/backend/references.js";
import { selectClaims } from "../shared/claims.js";

test("retrieved text replaces the citation identity of an abstract placeholder", () => {
  const metadata = {
    title: "Controlled study",
    authors: ["Brown"],
    year: "2024",
    doi: "10.1234/study",
  };
  const references = citationReferences(
    [
      { id: "abstract", metadata },
      { id: "full-text", metadata },
    ],
    [{ asset_id: "abstract", resolvedAssetId: "full-text", parsed: metadata }],
  );
  const occurrence = parseCitationOccurrences(
    "A result (Brown 2024).",
    references,
  )[0];
  assert.equal(occurrence.items[0].status, "matched");
  assert.deepEqual(occurrence.items[0].sourceIds, ["full-text"]);
});

test("test23 imported author identities map all available works without claiming full-text access", () => {
  const references = citationReferences(fixture.sources, []);
  const occurrences = parseCitationOccurrences(fixture.text, references);
  assert.equal(occurrences.length, 9);
  assert.deepEqual(
    occurrences.map((o) => o.items[0].sourceIds),
    [
      [],
      ["ji"],
      ["ji"],
      ["parasuraman"],
      ["parasuraman"],
      ["risko"],
      ["sparrow"],
      ["sparrow"],
      [],
    ],
  );
  for (const occurrence of occurrences)
    assert.equal(
      fixture.text.slice(occurrence.start, occurrence.end),
      occurrence.raw,
    );
});

test("APA bibliography retains explicit family names, initials, and every listed author", () => {
  const source = fixture.sources.find((s) => s.id === "ji")!;
  const parsed = parseReference(source.metadata.importedReference);
  assert.equal(parsed.authorDetails.length, 10);
  assert.deepEqual(parsed.authorDetails[0], { family: "Ji", given: "Z." });
  assert.deepEqual(parsed.authorDetails.at(-1), {
    family: "Fung",
    given: "P.",
  });
  const pair = parseReference(
    fixture.sources.find((s) => s.id === "parasuraman")!.metadata
      .importedReference,
  );
  assert.deepEqual(pair.authorDetails, [
    { family: "Parasuraman", given: "R." },
    { family: "Riley", given: "V." },
  ]);
});

test("legacy imported reference names are recovered only for the same DOI", () => {
  const source = fixture.sources.find((s) => s.id === "ji")!;
  assert.deepEqual(referenceMetadata(source.metadata).authors?.[0], {
    family: "Ji",
    given: "Z.",
  });
  const mismatched = referenceMetadata({
    ...source.metadata,
    doi: "10.1234/other",
  });
  assert.deepEqual(mismatched.authors, source.metadata.authors);
  const organization = referenceMetadata({
    title: "Report",
    authors: ["World Health Organization"],
  });
  assert.deepEqual(organization.authors, ["World Health Organization"]);
  const unidentified = referenceMetadata({
    authors: ["Jane Smith"],
    doi: "invalid",
    importedReference: "Smith, J. (2024). A study. Journal.",
  });
  assert.deepEqual(unidentified.authors, ["Jane Smith"]);
  const identifierOnly = referenceMetadata({
    authors: ["Jane Smith"],
    doi: "10.1234/study",
    importedReference: "https://doi.org/10.1234/study",
  });
  assert.deepEqual(identifierOnly.authors, ["Jane Smith"]);
});

test("test23 retains the memory-damage assertion for automatic checking", () => {
  const selected = selectClaims(fixture.text);
  assert.equal(selected.candidates.length, 23);
  assert.ok(
    selected.candidates.some((c) => c.text.startsWith("These findings mean")),
  );
  assert.ok(
    !selected.skipped.some((c) =>
      fixture.text.slice(c.start, c.end).includes("permanently damages"),
    ),
  );
});
