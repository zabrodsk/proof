import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentSentences,
  selectClaims,
  skipReason,
} from "../server/claims.js";
import { claimCandidates } from "../server/backend/engine.js";
import { extractClaims } from "../server/parse.js";
import { evidenceSentences } from "../server/evidence.js";

const essay = `Dušan Zábrodský
Ioanna Mavridou
4G2 English
14 January 2026

Safety is almost always perceived as good, but is it worth it when you are giving up your individuality and happiness.
In Brave New World the city is where all of the people are pre-programmed before birth so each caste or group is specifically specialized.
Even though John was not pre-programmed like all of the other people because he was born and raised in the savage reservation.
We can only assume he was an alfa because his father was an alfa plus and his mother Linda was a beta.
John's actions could be described as rebellious.

Works Cited
Huxley, Aldous. Brave New World.`;

for (const metadata of [
  "Dušan Zábrodský",
  "Ioanna Mavridou",
  "4G2 English",
  "14 January 2026",
  "January 14, 2026",
  "2026-01-14",
  "14/01/2026",
  "Name: Jane Smith",
  "Teacher: Ioanna Mavridou",
  "Class: 4G2",
  "Date: 14 January 2026",
  "Page 2 of 8",
  "42",
  "# A heading with dates 2026",
  "Literary analysis",
  "<u>Dušan Zábrodský</u>",
  "Why does John reject the World State?",
  "Submit your essay before Friday.",
])
  test(`automatic selection skips ${metadata}`, () => {
    assert.ok(skipReason(metadata));
    assert.equal(selectClaims(metadata).candidates.length, 0);
  });

for (const claim of [
  "John died.",
  "Ioanna Mavridou teaches English at the school",
  "La France est un pays européen",
  "Praha je hlavním městem České republiky",
  "The article asks whether safety is worth the loss of individuality.",
  "John was born on the Reservation",
  "The trial included 218 adults.",
  "Reading scores improved.",
  "Paris is the capital of France.",
  "On 14 January 2026, the trial included 218 adults.",
  "Dušan Zábrodský published the study in 2026.",
  "Ioanna Mavridou teaches English at the school.",
  "I believe the study included 218 participants.",
  "John's struggle suggests that conformity cannot satisfy everyone.",
  "This source does not establish the author's conclusion.",
  "La France est un pays européen.",
  "Praha je hlavním městem České republiky.",
  "Vaccines don't contain tracking chips.",
])
  test(`automatic selection retains ${claim}`, () => {
    assert.equal(selectClaims(claim).candidates.length, 1);
  });

test("the supplied essay yields claims, never its personal header or rhetorical opening", () => {
  const { candidates, skipped } = selectClaims(essay);
  assert.equal(candidates.length, 4);
  assert.equal(skipped.length, 5);
  for (const claim of candidates)
    assert.equal(essay.slice(claim.start, claim.end), claim.text);
  for (const span of skipped) assert.ok(essay.slice(span.start, span.end));
  assert.ok(!candidates.some((c) => c.text.includes("Huxley, Aldous")));
  assert.deepEqual(
    claimCandidates(essay, undefined).map((c) => c.text),
    candidates.map((c) => c.text),
  );
  assert.deepEqual(
    evidenceSentences(essay).map((c) => c.text),
    candidates.map((c) => c.text),
  );
  assert.deepEqual(
    extractClaims(essay, true).map((c) => c.text),
    candidates.map((c) => c.text),
  );
});

test("explicitly selected text remains checkable even if automatic selection would skip it", () => {
  const text = "Teacher: Jane Smith\nJohn died.";
  assert.equal(
    claimCandidates(text, [{ start: 0, end: 19 }])[0].text,
    "Teacher: Jane Smith",
  );
  assert.equal(claimCandidates(text, undefined)[0].text, "John died.");
});

test("segmentation preserves URLs, decimal numbers, initials, abbreviations, and citations", () => {
  const text =
    "Dr. A. Smith et al. reported a 3.5% change (Smith et al. 2024). Evidence is at https://example.org/study. Results were mixed.";
  const sentences = documentSentences(text);
  assert.equal(sentences.length, 3);
  for (const s of sentences) assert.equal(text.slice(s.start, s.end), s.text);
  assert.match(sentences[0].text, /3\.5%/);
  assert.match(sentences[1].text, /https:\/\/example\.org\/study\.$/);
});

test("repeated claims and CRLF preserve exact independent offsets", () => {
  const text =
    "Jane Smith\r\n\r\nThe study included 218 adults.\r\nThe study included 218 adults.";
  const claims = selectClaims(text).candidates;
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].start, claims[1].start);
  for (const c of claims) assert.equal(text.slice(c.start, c.end), c.text);
});

test("all metadata does not become a positive evidence report", () => {
  const text = "Jane Smith\nHistory\n2026-01-14\n# Essay";
  assert.equal(selectClaims(text).candidates.length, 0);
  assert.throws(() => evidenceSentences(text), /No candidate claims/);
});

test("long documents keep the final claim after skipping header and bibliography", () => {
  const text =
    "Jane Smith\nHistory\n2026-01-14\n" +
    Array.from({ length: 1000 }, () => "The study included 218 adults.").join(
      "\n",
    ) +
    "\nReferences\nSmith. Study.";
  const { candidates, skipped } = selectClaims(text);
  assert.equal(candidates.length, 1000);
  assert.equal(skipped.length, 3);
  assert.equal(
    text.slice(candidates.at(-1)!.start, candidates.at(-1)!.end),
    candidates.at(-1)!.text,
  );
});

test("uploaded titles recover UTF-8 and preserve already decoded filenames", async () => {
  const { uploadFilename } = await import("../server/documents.js");
  for (const filename of [
    "Essay_Dušan Zábrodský.docx",
    "Résumé.pdf",
    "研究.txt",
    "plain.md",
  ]) {
    assert.equal(uploadFilename(filename), filename);
    if (!filename.includes("研究"))
      assert.equal(
        uploadFilename(Buffer.from(filename, "utf8").toString("latin1")),
        filename,
      );
  }
});

test("punctuation on a bare name and pure preferences do not trigger automatic research", () => {
  for (const text of [
    "Jane Smith.",
    "Dušan Zábrodský.",
    "I prefer this ending.",
    "I recommend reading daily.",
  ])
    assert.equal(selectClaims(text).candidates.length, 0, text);
  assert.equal(
    selectClaims("I believe the trial included 218 adults.").candidates.length,
    1,
  );
  assert.equal(
    selectClaims(
      "I prefer this treatment because the study found fewer symptoms.",
    ).candidates.length,
    1,
  );
});

test("preview and engine share paragraph routing while retaining factual past-tense assertions", async () => {
  const { claimContext, evidenceRoute, claimKind } =
    await import("../shared/claims.js");
  const text =
    "The moon symbolizes isolation in this poem.\n\nThe trial included 218 adults.";
  const claims = claimCandidates(text, undefined);
  for (const claim of claims)
    assert.equal(claim.context, claimContext(text, claim.start, claim.end));
  assert.equal(
    evidenceRoute(claims[0].text, claims[0].context),
    "primary_text",
  );
  assert.equal(evidenceRoute(claims[1].text, claims[1].context), "academic");
  assert.equal(claimKind(claims[1].text), "factual");
});
