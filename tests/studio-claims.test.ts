import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvedClaimSpans,
  currentCitationOverrides,
  setCitationOverride,
  type CitationOverrides,
} from "../src/studio-claims";

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
