import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractScholarlyXml,
  entirePassages,
  judgeScholarlyClaim,
  matchJournalRecord,
} from "../server/scholarly.js";
import type { Source, Claim, Finding } from "../shared/types.js";
const claim: Claim = {
  id: "claim",
  text: "The study found an improvement.",
  start: 0,
  end: 31,
  citations: [],
};
const source: Source = {
  id: "source",
  title: "A research paper",
  authors: [],
  year: "2024",
  doi: "10.1234/paper",
  provider: "fixture",
  retrievedAt: "",
  access: "full_text",
  passages: entirePassages(
    "Study text with measured outcomes and limitations. ".repeat(800),
  ),
  scholarly: {
    eligible: true,
    reason: "Fixture verified journal and full text",
    checkedAt: "",
  },
};
const journal = (method: string) => ({
  id: "journal-record",
  bibjson: {
    eissn: "1932-6203",
    editorial: {
      review_process: [method],
      review_url: "https://example.com/review-policy",
    },
  },
});
const xml = (type = "research-article", doi = "10.1234/paper") =>
  `<article article-type="${type}"><front><article-meta><article-id pub-id-type="doi">${doi}</article-id><title-group><article-title>A research paper</article-title></title-group></article-meta></front><body><sec><title>Results</title><p>${"Actual study text and reported results. ".repeat(80)}</p></sec></body><back><ref-list><ref>10.1234/paper</ref></ref-list></back></article>`;
test("journal gate matches ISSN and explicit peer review, rejecting editorial-only review", () => {
  assert.ok(
    matchJournalRecord(journal("Single anonymous peer review"), ["1932-6203"]),
  );
  assert.equal(
    matchJournalRecord(journal("Editorial review"), ["1932-6203"]),
    undefined,
  );
  assert.equal(
    matchJournalRecord(journal("No peer review"), ["1932-6203"]),
    undefined,
  );
  assert.equal(
    matchJournalRecord(journal("Peer review"), ["1111-1111"]),
    undefined,
  );
});
test("full-text XML requires matching article DOI and title, supported article type, and complete body", () => {
  assert.ok(
    extractScholarlyXml(xml(), "10.1234/paper", "A research paper").length >
      2000,
  );
  assert.throws(
    () =>
      extractScholarlyXml(
        xml("editorial"),
        "10.1234/paper",
        "A research paper",
      ),
    /not identified/,
  );
  assert.throws(
    () =>
      extractScholarlyXml(
        xml("research-article", "10.1234/wrong"),
        "10.1234/paper",
        "A research paper",
      ),
    /identity/,
  );
  assert.throws(
    () => extractScholarlyXml(xml(), "10.1234/paper", "Wrong title"),
    /identity/,
  );
  assert.throws(
    () =>
      extractScholarlyXml(
        xml().replace("</article>", ""),
        "10.1234/paper",
        "A research paper",
      ),
    /incomplete/,
  );
  assert.throws(
    () =>
      extractScholarlyXml(
        xml().replace(/<body>[\s\S]*<\/body>/, ""),
        "10.1234/paper",
        "A research paper",
      ),
    /missing/,
  );
});
test("whole-text splitting preserves every character, including the final paragraph", () => {
  const text =
    "A short heading\n\nA table cell: 42\n".repeat(1000) + "FINAL LIMITATION";
  assert.equal(entirePassages(text).join(""), text);
});
test("abstracts and unverified uploads never reach the model", async () => {
  let calls = 0;
  const judge = async (): Promise<Finding> => {
    calls++;
    throw Error("must not be called");
  };
  for (const s of [
    { ...source, access: "abstract" as const },
    { ...source, scholarly: undefined },
    { ...source, publicationWarning: true },
  ]) {
    const result = await judgeScholarlyClaim(claim, s, undefined, judge);
    assert.equal(result.status, "source_unavailable");
  }
  assert.equal(calls, 0);
});
test("every full-text section is checked and a later contradiction blocks a positive result", async () => {
  let calls = 0;
  const seen: string[] = [];
  const result = await judgeScholarlyClaim(
    claim,
    source,
    undefined,
    async (c, s, passages) => {
      seen.push(...passages!);
      calls++;
      return {
        ...c,
        sourceId: s.id,
        status: calls === 1 ? "supported" : "contradicted",
        method: "Jev",
        explanation: "fixture",
        evidence: passages![0],
      };
    },
  );
  assert.ok(calls > 1);
  assert.equal(seen.join(""), source.passages.join(""));
  assert.equal(result.status, "uncertain");
  assert.equal(result.fix, undefined);
  assert.equal(result.fullTextCheck?.completed, calls);
});
test("one failed section leaves the complete claim unverified", async () => {
  let calls = 0;
  const result = await judgeScholarlyClaim(
    claim,
    source,
    undefined,
    async (c) => ({
      ...c,
      status: "supported",
      method: ++calls === 2 ? "unverified" : "Jev",
      explanation: "fixture",
    }),
  );
  assert.equal(result.status, "uncertain");
  assert.equal(result.method, "unverified");
});
test("agreement across the entire article retains verbatim evidence but never an automatic rewrite", async () => {
  const result = await judgeScholarlyClaim(
    claim,
    source,
    undefined,
    async (c, s, p) => ({
      ...c,
      status: "supported",
      method: "Jev",
      sourceId: s.id,
      explanation: "fixture",
      evidence: p![0],
      fix: "invented rewrite",
    }),
  );
  assert.equal(result.status, "supported");
  assert.equal(result.fullTextCheck?.chunks, result.fullTextCheck?.completed);
  assert.equal(result.fix, undefined);
  assert.ok(result.checkedPassages?.every((p) => source.passages.includes(p)));
});
