import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  LocateFixed,
} from "lucide-react";
import type { BackendFinding } from "../shared/backend";
import type { CitationPlan } from "../shared/citation-plan";
import { citationLabel } from "./studio-status";
import {
  citationParagraph,
  citationProvenance,
  type CitationIssue,
} from "./studio-citation-review";
import StudioCitationPlan from "./StudioCitationPlan";
import "./studio-citation-results.css";

export default function StudioCitationResults({
  plan,
  issues,
  content,
  findings,
  documentVersionId,
  blocked,
  stale,
  sourceTitle,
  sourcePagination,
  onApply,
  onLocate,
  onOpenInventory,
  onOpenSource,
  onAcceptFix,
  focusedFindingId,
}: {
  plan: CitationPlan;
  issues: CitationIssue[];
  content: string;
  findings: BackendFinding[];
  documentVersionId?: string;
  blocked: boolean;
  stale: boolean;
  sourceTitle: (id: string) => string | undefined;
  sourcePagination: (id: string) => string | undefined;
  onApply: (ids: string[]) => Promise<void>;
  onLocate: (start: number, end: number) => void;
  onOpenInventory: (selection?: {
    kind: "occurrence" | "entry";
    id: string;
  }) => void;
  onOpenSource: (id: string) => void;
  onAcceptFix: (finding: BackendFinding) => Promise<void>;
  focusedFindingId?: string;
}) {
  const [tab, setTab] = useState<"issues" | "changes">(
    issues.length || !plan.operations.length ? "issues" : "changes",
  );
  const [expanded, setExpanded] = useState<string>();
  const [collapsedGroups, setCollapsedGroups] = useState<
    Set<CitationIssue["group"]>
  >(() => new Set());
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const unavailableClaims = findings.filter(
    (finding) =>
      finding.evidenceGap === "source_unavailable" &&
      finding.citation !== "not_required",
  ).length;
  const selectedIssue = focusedFindingId
    ? issues.find((issue) => issue.finding?.id === focusedFindingId)?.id
    : undefined;
  useEffect(() => {
    if (!selectedIssue) return;
    setExpanded(selectedIssue);
    setTab("issues");
    const group = issues.find((issue) => issue.id === selectedIssue)?.group;
    if (group)
      setCollapsedGroups((current) => {
        if (!current.has(group)) return current;
        const next = new Set(current);
        next.delete(group);
        return next;
      });
  }, [selectedIssue, issues]);
  function tabKeys(
    event: KeyboardEvent<HTMLButtonElement>,
    next: "issues" | "changes",
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const value =
      event.key === "Home" ? "issues" : event.key === "End" ? "changes" : next;
    setTab(value);
    document.getElementById(`citation-tab-${value}`)?.focus();
  }
  function rows(group: CitationIssue["group"]): ReactNode {
    const items = issues.filter((issue) => issue.group === group);
    if (!items.length) return null;
    const title = group === "citations" ? "In-text citations" : "Works Cited";
    const collapsed = collapsedGroups.has(group);
    return (
      <section
        className="ps-citation-issue-group"
        aria-label={
          group === "citations"
            ? "In-text citation issues"
            : "Works Cited issues"
        }
      >
        <h4 className="ps-citation-issue-group-heading">
          <button
            className="ps-citation-issue-group-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-controls={`citation-issue-group-${group}`}
            onClick={() =>
              setCollapsedGroups((current) => {
                const next = new Set(current);
                if (collapsed) next.delete(group);
                else next.add(group);
                return next;
              })
            }
          >
            <span>{title}</span>
            <span className="ps-citation-issue-group-count">
              {items.length}
            </span>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        </h4>
        <div id={`citation-issue-group-${group}`} hidden={collapsed}>
          {items.map((issue) => {
            const open = (expanded ?? selectedIssue) === issue.id;
            const finding = issue.finding;
            return (
              <article
                key={issue.id}
                className={`ps-citation-issue ${open ? "is-open" : ""}`}
              >
                <button
                  className="ps-citation-issue-toggle"
                  aria-expanded={open}
                  aria-controls={`citation-issue-${issue.id}`}
                  onClick={() => setExpanded(open ? "" : issue.id)}
                >
                  {issue.advisory ? (
                    <Info size={17} className="ps-citation-advisory" />
                  ) : (
                    <CircleAlert size={17} />
                  )}
                  <span>
                    <strong>{issue.title}</strong>
                    <span className="ps-citation-issue-context">
                      {issue.text}
                    </span>
                    {issue.start !== undefined && !stale && (
                      <small>
                        Paragraph {citationParagraph(content, issue.start)}
                        {issue.operationIds.length
                          ? " · Suggested change available"
                          : ""}
                      </small>
                    )}
                  </span>
                  {open ? (
                    <ChevronDown size={17} />
                  ) : (
                    <ChevronRight size={17} />
                  )}
                </button>
                {open && (
                  <div
                    className="ps-citation-issue-detail"
                    id={`citation-issue-${issue.id}`}
                  >
                    {finding && (
                      <blockquote className="ps-citation-claim">
                        {finding.claim.text}
                      </blockquote>
                    )}
                    <p>{issue.reason}</p>
                    {issue.next && (
                      <p className="ps-review-muted">{issue.next}</p>
                    )}
                    {finding && (
                      <p className="ps-citation-assessments">
                        Evidence: {finding.support.replaceAll("_", " ")} ·{" "}
                        {citationLabel(finding.citation)}
                      </p>
                    )}
                    {!!finding?.citationChecks?.length && (
                      <details className="ps-citation-evidence">
                        <summary>Individual citation checks</summary>
                        <ul>
                          {finding.citationChecks.map((check) => (
                            <li key={`${check.start}:${check.itemIndex}`}>
                              <strong>
                                {check.text} · {citationLabel(check.citation)}
                              </strong>
                              <p className="ps-review-muted">
                                {check.status === "matched"
                                  ? "Source matched"
                                  : check.status === "ambiguous"
                                    ? "Source ambiguous"
                                    : "Source not matched"}
                                {check.sourceIds.length
                                  ? ` · ${check.sourceIds.map((id) => sourceTitle(id) || "Source unavailable").join("; ")}`
                                  : ""}
                                {" · "}Evidence:{" "}
                                {check.support.replaceAll("_", " ")}
                                {check.locator
                                  ? ` · Pages: ${check.locator}`
                                  : ""}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="ps-citation-issue-actions">
                      {issue.start !== undefined && issue.end !== undefined && (
                        <button
                          className="ps-outline"
                          disabled={stale || blocked}
                          onClick={() => onLocate(issue.start!, issue.end!)}
                        >
                          <LocateFixed size={14} />
                          Locate in draft
                        </button>
                      )}
                      {!!issue.sourceIds.length && (
                        <button
                          className="ps-outline"
                          onClick={() => onOpenSource(issue.sourceIds[0])}
                        >
                          Open source
                        </button>
                      )}
                      {issue.entryIndex !== undefined && (
                        <button
                          className="ps-review-link"
                          onClick={() =>
                            onOpenInventory({
                              kind: "entry",
                              id: `entry:${issue.entryIndex}`,
                            })
                          }
                        >
                          Review entry
                          <ArrowRight size={14} />
                        </button>
                      )}
                      {!!issue.operationIds.length && (
                        <button
                          className="ps-review-link"
                          onClick={() => setTab("changes")}
                        >
                          Review suggested change
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                    {!!finding?.evidence.length && (
                      <details className="ps-citation-evidence">
                        <summary>Evidence and source details</summary>
                        {finding.evidence.map((passage) => (
                          <figure
                            className="ps-change-passage"
                            key={passage.id}
                          >
                            <blockquote>
                              {passage.excerpt || passage.text}
                            </blockquote>
                            <figcaption>
                              {sourceTitle(passage.assetId) || "Source passage"}{" "}
                              ·{" "}
                              {citationProvenance({
                                sourceAccess: passage.sourceAccess,
                                support: passage.support,
                                checkedPassageIds: [passage.id],
                              })}{" "}
                              ·{" "}
                              {sourcePagination(passage.assetId) ===
                              "unavailable"
                                ? "Citation page unavailable"
                                : passage.labelStatus === "unknown"
                                  ? `Physical page ${passage.pageIndex} · Printed page unconfirmed`
                                  : `Page ${passage.pageLabel || passage.pageIndex}`}
                            </figcaption>
                          </figure>
                        ))}
                        {finding.explanation.map((text, index) => (
                          <p key={index}>{text}</p>
                        ))}
                      </details>
                    )}
                    {finding?.fix && (
                      <>
                        <p className="ps-change-diff">
                          <del>{finding.fix.original}</del>
                          <ins>{finding.fix.replacement}</ins>
                        </p>
                        <button
                          className="ps-outline"
                          disabled={blocked || stale || accepting}
                          onClick={() => {
                            setAccepting(true);
                            setError("");
                            void onAcceptFix(finding)
                              .catch((e) => setError((e as Error).message))
                              .finally(() => setAccepting(false));
                          }}
                        >
                          {accepting ? "Saving…" : "Apply wording correction"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <div className="ps-citation-results">
      {unavailableClaims > 0 && (
        <p className="ps-review-incomplete" role="status">
          <Info size={16} />
          <span>
            <strong>Citation verification incomplete.</strong> Enough source
            text was unavailable for {unavailableClaims}{" "}
            {unavailableClaims === 1 ? "claim" : "claims"}. Retrieve the cited
            works in New check or upload the original articles, then rerun.
          </span>
        </p>
      )}
      <div
        className="ps-citation-tabs"
        role="tablist"
        aria-label="Citation results"
      >
        <button
          id="citation-tab-issues"
          role="tab"
          aria-selected={tab === "issues"}
          aria-controls="citation-panel-issues"
          tabIndex={tab === "issues" ? 0 : -1}
          onClick={() => setTab("issues")}
          onKeyDown={(event) => tabKeys(event, "changes")}
        >
          Issues <span>{issues.length}</span>
        </button>
        <button
          id="citation-tab-changes"
          role="tab"
          aria-selected={tab === "changes"}
          aria-controls="citation-panel-changes"
          tabIndex={tab === "changes" ? 0 : -1}
          onClick={() => setTab("changes")}
          onKeyDown={(event) => tabKeys(event, "issues")}
        >
          Changes <span>{plan.operations.length}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        id="citation-panel-issues"
        aria-labelledby="citation-tab-issues"
        hidden={tab !== "issues"}
      >
        {!issues.length && (
          <div className="ps-citation-empty">
            <strong>No issues found in this check</strong>
            <p>
              This result covers the checked material only. It does not
              establish that every claim is true.
            </p>
          </div>
        )}
        {rows("citations")}
        {rows("bibliography")}
        {findings.some((finding) => finding.citationChecks?.length) && (
          <details className="ps-citation-evidence">
            <summary>Checked citations</summary>
            {findings.flatMap((finding) =>
              (finding.citationChecks || []).map((check, index) => {
                const passages = finding.evidence.filter(
                  (passage) =>
                    check.checkedPassageIds.includes(passage.id) &&
                    check.sourceIds.includes(passage.assetId),
                );
                const title =
                  check.source?.title ||
                  check.sourceIds.map(sourceTitle).find(Boolean) ||
                  (/^\(?\d{4}\)?$/.test(check.text)
                    ? `Unmatched source · ${check.text.replace(/[()]/g, "")}`
                    : check.text);
                return (
                  <article
                    className="ps-citation-issue-detail"
                    key={`${finding.id}:${index}`}
                  >
                    <strong>
                      {check.support === "supported"
                        ? "Supported"
                        : ["partial", "mixed", "overstated"].includes(
                              check.support,
                            )
                          ? "Partially supported"
                          : check.support === "contradicted"
                            ? "Not supported"
                            : check.checkedPassageIds.length
                              ? "Insufficient evidence"
                              : "Not verified"}
                    </strong>
                    <h4>{title}</h4>
                    {check.source && (
                      <p>
                        {[
                          check.source.authors.join(", "),
                          check.source.year,
                          check.source.journal,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <p>{citationProvenance(check)}</p>
                    <p>{check.claimText || finding.claim.text}</p>
                    {passages.map((passage) => (
                      <blockquote key={passage.id}>
                        {passage.excerpt || passage.text}
                      </blockquote>
                    ))}
                    {(check.explanation || finding.explanation).map(
                      (text, explanationIndex) => (
                        <p key={explanationIndex}>{text}</p>
                      ),
                    )}
                    <div className="ps-citation-issue-actions">
                      {check.sourceIds.map((id) => (
                        <button
                          className="ps-review-link"
                          key={id}
                          onClick={() => onOpenSource(id)}
                        >
                          Open source <ArrowRight size={14} />
                        </button>
                      ))}
                      <button
                        className="ps-review-link"
                        disabled={stale}
                        onClick={() =>
                          onLocate(
                            check.claimStart ?? finding.claim.start,
                            check.claimEnd ?? finding.claim.end,
                          )
                        }
                      >
                        Locate in draft <LocateFixed size={14} />
                      </button>
                    </div>
                  </article>
                );
              }),
            )}
          </details>
        )}
        {error && (
          <p role="alert" className="ps-review-error">
            {error}
          </p>
        )}
        <button
          className="ps-citation-inventory-link"
          onClick={() => onOpenInventory()}
        >
          Open Sources & citations
          <ArrowRight size={16} />
        </button>
      </div>
      <div
        role="tabpanel"
        id="citation-panel-changes"
        aria-labelledby="citation-tab-changes"
        hidden={tab !== "changes"}
      >
        <StudioCitationPlan
          plan={plan}
          content={content}
          findings={findings}
          documentVersionId={documentVersionId}
          blocked={blocked || stale}
          sourceTitle={sourceTitle}
          sourcePagination={sourcePagination}
          onApply={onApply}
        />
      </div>
    </div>
  );
}
