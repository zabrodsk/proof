import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendFinding } from "../shared/backend";
import { documentHighlights, findingTone } from "../src/studio-document";

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
