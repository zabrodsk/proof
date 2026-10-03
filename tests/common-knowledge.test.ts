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

test("stable general facts recognize paraphrases, definitions and familiar quantities", () => {
  for (const text of [
    "The capital of France is Paris.",
    "Paris is France's capital city.",
    "A week consists of seven days.",
    "There are 12 months in a year.",
    "A triangle has three sides.",
    "Humans are mammals.",
    "The Earth revolves around the Sun.",
    "World War II came to an end in 1945.",
  ])
    assert.equal(citationRequirement(text), "common_knowledge", text);
});

test("broad trends, causal promises and vague quantifiers cannot be exempted as general facts", () => {
  for (const text of [
    "Artificial intelligence is becoming increasingly common in education.",
    "Unrestricted AI use directly improves academic performance.",
    "Students who use ChatGPT regularly will inevitably lose critical-thinking ability.",
    "Most students learn better with AI.",
    "Exercise prevents depression.",
    "Social media leads to anxiety.",
    "The study found that people can become overly trusting of automated recommendations.",
    "Studies of automation have found that people can become overly trusting of automated recommendations.",
    "The report on Paris says that it is the capital of France.",
    "According to the report, Paris is the capital of France.",
  ])
    assert.equal(
      citationRequirement(text, "", "common_knowledge"),
      "required",
      text,
    );
});

test("a reference to earlier research inherits its evidence requirement", () => {
  const text = "This benefit applies across subjects.";
  const context =
    "The study compared grades across schools. This benefit applies across subjects.";
  assert.equal(
    citationRequirement(text, context, "common_knowledge"),
    "required",
  );
  assert.equal(
    citationRequirement("The Earth is a planet.", context),
    "common_knowledge",
  );
});

test("extra assertions and near matches never inherit a general-fact exemption", () => {
  for (const text of [
    "The capital of France is Paris, which is the safest city in Europe.",
    "A triangle has three sides and always improves spatial reasoning.",
    "A week consists of eight days.",
    "Humans are mammals because a survey found this in 2024.",
  ])
    assert.equal(citationRequirement(text), "required", text);
});
