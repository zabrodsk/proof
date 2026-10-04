import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { ClaimReviewRow } from "./studio-claims";
import type { CheckMode } from "./StudioDocument";
import {
  findingAssessment,
  findingDetail,
  findingTone,
} from "./studio-document";
import { citationLabel } from "./studio-status";
import "./studio-claims.css";

export default function StudioClaims({
  rows,
  mode,
  active,
  stale,
  search,
  onSearch,
  controls,
  onLocate,
  sourceTitle,
  locateDisabled,
  selectedCount,
}: {
  rows: ClaimReviewRow[];
  mode: CheckMode;
  active: boolean;
  stale: boolean;
  search: string;
  onSearch: (value: string) => void;
  controls: (row: ClaimReviewRow) => ReactNode;
  onLocate: (row: ClaimReviewRow) => void;
  sourceTitle: (id: string) => string | undefined;
  locateDisabled: boolean;
  selectedCount: number;
}) {
  const [filter, setFilter] = useState<
    | "cited"
    | "all"
    | "review"
    | "supported"
    | "no_citation"
    | "general_fact"
    | "unsure"
  >(mode === "source_check" ? "cited" : "all");
  useEffect(() => {
    setFilter(mode === "source_check" ? "cited" : "all");
  }, [mode]);
  const [expanded, setExpanded] = useState<number>();
  const citedOnly = mode === "source_check";
  const visible = rows.filter(
    (row) =>
      row.text.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === "unsure"
        ? row.unsure
        : !row.unsure &&
          (filter === "all" ||
            (filter === "cited" && row.hasCitation) ||
            (filter === "review" &&
              (!citedOnly || row.hasCitation) &&
              (!row.finding || findingTone(row.finding) !== "supported")) ||
            (filter === "supported" &&
              (!citedOnly || row.hasCitation) &&
              !!row.finding &&
              findingTone(row.finding) === "supported") ||
            (filter === "no_citation" && !row.hasCitation) ||
            (filter === "general_fact" &&
              row.citationRequirement === "common_knowledge"))),
  );

  return (
    <section className="ps-claims-page" aria-labelledby="studio-claims-title">
      <div className="ps-claims-heading">
        <div>
          <h2 id="studio-claims-title">Claims &amp; findings</h2>
          <p>
            {rows.filter((row) => !row.unsure).length} claims · {selectedCount}{" "}
            selected
          </p>
        </div>
        <label className="ps-claims-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Find a claim"
            placeholder="Search claims…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      </div>
      <p className="ps-review-muted">
        {citedOnly
          ? "Only claims with a citation are checked. Uncited claims are excluded from issues and results."
          : "Select claims for the next check."}
      </p>
      <div className="ps-review-filter" role="group" aria-label="Filter claims">
        {(
          [
            ["cited", "Cited claims"],
            ["all", "All claims"],
            ["review", "To review"],
            ["supported", "Supported"],
            ["no_citation", "No citation"],
            ["general_fact", "General fact"],
            ["unsure", "Unsure"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ol
        className="ps-changes ps-claim-results"
        aria-label="Claims with findings"
      >
        {visible.map((row) => {
          const unchecked = citedOnly && !row.hasCitation;
          const finding = unchecked ? undefined : row.finding;
          const open = expanded === row.start;
          const tone = finding ? findingTone(finding) : "unchecked";
          return (
            <li
              className={`ps-change ps-claim-result-row ${tone}`}
              key={`${row.start}:${row.end}`}
            >
              <div className="ps-claim-result-text">{controls(row)}</div>
              <div className="ps-claim-result-finding">
                {row.unsure ? (
                  <p className="ps-review-muted">Not included in the check.</p>
                ) : unchecked ? (
                  <p className="ps-review-muted">No citation · Not checked</p>
                ) : finding ? (
                  <>
                    <button
                      className="ps-change-head"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? undefined : row.start)}
                    >
                      <span className={`ps-change-tag ${tone}`}>
                        {findingDetail(finding, mode)}
                      </span>
                      <span className="ps-change-claim">
                        {open ? "Hide finding" : "View finding"}
                      </span>
                    </button>
                    {open && (
                      <div className="ps-change-detail">
                        <p>{findingAssessment(finding, mode).next}</p>
                        {finding.fix && (
                          <p className="ps-change-diff">
                            <del>{finding.fix.original}</del>
                            <ins>{finding.fix.replacement}</ins>
                          </p>
                        )}
                        {finding.evidence.length ? (
                          finding.evidence.map((passage, index) => (
                            <figure
                              className="ps-change-passage"
                              key={`${passage.id}:${index}`}
                            >
                              <blockquote>
                                {passage.excerpt || passage.text}
                              </blockquote>
                              <figcaption>
                                {sourceTitle(passage.assetId) ||
                                  "Source passage"}
                                {passage.sourceAccess === "abstract"
                                  ? " · Checked against abstract"
                                  : passage.sourceAccess === "full_text"
                                    ? " · Checked against full text"
                                    : passage.sourceAccess === "partial_text"
                                      ? " · Partial source text available"
                                      : ""}
                              </figcaption>
                            </figure>
                          ))
                        ) : (
                          <p>
                            No readable source passage is attached to this
                            finding.
                          </p>
                        )}
                        <details>
                          <summary>How Proof checked this</summary>
                          <p>{citationLabel(finding.citation)}</p>
                          {finding.explanation.map((text, index) => (
                            <p key={index}>{text}</p>
                          ))}
                        </details>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="ps-review-muted">
                    {stale
                      ? "Run a new check to get this claim’s result."
                      : active
                        ? "Checking this claim…"
                        : "Run the check to get this claim’s result."}
                  </p>
                )}
                {!row.unsure && (
                  <button
                    className="ps-review-link"
                    aria-label={`Open claim in review: ${row.text}`}
                    disabled={locateDisabled}
                    onClick={() => onLocate(row)}
                  >
                    Open in review <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!visible.length && (
        <p className="ps-review-muted">
          {rows.length
            ? "No claims match this view. Change the filter or search."
            : "No claims found in this text."}
        </p>
      )}
    </section>
  );
}
