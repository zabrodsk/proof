import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvedClaimSpans,
  currentCitationOverrides,
  setCitationOverride,
  type CitationOverrides,
  claimReviewRows,
} from "../src/studio-claims";
import { selectClaims } from "../shared/claims";
import type { BackendFinding } from "../shared/backend";

test("claim rows include detected claims and mark skipped segments as unsure", () => {
  const content =
    "Paris is the capital of France.\nParis is the capital of France.\nhello world.";
  const preview = selectClaims(content);
  const second = preview.candidates[1];
  const finding: BackendFinding = {
    id: "second",
    claim: { ...second, kind: "factual", context: "" },
    support: "supported",
    citation: "correct",
    processing: "complete",
    eligibility: "eligible",
    evidence: [],
    explanation: [],
    checkedPassageIds: [],
  };
  const rows = claimReviewRows(content, preview, [finding], false);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].finding, undefined);
  assert.equal(rows[1].finding, finding);
  assert.equal(rows[2].text, "hello world.");
  assert.equal(rows[2].unsure, true);
  assert.equal(rows[2].finding, undefined);
});

test("earlier or mismatched finding offsets cannot supply current claim results", () => {
  const content = "Paris is the capital of France.";
  const preview = selectClaims(content);
  const finding: BackendFinding = {
    id: "old",
    claim: {
      text: "Paris is the capital of Spain.",
      start: 0,
      end: content.length,
      kind: "factual",
      context: "",
    },
    support: "supported",
    citation: "correct",
    processing: "complete",
    eligibility: "eligible",
    evidence: [],
    explanation: [],
    checkedPassageIds: [],
  };
  assert.equal(
    claimReviewRows(content, preview, [finding], false)[0].finding,
    undefined,
  );
  const current = { ...finding, claim: { ...finding.claim, text: content } };
  assert.equal(
    claimReviewRows(content, preview, [current], true)[0].finding,
    undefined,
  );
});

test("automatic citation classification preserves legacy exact claim-span payloads", () => {
  const content = "Paris is the capital of France.";
  const state: CitationOverrides = { content, choices: new Map() };
  assert.deepEqual(
    approvedClaimSpans([{ start: 0, end: content.length }], content, state),
    [{ start: 0, end: content.length }],
  );
});

test("explicit citation requirement override keeps the claim selected", () => {
  const content = "Paris is the capital of France.";
  const state = setCitationOverride(
    { content, choices: new Map() },
    content,
    0,
    "required",
  );
  assert.deepEqual(
    approvedClaimSpans([{ start: 0, end: content.length }], content, state),
    [{ start: 0, end: content.length, citationRequirement: "required" }],
  );
});

test("edited text cannot inherit a citation exemption by character offset", () => {
  const original = "Paris is the capital of France.";
  const changed = "The trial included 218 adults.";
  const state = setCitationOverride(
    { content: original, choices: new Map() },
    original,
    0,
    "common_knowledge",
  );
  assert.equal(currentCitationOverrides(state, changed).size, 0);
  assert.deepEqual(
    approvedClaimSpans([{ start: 0, end: changed.length }], changed, state),
    [{ start: 0, end: changed.length }],
  );
  const next = setCitationOverride(state, changed, 0, "required");
  assert.equal(next.content, changed);
  assert.deepEqual([...next.choices], [[0, "required"]]);
});

test("manual common-knowledge selection cannot exempt source-dependent claims", () => {
  for (const content of [
    'The author wrote "Paris is the capital of France."',
    "The ending symbolizes freedom.",
    "The trial included 218 adults.",
    "Sixty percent of respondents agreed.",
  ]) {
    const state = setCitationOverride(
      { content, choices: new Map() },
      content,
      0,
      "common_knowledge",
    );
    assert.equal(
      approvedClaimSpans([{ start: 0, end: content.length }], content, state)[0]
        .citationRequirement,
      "required",
      content,
    );
  }
});

test("a writer can exempt a general fact explicitly without changing its selected span", () => {
  const content = "The village lies beside the river.";
  const state = setCitationOverride(
    { content, choices: new Map() },
    content,
    0,
    "common_knowledge",
  );
  assert.deepEqual(
    approvedClaimSpans([{ start: 0, end: content.length }], content, state),
    [
      {
        start: 0,
        end: content.length,
        citationRequirement: "common_knowledge",
      },
    ],
  );
});

test("skipped claims stay in the unsure filter regardless of selection", () => {
  const content = "The company employs 300 people.";
  const preview = selectClaims(content);
  const finding = {
    claim: { start: 0, end: content.length, text: content },
  } as BackendFinding;
  const rows = claimReviewRows(content, preview, [finding], false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unsure, true);
  assert.equal(rows[0].finding, finding);
});
