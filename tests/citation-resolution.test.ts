import assert from "node:assert/strict";
import test from "node:test";
import { parseCitationOccurrences } from "../shared/citation-occurrences.js";
import {
  citationReferences,
  claimCitationChecks,
} from "../server/backend/citation-mapping.js";
import { parseReference } from "../server/backend/references.js";
import * as bibliographyMatching from "../server/backend/references.js";

const bibliography = [
  "Sparrow, B., Liu, J., & Wegner, D. M. (2011). Google effects on memory: Cognitive consequences of having information at our fingertips. Science, 333(6043), 776–778. https://doi.org/10.1126/science.1207745",
  "Kasneci, E., Sessler, K., & Küchemann, S. (2023). ChatGPT for good? On opportunities and challenges of large language models for education. Learning and Individual Differences, 103, 102274. https://doi.org/10.1016/j.lindif.2023.102274",
  "Ji, Z., Lee, N., & Frieske, R. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), 1–38. https://doi.org/10.1145/3571730",
  "Parasuraman, R., & Riley, V. (1997). Humans and automation: Use, misuse, disuse, abuse. Human Factors, 39(2), 230–253. https://doi.org/10.1518/001872097778543886",
];
const references = citationReferences(
  [],
  bibliography.map((original, i) => ({
    id: `work-${i}`,
    original,
    parsed: parseReference(original),
  })),
);

for (const [text, ids, raw, authors] of [
  [
    "Sparrow, Liu, and Wegner (2011) found a result.",
    ["work-0"],
    "Sparrow, Liu, and Wegner (2011)",
    ["Sparrow", "Liu", "Wegner"],
  ],
  [
    "Kasneci et al. (2023) found a result.",
    ["work-1"],
    "Kasneci et al. (2023)",
    ["Kasneci"],
  ],
  [
    "A result (Sparrow et al., 2011).",
    ["work-0"],
    "(Sparrow et al., 2011)",
    ["Sparrow"],
  ],
  [
    "A result (Kasneci et al., 2023; Ji et al., 2023).",
    ["work-1", "work-2"],
    "(Kasneci et al., 2023; Ji et al., 2023)",
    ["Kasneci"],
  ],
  [
    "Parasuraman and Riley (1997) found a result.",
    ["work-3"],
    "Parasuraman and Riley (1997)",
    ["Parasuraman", "Riley"],
  ],
  [
    "According to Sparrow, Liu, and Wegner (2011), memory behavior changes.",
    ["work-0"],
    "Sparrow, Liu, and Wegner (2011)",
    ["Sparrow", "Liu", "Wegner"],
  ],
] as const) {
  test(`citation identity and exact span: ${raw}`, () => {
    const occurrence = parseCitationOccurrences(text, references)[0];
    assert.equal(occurrence.raw, raw);
    assert.equal(text.slice(occurrence.start, occurrence.end), raw);
    assert.deepEqual(
      occurrence.items.flatMap((item) => item.sourceIds),
      ids,
    );
    assert.deepEqual(occurrence.items[0].authors, authors);
    assert.ok(
      claimCitationChecks(text, 0, references).every(
        (check) => !/^\(?\d{4}\)?$/.test(check.text),
      ),
    );
  });
}

test("narrative author lists survive extraction before any bibliography is supplied", () => {
  const text =
    "According to Sparrow, Liu, and Wegner (2011), memory behavior changes.";
  const occurrence = parseCitationOccurrences(text)[0];
  assert.equal(occurrence.raw, "Sparrow, Liu, and Wegner (2011)");
  assert.deepEqual(occurrence.items[0].authors, ["Sparrow", "Liu", "Wegner"]);
  assert.equal(occurrence.items[0].status, "unmatched");
});

test("an unrelated earlier author cannot capture an unknown narrative year", () => {
  const occurrence = parseCitationOccurrences(
    "Sparrow discussed memory, but Unknown (2011) found a result.",
    references,
  )[0];
  assert.equal(occurrence.raw, "Unknown (2011)");
  assert.equal(occurrence.items[0].status, "unmatched");
});

test("APA bibliography enriches the work with article title and journal", () => {
  const parsed = parseReference(bibliography[0]);
  assert.equal(parsed.type, "article-journal");
  assert.equal(parsed.containerTitle, "Science");
  assert.equal(parsed.doi, "10.1126/science.1207745");
});

test("contrast clauses keep narrative and combined citations attached to their own assertions", () => {
  const text =
    "Smith (2020) found improvements, although later studies disagreed (Jones, 2022; Lee, 2023).";
  const checks = claimCitationChecks(text, 100, [
    { id: "smith", metadata: { authors: ["Smith"], year: 2020 } },
    { id: "jones", metadata: { authors: ["Jones"], year: 2022 } },
    { id: "lee", metadata: { authors: ["Lee"], year: 2023 } },
  ]);
  assert.equal(checks.length, 3);
  assert.equal(checks[0].claimText, "Smith (2020) found improvements");
  assert.equal(
    checks[1].claimText,
    "later studies disagreed (Jones, 2022; Lee, 2023).",
  );
  assert.equal(checks[2].claimText, checks[1].claimText);
});

test("bibliography matching prioritizes DOI, then author and year, without selecting a different work", () => {
  assert.equal(
    typeof bibliographyMatching.matchBibliographySources,
    "function",
  );
  const { matchBibliographySources } = bibliographyMatching;
  const works = [
    {
      id: "right",
      metadata: {
        title: "Google effects on memory",
        authors: ["Betsy Sparrow", "Jenny Liu", "Daniel M. Wegner"],
        authorDetails: [
          { family: "Sparrow" },
          { family: "Liu" },
          { family: "Wegner" },
        ],
        year: "2011",
        doi: "10.1126/science.1207745",
      },
    },
    {
      id: "wrong",
      metadata: {
        title: "Google effects on memory",
        authors: ["Someone Else"],
        year: "2020",
        doi: "10.1234/other",
      },
    },
  ];
  assert.deepEqual(
    matchBibliographySources(
      { doi: "https://doi.org/10.1126/science.1207745" },
      works,
    ).map((work) => work.id),
    ["right"],
  );
  assert.deepEqual(
    matchBibliographySources(parseReference(bibliography[0]), works).map(
      (work) => work.id,
    ),
    ["right"],
  );
  assert.deepEqual(
    matchBibliographySources(
      { title: "Google effects on memory", doi: "10.1234/missing" },
      works,
    ),
    [],
  );
  assert.deepEqual(
    matchBibliographySources(
      {
        title: "Unrelated paper about birds",
        authors: ["Sparrow"],
        year: 2011,
      },
      works,
    ),
    [],
  );
  assert.deepEqual(
    matchBibliographySources(
      {
        title: "Google efects on memory",
        authors: ["Sparrow", "Liu", "Wegner"],
        year: 2011,
      },
      works,
    ).map((work) => work.id),
    ["right"],
  );
});
