import type { BackendFinding, RunInput } from "../shared/backend";

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
    (finding.basis === "supplied_text" ||
      finding.basis === "public_sources" ||
      finding.eligibility === "eligible") &&
    (finding.citation === "correct" ||
      finding.citation === "not_required" ||
      (finding.basis !== undefined && finding.citation === "not_checked"))
  )
    return "supported";
  return "review";
}

export function findingLabel(finding: BackendFinding) {
  return findingTone(finding) === "supported" ? "Supported" : "Unsupported";
}

export function citationExempt(f: BackendFinding, mode?: RunInput["mode"]) {
  return (
    mode !== "fact_check" &&
    f.citation === "not_required" &&
    f.processing === "complete" &&
    f.support === "not_verified" &&
    !f.evidenceGap
  );
}

export function findingDetail(f: BackendFinding, mode?: RunInput["mode"]) {
  if (citationExempt(f, mode)) return "No citation needed";
  if (findingTone(f) === "supported") return "Supported";
  if (f.processing !== "complete" || f.evidenceGap === "check_incomplete")
    return "Check incomplete";
  if (f.support === "contradicted") return "Contradicted";
  if (f.support === "overstated") return "Overstated";
  if (f.support === "partial" || f.support === "mixed")
    return "Partly supported";
  if (f.support === "supported") {
    if (f.citation === "wrong_locator") return "Wrong citation page";
    if (f.citation === "wrong_source") return "Wrong source cited";
    if (f.citation === "missing") return "Citation missing";
    if (f.citation === "ambiguous") return "Citation unclear";
    return "Citation needs review";
  }
  if (f.evidenceGap === "not_addressed") return "Not in your sources";
  if (f.evidenceGap === "source_requirements") return "Source not eligible";
  if (f.evidenceGap === "source_unavailable") return "No readable source";
  return "Needs evidence";
}

export function findingAssessment(f: BackendFinding, mode?: RunInput["mode"]) {
  if (citationExempt(f, mode))
    return {
      meaning:
        "This statement is marked as common knowledge and does not need a citation. Its accuracy has not been fact-checked in this citation workflow.",
      next: "Use Fact-check if you want to verify the statement.",
    };
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
      next: "For notes and testing materials, use Check citations.",
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
  _selectedCount: number,
  _bibliographyReady: boolean,
) {
  // Check citations must inspect the cited work/page even with uploaded sources.
  return "cited_first_then_selected_library" as const;
}

export function documentDownloadName(title: string, format: "txt" | "html") {
  const name = title
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return `${name || "proof-document"}.${format}`;
}
