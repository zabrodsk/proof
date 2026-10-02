import { useMemo, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { BackendFinding } from "../shared/backend";
import { renderCitationPlan, type CitationPlan } from "../shared/citation-plan";

export default function StudioCitationPlan({
  plan,
  content,
  findings,
  documentVersionId,
  blocked,
  sourceTitle,
  sourcePagination,
  onApply,
}: {
  plan: CitationPlan;
  content: string;
  findings: BackendFinding[];
  documentVersionId?: string;
  blocked: boolean;
  sourceTitle: (assetId: string) => string | undefined;
  sourcePagination: (assetId: string) => string | undefined;
  onApply: (operationIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(() =>
    plan.operations.map((op) => op.id),
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const applied = plan.status === "applied";
  const stale = documentVersionId !== plan.documentVersionId;
  const preview = useMemo(() => {
    if (applied || stale) return { text: content, error: "" };
    try {
      return { text: renderCitationPlan(content, plan, selected), error: "" };
    } catch (e) {
      return { text: content, error: (e as Error).message };
    }
  }, [content, plan, selected, applied, stale]);
  const disabled = blocked || applying || stale || applied;
  const citationExemptCount =
    plan.coverage.citationExemptClaims ?? plan.exemptions?.length ?? 0;
  const citationNeededCount = Math.max(
    0,
    plan.coverage.totalClaims - citationExemptCount,
  );
  return (
    <section
      className="ps-citation-review"
      aria-labelledby="citation-proposals-title"
    >
      <h3 id="citation-proposals-title">Citation proposals</h3>
      <p>
        {plan.coverage.citableClaims} of {citationNeededCount} claims needing
        citations have citation-ready evidence. Each selected citation includes
        its matching Works Cited entry.
      </p>
      {applied ? (
        <p role="status">
          Approved citations are saved in a new document version.
        </p>
      ) : stale ? (
        <p role="status">
          This plan belongs to an earlier version. Run a new check before
          applying citations.
        </p>
      ) : plan.profile === "classroom" ? (
        <p>
          Classroom work uses a manual citation audit. Review the findings and
          update your own draft.
        </p>
      ) : (
        <>
          {plan.operations.map((operation) => {
            const finding = findings.find(
              (item) => item.id === operation.findingId,
            );
            const label =
              operation.kind === "citation"
                ? `Citation for ${finding?.claim.text || "selected claim"}`
                : "Repair bibliography entry";
            const references = plan.references.filter((reference) =>
              operation.referenceIds.includes(reference.id),
            );
            return (
              <article className="ps-citation-operation" key={operation.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(operation.id)}
                    disabled={disabled}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [...ids, operation.id]
                          : ids.filter((id) => id !== operation.id),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
                <p className="ps-change-diff">
                  {operation.original && <del>{operation.original}</del>}
                  <ins>{operation.replacement}</ins>
                </p>
                <details>
                  <summary>Evidence and reference</summary>
                  {operation.evidence.map((passage) => (
                    <figure className="ps-change-passage" key={passage.id}>
                      <blockquote>{passage.text}</blockquote>
                      <figcaption>
                        {sourceTitle(passage.assetId) || "Source passage"} ·{" "}
                        {sourcePagination(passage.assetId) === "unavailable"
                          ? "Retrieved text. Citation page unavailable"
                          : passage.labelStatus === "unknown"
                            ? `Physical page ${passage.pageIndex}. Printed page unconfirmed`
                            : `Page ${passage.pageLabel || passage.pageIndex}`}
                      </figcaption>
                    </figure>
                  ))}
                  {references.map((reference) => (
                    <p key={reference.id}>{reference.text}</p>
                  ))}
                  {operation.explanation.map((explanation, index) => (
                    <p className="ps-review-muted" key={index}>
                      {explanation}
                    </p>
                  ))}
                </details>
              </article>
            );
          })}
          {plan.operations.length > 0 ? (
            <>
              <details>
                <summary>Preview complete document</summary>
                <pre className="ps-citation-preview">{preview.text}</pre>
              </details>
              {(error || preview.error) && (
                <p role="alert">{error || preview.error}</p>
              )}
              <button
                className="ps-primary"
                disabled={disabled || !selected.length || !!preview.error}
                onClick={() => {
                  setApplying(true);
                  setError("");
                  void onApply(selected)
                    .catch((e) => setError((e as Error).message))
                    .finally(() => setApplying(false));
                }}
              >
                {applying ? (
                  <LoaderCircle size={16} className="ps-spin" />
                ) : (
                  <Check size={16} />
                )}
                Apply selected citations
              </button>
            </>
          ) : (
            <p>
              {citationNeededCount === 0 && citationExemptCount > 0
                ? "No citations are needed for the selected claims."
                : "No safe citation edits are available for this draft."}
            </p>
          )}
        </>
      )}
      {plan.warnings.map((warning, index) => (
        <p className="ps-review-muted" key={index}>
          {warning}
        </p>
      ))}
      {!!plan.exemptions?.length && (
        <details open>
          <summary>No citation needed · {plan.exemptions.length}</summary>
          <ul className="ps-citation-gaps">
            {plan.exemptions.map((exemption) => (
              <li key={exemption.findingId}>
                <p>{exemption.claim}</p>
                <p>{exemption.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {plan.gaps.length > 0 && (
        <details open>
          <summary>Uncited claims and gaps · {plan.gaps.length}</summary>
          <ul className="ps-citation-gaps">
            {plan.gaps.map((gap) => (
              <li key={gap.findingId}>
                <p>{gap.claim}</p>
                <p>{gap.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
