import { test } from "node:test";
import assert from "node:assert/strict";
import type { CitationPlan } from "../shared/citation-plan";
import type { BackendFinding } from "../shared/backend";
import * as review from "../src/studio-citation-review";
import {
  citationIssues,
  occurrenceNeedsReview,
  occurrenceEvidenceUnchecked,
} from "../src/studio-citation-review";

function plan(): CitationPlan {
  return {
    id: "plan",
    runId: "run",
    documentId: "document",
    documentVersionId: "version",
    profile: "mla9",
    profileVersion: "1",
    status: "ready",
    operations: [],
    references: [],
    bibliography: { start: 100, end: 100, heading: "Works Cited", entries: [] },
    gaps: [],
    exemptions: [],
    warnings: [],
    coverage: { totalClaims: 1, citableClaims: 0 },
    previewText: "",
    audit: {
      occurrences: [],
      bibliographyIssues: [],
      counts: { occurrences: 0, distinctCitedWorks: 0, bibliographyEntries: 0 },
    },
  };
}
function finding(): BackendFinding {
  return {
    id: "finding",
    claim: {
      text: "The trial included 218 adults (Brown 22).",
      start: 0,
      end: 40,
      kind: "fact",
      context: "",
    },
    support: "supported",
    citation: "wrong_locator",
    basis: "supplied_text",
    eligibility: "unknown",
    processing: "complete",
    evidence: [],
    explanation: [],
    checkedPassageIds: [],
  };
}

test("citation review labels distinguish checked abstract evidence from retrieved text and metadata", () => {
  assert.equal(typeof review.citationProvenance, "function");
  assert.equal(
    review.citationProvenance({
      sourceAccess: "abstract",
      support: "supported",
      checkedPassageIds: ["passage"],
    }),
    "Verified from abstract",
  );
  assert.equal(
    review.citationProvenance({
      sourceAccess: "full_text",
      support: "supported",
      checkedPassageIds: ["passage"],
    }),
    "Verified from full text",
  );
  assert.equal(
    review.citationProvenance({
      sourceAccess: "abstract",
      support: "not_verified",
      checkedPassageIds: [],
    }),
    "Abstract available",
  );
  assert.equal(
    review.citationProvenance({
      sourceAccess: "partial_text",
      support: "partial",
      checkedPassageIds: ["passage"],
    }),
    "Partial source text available",
  );
  assert.equal(
    review.citationProvenance({
      sourceAccess: "metadata",
      support: "not_verified",
      checkedPassageIds: [],
    }),
    "Metadata only",
  );
  assert.equal(
    review.citationProvenance({
      sourceAccess: "unavailable",
      support: "not_verified",
      checkedPassageIds: [],
    }),
    "Source unavailable",
  );
});
test("a finding, its occurrence, and its citation gap create one review issue", () => {
  const value = plan();
  value.audit!.occurrences = [
    {
      id: "occurrence",
      text: "(Brown 22)",
      start: 29,
      end: 39,
      form: "parenthetical",
      status: "matched",
      sourceIds: ["source"],
      citation: "wrong_locator",
      locator: "22",
    },
  ];
  value.gaps = [
    {
      findingId: "finding",
      claim: finding().claim.text,
      reason: "Locator needs review",
    },
  ];
  const rows = citationIssues(value, [finding()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Wrong citation page");
  assert.equal(rows[0].occurrenceId, "occurrence");
});
test("source identification without an evidence check remains a review issue", () => {
  const value = plan();
  value.audit!.occurrences = [
    {
      id: "occurrence",
      text: "(Brown 22)",
      start: 29,
      end: 39,
      form: "parenthetical",
      status: "matched",
      sourceIds: ["source"],
      citation: "not_checked",
      locator: "22",
    },
  ];
  assert.equal(citationIssues(value, [])[0].title, "Evidence not checked");
});
test("citation-exempt occurrences are not turned into source-matching failures", () => {
  const value = plan();
  value.audit!.occurrences = [
    {
      id: "occurrence",
      text: "(Unknown 4)",
      start: 29,
      end: 40,
      form: "parenthetical",
      status: "unmatched",
      sourceIds: [],
      citation: "not_required",
    },
  ];
  const exempt = {
    ...finding(),
    support: "not_verified" as const,
    citation: "not_required" as const,
  };
  assert.deepEqual(citationIssues(value, [exempt]), []);
});
test("uncited bibliography entries remain advisory and link to the exact draft entry", () => {
  const value = plan();
  value.bibliography.entries = [
    { original: "Brown. A Book.", start: 100, end: 114, referenceId: "ref" },
  ];
  value.audit!.bibliographyIssues = [
    {
      kind: "unused",
      text: "Brown. A Book.",
      detail: "Preserved for review",
      referenceIds: ["ref"],
    },
  ];
  const [row] = citationIssues(value, []);
  assert.equal(row.advisory, true);
  assert.equal(row.entryIndex, 0);
  assert.equal(row.start, 100);
});
test("a duplicate-entry issue opens the duplicate rather than the earlier entry for the same work", () => {
  const value = plan();
  value.bibliography.entries = [
    { original: "Brown. A Book.", referenceId: "ref" },
    { original: "Brown. A Book. 2024.", referenceId: "ref" },
  ];
  value.audit!.bibliographyIssues = [
    {
      kind: "duplicate",
      text: "Brown. A Book. 2024.",
      detail: "Repeated work",
      referenceIds: ["ref"],
    },
  ];
  assert.equal(citationIssues(value, [])[0].entryIndex, 1);
});
test("identical duplicate-entry issues each select a later duplicate", () => {
  const value = plan();
  value.bibliography.entries = [0, 1, 2].map(() => ({
    original: "Brown. A Book.",
    referenceId: "ref",
  }));
  value.audit!.bibliographyIssues = [0, 1].map(() => ({
    kind: "duplicate",
    text: "Brown. A Book.",
    detail: "Repeated work",
    referenceIds: ["ref"],
  }));
  assert.deepEqual(
    citationIssues(value, []).map((row) => row.entryIndex),
    [1, 2],
  );
});

test("matched but unchecked citations remain in both review and unchecked-evidence filters", () => {
  const occurrence = {
    id: "occurrence",
    text: "(Brown 22)",
    start: 29,
    end: 39,
    form: "parenthetical" as const,
    status: "matched" as const,
    sourceIds: ["source"],
    citation: "not_checked" as const,
    items: [
      {
        text: "Brown 22",
        start: 30,
        end: 38,
        itemIndex: 0,
        checkedPassageIds: [],
        status: "matched" as const,
        sourceIds: ["source"],
        support: "not_verified" as const,
        citation: "not_checked" as const,
      },
    ],
  };
  assert.equal(occurrenceNeedsReview(occurrence), true);
  assert.equal(occurrenceEvidenceUnchecked(occurrence), true);
  const exempt = { ...occurrence, citation: "not_required" as const };
  assert.equal(occurrenceNeedsReview(exempt), false);
  assert.equal(occurrenceEvidenceUnchecked(exempt), false);
});

test("cited-only review hides legacy uncited findings and citation gaps", () => {
  const value = plan();
  const uncited = {
    ...finding(),
    claim: { ...finding().claim, text: "The trial included 218 adults." },
    citation: "missing" as const,
  };
  value.gaps = [
    { findingId: uncited.id, claim: uncited.claim.text, reason: "No source" },
  ];
  assert.equal(citationIssues(value, [uncited], true).length, 0);
  assert.equal(citationIssues(value, [uncited], false).length, 1);
});
