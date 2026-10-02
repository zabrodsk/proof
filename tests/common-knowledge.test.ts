import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citationRequirement,
  citationRequirementForSpan,
  selectClaims,
} from "../shared/claims.js";

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

test("factual parentheticals cannot inherit a common-knowledge exemption", () => {
  assert.equal(
    citationRequirement(
      "Paris is the capital of France (its population doubled in 2024).",
    ),
    "required",
  );
  assert.equal(
    citationRequirement("Paris is the capital of France (Brown 21)."),
    "common_knowledge",
  );
});
test("quoted span membership survives sentence and paragraph splits", () => {
  for (const text of [
    "The textbook states, “The Sun is a star. The Earth is a planet. A week has seven days.”",
    'The textbook states, "The Sun is a star.\n\nThe Earth is a planet. A week has seven days."',
  ]) {
    const middle = selectClaims(text).candidates.find(
      (c) => c.text === "The Earth is a planet.",
    )!;
    assert.ok(middle);
    assert.equal(
      citationRequirementForSpan(
        text,
        middle.start,
        middle.end,
        "common_knowledge",
      ),
      "required",
    );
  }
  const text =
    "“The Earth is a planet.” Then we stopped. The Earth is a planet.";
  const start = text.lastIndexOf("The Earth");
  assert.equal(
    citationRequirementForSpan(text, start, text.length),
    "common_knowledge",
  );
});

test("apostrophes inside quotations preserve later sentence attribution", () => {
  for (const text of [
    "The textbook states, 'The Sun isn't a planet. The Earth is a planet. A week has seven days.'",
    "The textbook states, ‘The Sun isn’t a planet. The Earth is a planet. A week has seven days.’",
  ]) {
    const start = text.indexOf("The Earth");
    assert.equal(
      citationRequirementForSpan(
        text,
        start,
        start + "The Earth is a planet.".length,
        "common_knowledge",
      ),
      "required",
    );
  }
});
