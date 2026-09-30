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
    finding.eligibility === "eligible" &&
    finding.citation === "correct"
  )
    return "supported";
  return "review";
}

export function findingLabel(finding: BackendFinding) {
  const tone = findingTone(finding);
  return tone === "supported"
    ? "Supported"
    : tone === "review"
      ? "Needs review"
      : "Unverified";
}
