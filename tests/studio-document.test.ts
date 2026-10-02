import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendFinding } from "../shared/backend";
import {
  documentHighlights,
  findingTone,
  findingLabel,
  findingAssessment,
  findingDetail,
  sourceCheckScope,
} from "../src/studio-document";

function finding(text: string, start = 0): BackendFinding {
  return {
    id: "finding",
    claim: { text, start, end: start + text.length, kind: "fact", context: "" },
    support: "supported",
    citation: "correct",
    eligibility: "eligible",
    processing: "complete",
    evidence: [],
    explanation: [],
    checkedPassageIds: [],
  };
}
test("only exact current-draft offsets receive highlights, including repeated sentences", () => {
  const text = "Claim.\n\nClaim.";
  const first = finding("Claim.");
  const second = { ...finding("Claim.", 8), id: "second" };
  const wrong = { ...finding("Different."), id: "wrong" };
  assert.deepEqual(documentHighlights(text, [second, wrong, first], false), [
    first,
    second,
  ]);
  assert.deepEqual(documentHighlights(text, [first, second], true), []);
  assert.deepEqual(
    documentHighlights(
      text,
      [{ ...first, claim: { ...first.claim, end: 999 } }],
      false,
    ),
    [],
  );
  assert.deepEqual(
    documentHighlights(text, [first, { ...first, id: "overlapping" }], false),
    [first],
  );
});
test("incomplete or unverified evidence cannot look supported", () => {
  const f = finding("Claim.");
  assert.equal(findingTone(f), "supported");
  assert.equal(findingTone({ ...f, processing: "partial" }), "unverified");
  assert.equal(findingTone({ ...f, support: "not_verified" }), "unverified");
  assert.equal(findingTone({ ...f, eligibility: "unknown" }), "review");
  assert.equal(findingTone({ ...f, citation: "wrong_source" }), "review");
});

test("supplied material support does not require certified scholarly provenance", () => {
  const f = {
    ...finding("Claim."),
    basis: "supplied_text" as const,
    eligibility: "unknown" as const,
    citation: "not_checked" as const,
  };
  assert.equal(findingLabel(f), "Supported");
  assert.match(findingAssessment(f).meaning, /not whether the material itself/);
  assert.equal(findingLabel({ ...f, support: "contradicted" }), "Unsupported");
  assert.equal(findingLabel({ ...f, processing: "partial" }), "Unsupported");
  assert.equal(sourceCheckScope(1, true), "selected_library");
  assert.equal(sourceCheckScope(0, true), "cited_first_then_selected_library");
});

test("unsupported claims explain a missing source and a contradiction differently", () => {
  const f = finding("Claim.");
  assert.match(
    findingAssessment({
      ...f,
      support: "not_verified",
      evidenceGap: "source_unavailable",
    }).meaning,
    /could not read/,
  );
  assert.match(
    findingAssessment({ ...f, support: "contradicted" }).meaning,
    /disagrees/,
  );
});

test("review labels name the specific problem without overstating support", () => {
  const f = finding("Claim.");
  assert.equal(findingDetail(f), "Supported");
  assert.equal(findingDetail({ ...f, support: "overstated" }), "Overstated");
  assert.equal(
    findingDetail({ ...f, citation: "wrong_source" }),
    "Citation issue",
  );
  assert.equal(
    findingDetail({ ...f, processing: "partial" }),
    "Check incomplete",
  );
  assert.equal(
    findingDetail({
      ...f,
      support: "not_verified",
      evidenceGap: "not_addressed",
    }),
    "Not in your sources",
  );
  assert.equal(
    findingDetail({
      ...f,
      support: "not_verified",
      evidenceGap: "source_unavailable",
    }),
    "No readable source",
  );
});
