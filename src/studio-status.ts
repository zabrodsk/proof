import type { Citation, Eligibility, Processing } from "../shared/backend";

export function runStatusLabel(status: string) {
  return (
    (
      {
        queued: "Queued",
        running: "Checking",
        complete: "Check complete",
        failed: "Check failed",
        cancelled: "Cancelled",
        pending: "Waiting",
        processing: "Processing",
      } as Record<string, string>
    )[status] || "Status unavailable"
  );
}
export function runStageLabel(stage: string) {
  return (
    (
      {
        claims: "Finding claims",
        retrieval: "Finding source passages",
        research: "Finding research",
        assessment: "Checking evidence",
        assess: "Checking evidence",
        extract: "Reading sources",
        done: "Finished",
        findings: "Preparing findings",
        complete: "Finished",
      } as Record<string, string>
    )[stage] || "Reviewing your draft"
  );
}
export const citationLabel = (citation: Citation) =>
  ({
    correct: "Citation matches",
    wrong_source: "Wrong source",
    wrong_locator: "Check the page reference",
    missing: "Citation missing",
    ambiguous: "Citation unclear",
    not_checked: "Citation not checked",
  })[citation];
export const processingLabel = (processing: Processing) =>
  ({
    complete: "Check complete",
    partial: "Partial check",
    failed: "Check incomplete",
  })[processing];
export const eligibilityLabel = (eligibility: Eligibility) =>
  ({
    eligible: "Source meets requirements",
    ineligible: "Source does not meet requirements",
    unknown: "Source eligibility unverified",
  })[eligibility];
