import type { CitationPlan } from "../shared/citation-plan";

const sourceLabels = {
  matched: "Source matched",
  ambiguous: "Source ambiguous",
  unmatched: "Source not matched",
};
const evidenceLabels: Record<string, string> = {
  correct: "Citation matches evidence",
  missing: "Citation missing",
  wrong_source: "Wrong source",
  wrong_locator: "Check the locator",
  ambiguous: "Citation unclear",
  not_checked: "Evidence not checked",
  not_required: "No citation needed",
};

export default function StudioCitationAudit({
  audit,
  stale,
  onLocate,
}: {
  audit: NonNullable<CitationPlan["audit"]>;
  stale: boolean;
  onLocate: (start: number, end: number) => void;
}) {
  return (
    <section
      className="ps-citation-review"
      aria-labelledby="citation-audit-title"
    >
      <h3 id="citation-audit-title">Citation audit</h3>
      <p>
        {audit.counts.occurrences} in-text citation
        {audit.counts.occurrences === 1 ? "" : "s"} ·{" "}
        {audit.counts.distinctCitedWorks} cited work
        {audit.counts.distinctCitedWorks === 1 ? "" : "s"} ·{" "}
        {audit.counts.bibliographyEntries} bibliography{" "}
        {audit.counts.bibliographyEntries === 1 ? "entry" : "entries"}
      </p>
      <p className="ps-review-muted">
        Matching a source identifies the work. Evidence and locator checks are
        separate.
      </p>
      {stale && (
        <p role="status">
          This audit belongs to the checked version of your document.
        </p>
      )}
      <details open={audit.occurrences.length > 0}>
        <summary>In-text citations · {audit.occurrences.length}</summary>
        {audit.occurrences.length ? (
          <ol className="ps-citation-audit-list">
            {audit.occurrences.map((occurrence) => (
              <li key={occurrence.id}>
                <button
                  className="ps-review-link ps-citation-location"
                  disabled={stale}
                  onClick={() => onLocate(occurrence.start, occurrence.end)}
                  aria-label={`Locate citation ${occurrence.text}`}
                >
                  {occurrence.text}
                </button>
                <p>
                  {sourceLabels[occurrence.status]} ·{" "}
                  {evidenceLabels[occurrence.citation || "not_checked"] ||
                    "Evidence needs review"}
                </p>
                <p className="ps-review-muted">
                  {occurrence.locator
                    ? `Locator: ${occurrence.locator}. `
                    : "No locator recorded. "}
                  Characters {occurrence.start + 1} to {occurrence.end} in the
                  checked draft.
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No in-text citation occurrences found.</p>
        )}
      </details>
      <details open={audit.bibliographyIssues.length > 0}>
        <summary>
          Bibliography issues · {audit.bibliographyIssues.length}
        </summary>
        {audit.bibliographyIssues.length ? (
          <ul className="ps-citation-audit-list">
            {audit.bibliographyIssues.map((issue, index) => (
              <li key={`${issue.kind}:${index}`}>
                <p>{issue.text}</p>
                <p className="ps-review-muted">{issue.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No bibliography issues were detected in this audit.</p>
        )}
      </details>
      {audit.wordCounts && (
        <p>
          Word count: body {audit.wordCounts.body}, title{" "}
          {audit.wordCounts.title}, bibliography {audit.wordCounts.bibliography}
          . The current assignment count is {audit.wordCounts.combined}{" "}
          body-and-title words. Confirm with your teacher whether the title
          counts.
        </p>
      )}
      {audit.assignmentChecks && (
        <details open>
          <summary>Assignment checks</summary>
          <ul className="ps-citation-audit-list">
            {audit.assignmentChecks.map((check, index) => (
              <li key={`${check.label}:${index}`}>
                <p>
                  <strong>{check.label}</strong> ·{" "}
                  {check.status === "pass"
                    ? "Text check passed"
                    : check.status === "manual"
                      ? "Manual review"
                      : "Needs review"}
                </p>
                <p className="ps-review-muted">{check.detail}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
