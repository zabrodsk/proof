import { test } from "node:test";
import assert from "node:assert/strict";
import { citationRequirement, selectClaims } from "../shared/claims.js";

test("common knowledge stays a selected factual claim without requiring a citation", () => {
  const text =
    "Jane Smith.\nParis is the capital of France.\nWorld War II ended in 1945.";
  const selected = selectClaims(text);
  assert.equal(selected.candidates.length, 2);
  assert.ok(
    selected.candidates.every(
      (c) => citationRequirement(c.text) === "common_knowledge",
    ),
  );
  assert.equal(
    citationRequirement('The report states, "Paris is the capital of France."'),
    "required",
  );
  assert.equal(
    citationRequirement(
      "The report states, 'Paris is the capital of France.'",
      "",
      "common_knowledge",
    ),
    "required",
  );
});
test("familiar subjects do not exempt interpretations, disputed specifics or quantities", () => {
  for (const text of [
    "Paris has 68 million residents.",
    "Tutoring improves adult reading scores.",
    "The character represents rebellion.",
    "The survey found that ten percent agreed.",
  ])
    assert.equal(citationRequirement(text, "", "common_knowledge"), "required");
  assert.equal(
    citationRequirement("Paris is the capital of France and the safest city."),
    "required",
  );
});
test("audience-specific common knowledge is an explicit review choice", () => {
  const text = "Democracy allows citizens to vote.";
  assert.equal(citationRequirement(text), "required");
  assert.equal(
    citationRequirement(text, "", "common_knowledge"),
    "common_knowledge",
  );
  assert.equal(
    citationRequirement("Paris is the capital of France.", "", "required"),
    "required",
  );
});
test("single-quoted text keeps its exact claim span and cannot become a common-knowledge exemption", () => {
  const text = "The report states, 'Paris is the capital of France.'";
  const claim = selectClaims(text).candidates[0];
  assert.equal(claim.text, text);
  assert.equal(claim.end, text.length);
  assert.equal(
    citationRequirement(claim.text, "", "common_knowledge"),
    "required",
  );
});
