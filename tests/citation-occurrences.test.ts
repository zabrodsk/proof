import assert from "node:assert/strict";
import test from "node:test";
import { parseCitationOccurrences } from "../shared/citation-occurrences.js";
import { citations } from "../server/parse.js";

const references = [
  {
    id: "one",
    metadata: {
      title: "Evidence and Its Limits",
      authors: [{ family: "Smith", given: "Jane" }],
      year: 2024,
    },
  },
  {
    id: "two",
    metadata: {
      title: "Another Study",
      authors: [{ family: "Smith", given: "Jane" }],
      year: 2024,
    },
  },
  {
    id: "three",
    metadata: {
      title: "A Unicode Study",
      authors: [{ family: "García Márquez", given: "Gabriel" }],
      year: 2023,
    },
  },
];

test("occurrences retain repeated exact spans and each combined source", () => {
  const text =
    'A claim (Smith, "Evidence and Its Limits" 104). A claim (Smith, "Evidence and Its Limits" 104). Other (Unknown 42; García Márquez 12).';
  const parsed = parseCitationOccurrences(text, references);
  assert.equal(parsed.length, 3);
  for (const occurrence of parsed)
    assert.equal(text.slice(occurrence.start, occurrence.end), occurrence.raw);
  assert.deepEqual(parsed[0].items[0].sourceIds, ["one"]);
  assert.equal(parsed[2].items.length, 2);
  assert.equal(parsed[2].items[0].status, "unmatched");
  assert.deepEqual(parsed[2].items[1].sourceIds, ["three"]);
});

test("same-author works stay ambiguous until a matching title resolves them", () => {
  assert.equal(
    parseCitationOccurrences("A claim (Smith 104).", references)[0].items[0]
      .status,
    "ambiguous",
  );
  assert.deepEqual(
    parseCitationOccurrences(
      'A claim (Smith, "Another Study" 104).',
      references,
    )[0].items[0].sourceIds,
    ["two"],
  );
  assert.equal(
    parseCitationOccurrences(
      'A claim (Smith, "Unrelated Study" 104).',
      references,
    )[0].items[0].status,
    "unmatched",
  );
});

test("narrative citations use current-sentence author boundaries and retain page-only span", () => {
  const single = [references[0]];
  const text = "Smith reports an effect (104).";
  const parsed = parseCitationOccurrences(text, single);
  assert.equal(parsed[0].form, "narrative");
  assert.equal(parsed[0].raw, "(104)");
  assert.deepEqual(parsed[0].items[0].sourceIds, ["one"]);
  assert.equal(
    parseCitationOccurrences(
      "Smith wrote a paper. The effect persists (104).",
      single,
    ).length,
    0,
  );
  assert.equal(
    parseCitationOccurrences("Blacksmith reports a result (104).", single)
      .length,
    0,
  );
  assert.equal(
    parseCitationOccurrences("Sample size (n=50).", single).length,
    0,
  );
});

test("title-only sources match without an invented author and bibliography is excluded", () => {
  const text =
    'A claim ("An Anonymous Study" 12).\n\nWorks Cited\n"An Anonymous Study". 2024. https://doi.org/10.1234/example';
  const parsed = parseCitationOccurrences(text, [
    {
      id: "anonymous",
      metadata: { title: "An Anonymous Study", authors: [], year: 2024 },
    },
  ]);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].items[0].sourceIds, ["anonymous"]);
  assert.equal(parsed[0].items[0].author, undefined);
});

test("unknown APA narrative and recognized author-only references remain visible", () => {
  assert.deepEqual(citations("Smith (2024) reports an effect."), [
    "Smith 2024",
  ]);
  const parsed = parseCitationOccurrences("A claim (Smith).", [references[0]]);
  assert.equal(parsed[0].items[0].status, "matched");
  assert.equal(parsed[0].items[0].locator, undefined);
});

test("factual parentheticals with a year are not citations", () => {
  assert.deepEqual(
    parseCitationOccurrences(
      "Paris is the capital of France (its population doubled in 2024).",
      references,
    ),
    [],
  );
  assert.deepEqual(
    parseCitationOccurrences(
      "The trial grew (Its sample increased in 2024).",
      references,
    ),
    [],
  );
  assert.equal(
    parseCitationOccurrences("A finding (Unknown 2024).", references)[0]
      .items[0].status,
    "unmatched",
  );
});
