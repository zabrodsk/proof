import { test } from "node:test";
import assert from "node:assert/strict";
import { quantityMismatches } from "../server/parse.js";
import { numericCorrection, evidenceExcerpt } from "../server/fixes.js";

test("a correction replaces only the confirmed number and preserves the citation and other values", () => {
  const claim =
    "A 2024 review included 300 studies and 14,170 participants (Noetel et al. 2024).";
  const passage =
    "A total of 218 unique studies were included, totalling 14,170 participants.";
  const pair = quantityMismatches(claim, [passage])[0];
  const result = numericCorrection(claim, pair)!;
  assert.equal(
    result.fix,
    "A 2024 review included 218 studies and 14,170 participants (Noetel et al. 2024).",
  );
  assert.equal(
    claim.slice(result.correction.start, result.correction.end),
    "300",
  );
});
test("comma-formatted numbers keep correct replacement offsets", () => {
  const claim =
    "In 2024, 12,300 participants completed 30 trials (Author 2024).";
  const passage = "There were 12,400 participants in the sample.";
  const result = numericCorrection(
    claim,
    quantityMismatches(claim, [passage])[0],
  );
  assert.equal(
    result?.fix,
    "In 2024, 12,400 participants completed 30 trials (Author 2024).",
  );
});
test("percentage corrections preserve percent signs and the surrounding sentence", () => {
  const claim = "The study reported a 30% reduction in symptoms (Smith 2024).";
  const result = numericCorrection(
    claim,
    quantityMismatches(claim, [
      "The study reported a 12.4% reduction in symptoms.",
    ])[0],
  );
  assert.equal(
    result?.fix,
    "The study reported a 12.4% reduction in symptoms (Smith 2024).",
  );
});
test("ambiguous repeated quantities do not receive an automatic correction", () => {
  const claim =
    "The reviews included 300 studies for adults and 300 studies for children.";
  assert.equal(
    numericCorrection(
      claim,
      quantityMismatches(claim, ["The review included 218 studies."])[0],
    ),
    undefined,
  );
});
test("evidence excerpt shows the exact result sentence rather than the paragraph introduction", () => {
  const passage =
    "The reviewers screened all titles independently. They excluded duplicate reports. A total of 218 unique studies were included. A supplementary table lists the authors.";
  const pair = quantityMismatches("The review included 300 studies.", [
    passage,
  ])[0];
  assert.equal(
    evidenceExcerpt(passage, pair.actual.start),
    "A total of 218 unique studies were included.",
  );
});
test("long passages are not reduced to an unverified sentence", () => {
  const passage =
    "Exercise was studied across multiple populations. ".repeat(12) +
    "The authors caution that the evidence remains uncertain.";
  assert.equal(evidenceExcerpt(passage), undefined);
});
test("an earlier matching number with a different unit remains untouched", () => {
  const claim =
    "Across 300 participants, the review included 300 studies (Smith 2024).";
  const pair = quantityMismatches(claim, [
    "The review included 218 studies.",
  ])[0];
  assert.equal(
    numericCorrection(claim, pair)?.fix,
    "Across 300 participants, the review included 218 studies (Smith 2024).",
  );
});
