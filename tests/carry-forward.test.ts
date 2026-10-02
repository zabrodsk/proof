import test from "node:test";
import assert from "node:assert/strict";
import type { BackendFinding } from "../shared/backend.js";
import {
  carriedFindings,
  editRegion,
} from "../server/backend/carry-forward.js";

const before =
  "Teams completed work twice as fast. The study had six teams. Results varied.";

function finding(id: string, text: string, fix?: string): BackendFinding {
  const start = before.indexOf(text);
  const fixStart = fix ? before.indexOf(fix) : 0;
  return {
    id,
    claim: { text, start, end: start + text.length, kind: "", context: text },
    support: "overstated",
    citation: "correct",
    eligibility: "eligible",
    processing: "complete",
    evidence: [],
    explanation: [],
    checkedPassageIds: [],
    ...(fix
      ? {
          fix: {
            original: fix,
            replacement: "18% faster",
            start: fixStart,
            end: fixStart + fix.length,
            documentVersionId: "old",
            kind: "number" as const,
          },
        }
      : {}),
  };
}

const findings = [
  finding("a", "Teams completed work twice as fast.", "twice as fast"),
  finding("b", "The study had six teams."),
  finding("c", "Results varied."),
];

test("edit regions cover only the changed characters", () => {
  assert.deepEqual(editRegion("abcdef", "abXYef"), {
    start: 2,
    end: 4,
    delta: 0,
  });
  assert.deepEqual(editRegion("abc", "abc"), { start: 3, end: 3, delta: 0 });
  assert.deepEqual(editRegion("aaa", "aaaa"), { start: 3, end: 3, delta: 1 });
});

test("an edit retires findings in its sentence and shifts later findings", () => {
  const after = before.replace("six teams", "six small teams");
  const carried = carriedFindings(
    findings,
    before,
    after,
    editRegion(before, after),
    "new",
  );
  assert.deepEqual(
    carried.map(({ to }) => to.id),
    ["a", "c"],
  );
  for (const { to } of carried)
    assert.equal(after.slice(to.claim.start, to.claim.end), to.claim.text);
  assert.equal(carried[0].to.fix?.documentVersionId, "new");
  assert.equal(
    after.slice(carried[0].to.fix!.start, carried[0].to.fix!.end),
    "twice as fast",
  );
});

test("a claim whose text no longer matches its new span is not carried", () => {
  const after = "Intro. " + before;
  const region = editRegion(before, after);
  const carried = carriedFindings(
    findings,
    before,
    after,
    { ...region, delta: region.delta + 1 },
    "new",
  );
  assert.deepEqual(carried, []);
});
