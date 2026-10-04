import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import type { BackendFinding } from "../shared/backend";
import {
  renderCitationPlan,
  type CitationOperation,
  type CitationPlan,
} from "../shared/citation-plan";
import "./studio-citation-plan.css";

function changedText(original: string, replacement: string) {
  let start = 0;
  while (
    start < original.length &&
    start < replacement.length &&
    original[start] === replacement[start]
  )
    start++;
  let end = 0;
  while (
    end < original.length - start &&
    end < replacement.length - start &&
    original[original.length - end - 1] ===
      replacement[replacement.length - end - 1]
  )
    end++;
  return {
    before: replacement.slice(0, start),
    added: replacement.slice(start, replacement.length - end),
    after: end ? replacement.slice(-end) : "",
  };
}

function operationTitle(
  operation: CitationOperation,
  finding?: BackendFinding,
) {
  if (operation.kind === "bibliography")
    return operation.original
      ? "Repair bibliography entry"
      : "Add bibliography entry";
  return finding?.citation === "missing"
    ? "Add missing citation"
    : "Update citation";
}

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
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | undefined>(
    plan.operations[0]?.id,
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const applied = plan.status === "applied";
  const stale = documentVersionId !== plan.documentVersionId;
  const manual = plan.profile === "classroom";
  const preview = useMemo(() => {
    if (applied || stale || manual) return { text: content, error: "" };
    try {
      return { text: renderCitationPlan(content, plan, selected), error: "" };
    } catch (e) {
      return { text: content, error: (e as Error).message };
    }
  }, [content, plan, selected, applied, stale, manual]);
  const disabled = blocked || applying || stale || applied || manual;
  const allSelected = plan.operations.every((operation) =>
    selected.includes(operation.id),
  );
  const citationExemptCount =
    plan.coverage.citationExemptClaims ?? plan.exemptions?.length ?? 0;
  const citationNeededCount = Math.max(
    0,
    plan.coverage.totalClaims - citationExemptCount,
  );

  return (
    <section className="ps-plan" aria-label="Citation proposals">
      {applied ? (
        <p className="ps-plan-status" role="status">
          {plan.appliedOperationIds
            ? `${plan.appliedOperationIds.length} ${plan.appliedOperationIds.length === 1 ? "change" : "changes"} saved in a new document version.`
            : "Approved changes saved in a new document version."}{" "}
          {!!plan.deferredOperationIds?.length &&
            `${plan.deferredOperationIds.length} left for review. `}
          Run a new check to review the updated draft.
        </p>
      ) : stale ? (
        <p className="ps-plan-status" role="status">
          {manual
            ? "This audit belongs to an earlier version. Run a new check for the updated draft."
            : "This plan belongs to an earlier version. Run a new check before applying changes."}
        </p>
      ) : manual ? (
        <p className="ps-plan-empty">
          Classroom work uses a manual citation audit. Review Issues and update
          your draft.
        </p>
      ) : plan.operations.length > 0 ? (
        <p className="ps-plan-intro">Review each suggestion before applying.</p>
      ) : null}

      {!manual && plan.operations.length > 0 ? (
        <>
          {!applied && (
            <div className="ps-plan-selection-tools">
              <span>{plan.operations.length} suggested changes</span>
              <button
                className="ps-plan-select-toggle"
                type="button"
                disabled={disabled}
                onClick={() => {
                  setError("");
                  setSelected(
                    allSelected
                      ? []
                      : plan.operations.map((operation) => operation.id),
                  );
                }}
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
          )}
          <div className="ps-plan-scroll">
            <div className="ps-plan-operations">
              {plan.operations.map((operation, index) => {
                const finding = findings.find(
                  (item) => item.id === operation.findingId,
                );
                const title = operationTitle(operation, finding);
                const references = plan.references.filter((reference) =>
                  operation.referenceIds.includes(reference.id),
                );
                const source = references
                  .map((reference) => sourceTitle(reference.assetId))
                  .filter(Boolean)
                  .join(", ");
                // Old offsets must not be used to infer a location in a changed draft.
                const paragraph =
                  !stale &&
                  !applied &&
                  content.slice(operation.start, operation.end) ===
                    operation.original
                    ? content.slice(0, operation.start).split(/\n\s*\n/).length
                    : undefined;
                const location =
                  operation.kind === "bibliography"
                    ? source || "Works Cited"
                    : paragraph
                      ? `Paragraph ${paragraph}`
                      : "In-text citation";
                const open = expanded === operation.id;
                const detailId = `${id}-change-${index}`;
                const titleId = `${detailId}-title`;
                const diff = changedText(
                  operation.original,
                  operation.replacement,
                );
                const saved = plan.appliedOperationIds?.includes(operation.id);

                return (
                  <article
                    className="ps-plan-operation ps-citation-operation"
                    key={operation.id}
                  >
                    <div className="ps-plan-operation-head">
                      <input
                        className="ps-plan-checkbox"
                        type="checkbox"
                        aria-label={`Select ${title.toLowerCase()} · ${location}`}
                        checked={
                          applied ? !!saved : selected.includes(operation.id)
                        }
                        disabled={disabled}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setError("");
                          setSelected((ids) =>
                            checked
                              ? [...ids, operation.id]
                              : ids.filter(
                                  (operationId) => operationId !== operation.id,
                                ),
                          );
                          if (checked) setExpanded(operation.id);
                        }}
                      />
                      <button
                        className="ps-plan-operation-toggle"
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        onClick={() =>
                          setExpanded(open ? undefined : operation.id)
                        }
                      >
                        <span className="ps-plan-operation-label">
                          <strong id={titleId}>{title}</strong>
                          <span className="ps-plan-location">{location}</span>
                        </span>
                        {applied && plan.appliedOperationIds && (
                          <span className="ps-plan-saved">
                            {saved ? "Saved" : "Deferred"}
                          </span>
                        )}
                        {open ? (
                          <ChevronDown size={17} />
                        ) : (
                          <ChevronRight size={17} />
                        )}
                      </button>
                    </div>
                    <div
                      className="ps-plan-operation-detail"
                      hidden={!open}
                      id={detailId}
                      role="region"
                      aria-labelledby={titleId}
                    >
                      <div className="ps-plan-diff">
                        <div>
                          <span className="ps-plan-diff-label">Current</span>
                          <p>
                            {operation.original || (
                              <span className="ps-plan-location">
                                No entry yet
                              </span>
                            )}
                          </p>
                        </div>
                        <div>
                          <span className="ps-plan-diff-label">Proposed</span>
                          <p>
                            {diff.before}
                            {diff.added && <mark>{diff.added}</mark>}
                            {diff.after}
                          </p>
                        </div>
                      </div>
                      {operation.explanation[0] && (
                        <p className="ps-plan-rationale">
                          {operation.explanation[0]}
                        </p>
                      )}
                      <details className="ps-plan-evidence">
                        <summary>
                          Evidence and reference <ChevronRight size={17} />
                        </summary>
                        <div className="ps-plan-evidence-content">
                          {operation.evidence.map((passage) => (
                            <figure key={passage.id}>
                              <blockquote>{passage.text}</blockquote>
                              <figcaption>
                                {sourceTitle(passage.assetId) ||
                                  "Source passage"}{" "}
                                ·{" "}
                                {sourcePagination(passage.assetId) ===
                                "unavailable"
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
                          {operation.explanation
                            .slice(1)
                            .map((explanation, explanationIndex) => (
                              <p
                                className="ps-plan-rationale"
                                key={explanationIndex}
                              >
                                {explanation}
                              </p>
                            ))}
                          {!operation.evidence.length && !references.length && (
                            <p className="ps-plan-rationale">
                              No linked evidence or reference is available for
                              this change.
                            </p>
                          )}
                        </div>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>

            <details className="ps-plan-preview">
              <summary>Preview changes</summary>
              <p className="ps-plan-rationale">
                {applied
                  ? "Saved document."
                  : stale
                    ? "Current document. This earlier plan cannot be previewed."
                    : "Complete document with the selected changes."}
              </p>
              <pre tabIndex={0} aria-label="Complete document preview">
                {preview.text}
              </pre>
            </details>
          </div>

          {!applied && (
            <footer className="ps-plan-footer">
              <p className="ps-plan-selection" role="status" aria-live="polite">
                {selected.length} of {plan.operations.length} changes selected
              </p>
              <p className="ps-plan-rationale">
                Required Works Cited entries are included.
              </p>
              {blocked && !stale && (
                <p className="ps-plan-action-status" role="status">
                  Wait until the document is ready before applying changes.
                </p>
              )}
              {(error || preview.error) && (
                <p className="ps-plan-error" role="alert">
                  {error || preview.error}
                </p>
              )}
              <button
                className="ps-primary ps-plan-apply"
                type="button"
                disabled={disabled || !selected.length || !!preview.error}
                onClick={async () => {
                  setApplying(true);
                  setError("");
                  try {
                    await onApply([...selected]);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setApplying(false);
                  }
                }}
              >
                {applying ? (
                  <LoaderCircle size={16} className="ps-spin" />
                ) : (
                  <Check size={16} />
                )}
                {applying
                  ? "Saving changes…"
                  : `Apply ${selected.length} selected ${selected.length === 1 ? "change" : "changes"}`}
              </button>
            </footer>
          )}
        </>
      ) : !manual && !applied ? (
        <p className="ps-plan-empty">
          {citationNeededCount === 0 && citationExemptCount > 0
            ? "No citations are needed for the selected claims."
            : "No safe citation edits are available for this draft. Review Issues for manual next steps."}
        </p>
      ) : null}
    </section>
  );
}
