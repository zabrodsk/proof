import type { BackendFinding } from "../shared/backend";

// Never attach evidence to a different sentence, including after a draft edit.
export function documentHighlights(
  text: string,
  findings: BackendFinding[],
  stale: boolean,
) {
  if (stale) return [];
  const sorted = findings
    .filter(
      ({ claim }) =>
        Number.isInteger(claim.start) &&
        Number.isInteger(claim.end) &&
        claim.start >= 0 &&
        claim.end > claim.start &&
        claim.end <= text.length &&
        text.slice(claim.start, claim.end) === claim.text,
    )
    .sort((a, b) => a.claim.start - b.claim.start || a.claim.end - b.claim.end);
  const result: BackendFinding[] = [];
  for (const finding of sorted) {
    if (finding.claim.start >= (result.at(-1)?.claim.end ?? 0))
      result.push(finding);
  }
  return result;
}

export function findingTone(finding: BackendFinding) {
  if (finding.processing !== "complete" || finding.support === "not_verified")
    return "unverified";
  if (
    finding.support === "supported" &&
    (finding.basis === "supplied_text" || finding.eligibility === "eligible") &&
    (finding.citation === "correct" ||
      (finding.basis !== undefined && finding.citation === "not_checked"))
  )
    return "supported";
  return "review";
}

export function findingLabel(finding: BackendFinding) {
  return findingTone(finding) === "supported" ? "Supported" : "Unsupported";
}

export function findingDetail(f: BackendFinding) {
  if (findingTone(f) === "supported") return "Supported";
  if (f.processing !== "complete" || f.evidenceGap === "check_incomplete")
    return "Check incomplete";
  if (f.support === "contradicted") return "Contradicted";
  if (f.support === "overstated") return "Overstated";
  if (f.support === "partial" || f.support === "mixed")
    return "Partly supported";
  if (f.support === "supported") return "Citation issue";
  if (f.evidenceGap === "not_addressed") return "Not in your sources";
  if (f.evidenceGap === "source_requirements") return "Source not eligible";
  if (f.evidenceGap === "source_unavailable") return "No readable source";
  return "Needs evidence";
}

export function findingAssessment(f: BackendFinding) {
  if (findingTone(f) === "supported")
    return {
      meaning:
        f.basis === "supplied_text"
          ? "Your selected material supports this claim. This checks agreement with the text, not whether the material itself is factually correct."
          : "The source supports this claim within the scope of its findings.",
      next: "Keep the wording within the source’s scope.",
    };
  if (f.support === "contradicted")
    return {
      meaning: "The source disagrees with this claim.",
      next: "Correct the claim using the passage below.",
    };
  if (f.support === "overstated")
    return {
      meaning: "The claim is stronger than the source’s findings.",
      next: "Narrow the claim or qualify its wording.",
    };
  if (f.support === "partial" || f.support === "mixed")
    return {
      meaning:
        "The evidence supports only part of the claim or gives conflicting results.",
      next: "Split the claim and explain the limits of the evidence.",
    };
  if (f.processing !== "complete" || f.evidenceGap === "check_incomplete")
    return {
      meaning: "The check did not finish. Support has not been established.",
      next: "Run the check again. This result is not a factual verdict.",
    };
  if (f.evidenceGap === "source_unavailable" || !f.evidence.length)
    return {
      meaning: "Proof could not read a relevant source passage.",
      next: "Upload the full text or a relevant handout, select it, and check again.",
    };
  if (f.evidenceGap === "not_addressed")
    return {
      meaning: "The selected material does not discuss this claim.",
      next: "Select material that covers the claim, or remove it.",
    };
  if (f.evidenceGap === "source_requirements")
    return {
      meaning:
        "The source does not meet the requirements for this research check.",
      next: "For notes and testing materials, use Check my materials.",
    };
  if (f.support === "supported")
    return {
      meaning:
        "The text supports the claim, but its citation or source requirements still need attention.",
      next: "Review the citation and source details below.",
    };
  return {
    meaning: "The available evidence is insufficient to support this claim.",
    next: "Add a passage that directly backs the claim, or narrow its wording.",
  };
}

export function sourceCheckScope(
  selectedCount: number,
  bibliographyReady: boolean,
) {
  return selectedCount > 0 || !bibliographyReady
    ? "selected_library"
    : "cited_first_then_selected_library";
}
