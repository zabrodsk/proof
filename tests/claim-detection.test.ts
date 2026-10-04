import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selectClaims } from "../shared/claims.js";
import { claimCandidates } from "../server/backend/engine.js";
import { extractClaims } from "../server/parse.js";
import { parseDocument } from "../server/documents.js";
import { documentCorpus } from "./fixtures/document-corpus.js";

const nonClaims = [
  "asdf qwer zxcv",
  "asdf qwer zxcv.",
  "lorem ipsum dolor sit amet.",
  "banana purple keyboard sandwich.",
  "hello world",
  "hello world.",
  "Thank you for reading.",
  "Good morning everyone.",
  "To be continued.",
  "In conclusion,",
  "background information",
  "research methods",
  "Email: jane@example.com",
  "Phone: +420 123 456 789",
  "Name: Dr. Jane Smith",
  "I think this ending is beautiful.",
  "Please read the following passage.",
  "Choose one of the options below.",
  "Click here to continue.",
  "Remember to save your work.",
  "---",
  "| Name | Date |",
  "| --- | --- |",
  "```javascript",
  "const result = 42;",
  "```",
  "- [ ] add sources",
  "www.example.com",
  "https://example.com/about",
  "J. R. R. Tolkien",
  "I prefer the blue cover because it looks nicer.",
  "I prefer the blue cover because it is beautiful.",
  "is are was were",
  '"asdf qwer zxcv."',
  "218 adults.",
];
for (const text of nonClaims)
  test(`does not automatically research non-assertion: ${text}`, () => {
    const selection = selectClaims(text);
    assert.deepEqual(selection.candidates, []);
    assert.ok(selection.skipped.length > 0);
    assert.deepEqual(claimCandidates(text, undefined), []);
    assert.deepEqual(extractClaims(text, true), []);
  });

for (const text of [
  "The trial included 218 adults.",
  "Reading scores improved.",
  "John died.",
  "Paris is the capital of France.",
  "The moon symbolizes isolation in this poem.",
  "The treatment reduced symptoms by 3.5%.",
  "Vaccines do not contain tracking chips.",
  "I believe the study included 218 participants.",
  "I prefer this treatment because the study found fewer symptoms.",
  "La France est un pays européen.",
  "Praha je hlavním městem České republiky.",
  "Terapie snížila příznaky o 20 procent.",
  "L’étude a recruté 218 adultes.",
  "睡眠不足は集中力を低下させる。",
  "Mitochondria generate ATP.",
  "Rain falls.",
  "Plants absorb carbon dioxide.",
  "Water freezes at zero degrees Celsius.",
  "Dr. A. Smith et al. reported a 3.5% change (Smith et al. 2024).",
  "A second space race involves private firms (Smith 15).",
  "It also adjusts regulation (Brown and Green 8).",
  "The U.S. therefore funds research (Brown 15).",
  "The patent framework changes (Lee 8).",
  "The Act permits private operations (Hao and Tronchetti 8).",
])
  test(`keeps an identifiable assertion: ${text}`, () => {
    const claims = selectClaims(text).candidates;
    assert.equal(claims.length, 1);
    assert.equal(claims[0].text, text);
  });

test("wraps continue a sentence while preserving the original newline and offsets", () => {
  for (const newline of ["\n", "\r\n"]) {
    const text = `Jane Smith.${newline}The trial included${newline}218 adults.${newline}Reading scores improved.`;
    const expected = [
      `The trial included${newline}218 adults.`,
      "Reading scores improved.",
    ];
    const claims = selectClaims(text).candidates;
    assert.deepEqual(
      claims.map((c) => c.text),
      expected,
    );
    for (const claim of claims)
      assert.equal(text.slice(claim.start, claim.end), claim.text);
  }
});

test("Markdown code blocks cannot supply claims even when the code contains assertion words", () => {
  const text =
    "~~~js\nconst explanation = 'The trial included 218 adults.';\n~~~\nParis is the capital of France.\n```text\nThe moon is made of cheese.\n```";
  const selection = selectClaims(text);
  assert.deepEqual(
    selection.candidates.map((c) => c.text),
    ["Paris is the capital of France."],
  );
  for (const span of selection.skipped)
    assert.ok(text.slice(span.start, span.end));
});

test("Markdown metadata tables are skipped without losing the factual body", () => {
  const text =
    "| Name | Date |\n| --- | --- |\n| Jane Smith | 2026-10-02 |\n\nThe trial included 218 adults.";
  assert.deepEqual(
    selectClaims(text).candidates.map((c) => c.text),
    ["The trial included 218 adults."],
  );
});

test("Markdown bibliography headings end automatic body selection", () => {
  for (const heading of [
    "## Works Cited",
    "**References**",
    "Bibliography\n------------",
  ]) {
    const text = `The trial included 218 adults.\n\n${heading}\nBrown, Maria. The study included 300 adults. 2024.`;
    assert.deepEqual(
      selectClaims(text).candidates.map((c) => c.text),
      ["The trial included 218 adults."],
    );
  }
});

test("manual selection can include unrecognized prose without enabling it automatically", () => {
  const text = "An unfamiliar expression without a recognized predicate.";
  assert.deepEqual(claimCandidates(text, undefined), []);
  assert.equal(
    claimCandidates(text, [{ start: 0, end: text.length }])[0].text,
    text,
  );
});

const expectedImported = [
  "The trial included 218 adults.",
  "Reading scores improved.",
  "The moon symbolizes isolation in this poem.",
];
for (const filename of [
  "claim-selection.docx",
  "claim-selection-spaced.pdf",
  "claim-selection-tight.pdf",
])
  test(`${filename}: imports three claims without headings, random text or instructions`, async () => {
    const text = await parseDocument(
      await readFile(new URL(`fixtures/${filename}`, import.meta.url)),
      filename,
    );
    const claims = selectClaims(text).candidates;
    assert.deepEqual(
      claims.map((c) => c.text),
      expectedImported,
    );
    for (const claim of claims)
      assert.equal(text.slice(claim.start, claim.end), claim.text);
    assert.deepEqual(
      claimCandidates(text, undefined).map((c) => c.text),
      expectedImported,
    );
  });

for (const extension of ["txt", "md"])
  test(`${extension}: import excludes random text and retains the factual body`, async () => {
    const text = await parseDocument(
      Buffer.from(
        "## Notes\nhello world.\nThank you for reading.\nThe trial included 218 adults.",
      ),
      `notes.${extension}`,
    );
    assert.deepEqual(
      selectClaims(text).candidates.map((c) => c.text),
      ["The trial included 218 adults."],
    );
  });

for (const sample of documentCorpus)
  test(`${sample.id}: stricter selection retains the existing essay's assertions`, () => {
    assert.equal(
      selectClaims(sample.text).candidates.length,
      sample.claimCount,
    );
  });
