import type { Locator, ResultFinding } from "../shared/integrations/contracts";

// Older saved reports may omit processing. Coverage and citation/eligibility
// still have to establish support before the UI displays a positive verdict.
export function integrationFindingState(
  finding: ResultFinding & { processing?: string },
) {
  if (
    finding.coverage !== "checked" ||
    finding.support === "not_verified" ||
    (finding.processing && finding.processing !== "complete")
  )
    return {
      tone: "unverified",
      label:
        finding.processing && finding.processing !== "complete"
          ? "Check incomplete"
          : "Not enough evidence",
    } as const;
  if (
    finding.support === "supported" &&
    finding.sourceEligibility === "eligible" &&
    finding.citationCorrectness === "correct"
  )
    return { tone: "supported", label: "Supported" } as const;
  return { tone: "review", label: "Needs review" } as const;
}

export function evidenceLocator(locator: Locator) {
  let description =
    locator.page !== undefined
      ? `PDF page ${locator.page}${locator.pageLabel ? `, printed label ${locator.pageLabel}` : ""}`
      : locator.start !== undefined
        ? `Character offset ${locator.start}`
        : locator.paragraph !== undefined
          ? `Paragraph ${locator.paragraph}`
          : "Source locator not available";
  if (locator.chapter !== undefined)
    description += `, supplied chapter ${locator.chapter}`;
  return description;
}
