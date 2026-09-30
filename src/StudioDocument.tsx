import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  FileText,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import type { BackendFinding } from "../shared/backend";
import {
  documentHighlights,
  findingLabel,
  findingTone,
} from "./studio-document";
import "./studio-document.css";
import { citationLabel, processingLabel } from "./studio-status";

export default function StudioDocument({
  title,
  text,
  findings,
  stale,
  status,
  sources,
  onEdit,
  onAnalyze,
  onApply,
  locked,
}: {
  title: string;
  text: string;
  findings: BackendFinding[];
  stale: boolean;
  status?: string;
  sources: { id: string; metadata: { title: string } }[];
  onEdit: () => void;
  onAnalyze: () => void;
  onApply: (finding: BackendFinding) => void;
  locked: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const detailRef = useRef<HTMLElement>(null);
  const highlights = documentHighlights(text, findings, stale);
  const current = findings.find((f) => f.id === selected) || findings[0];
  useEffect(() => setSelected(undefined), [text, status === undefined]);
  const stateLabel = stale
    ? "Draft changed"
    : status === "complete"
      ? "Checked"
      : status === "running"
        ? "Checking..."
        : status === "queued"
          ? "Queued"
          : status === "failed"
            ? "Check failed"
            : status === "cancelled"
              ? "Cancelled"
              : "Not checked";
  const fragments: ReactNode[] = [];
  let cursor = 0;
  for (const finding of highlights) {
    fragments.push(text.slice(cursor, finding.claim.start));
    fragments.push(
      <button
        key={finding.id}
        id={`ps-claim-${finding.id}`}
        className={`ps-text-claim ${findingTone(finding)} ${current?.id === finding.id ? "selected" : ""}`}
        aria-pressed={current?.id === finding.id}
        aria-controls="studio-evidence-detail"
        title={`${findingLabel(finding)}. Open evidence.`}
        onClick={() => {
          setSelected(finding.id);
          detailRef.current?.focus({ preventScroll: true });
          if (window.matchMedia("(max-width: 1100px)").matches) {
            detailRef.current?.scrollIntoView({
              block: "start",
              behavior:
                document.documentElement.dataset.proofMotion === "reduced" ||
                window.matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
            });
          }
        }}
      >
        {finding.claim.text}
      </button>,
    );
    cursor = finding.claim.end;
  }
  fragments.push(text.slice(cursor));
  const counts = { supported: 0, review: 0, unverified: 0 };
  findings.forEach((f) => counts[findingTone(f)]++);
  return (
    <div className="ps-document-review">
      <section
        className="ps-reading-paper"
        aria-label="Document with citation findings"
      >
        <div className="ps-reading-toolbar">
          <span>
            <FileText size={16} /> Document
          </span>
          <button className="ps-outline" onClick={onEdit} disabled={locked}>
            <Pencil size={15} /> Edit text
          </button>
        </div>
        <article className="ps-reading-content">
          <h2>{title}</h2>
          <div className="ps-reading-meta">
            {text.trim().split(/\s+/).filter(Boolean).length} words
          </div>
          {stale && (
            <p className="ps-reading-notice" role="status">
              The draft has changed. Run analysis again to refresh its
              highlights.
            </p>
          )}
          {text.trim() ? (
            <div className="ps-reading-text">{fragments}</div>
          ) : (
            <div className="ps-reading-empty">
              <FileText size={32} />
              <h3>Add your document</h3>
              <p>Import a file or paste your writing to start.</p>
              <button className="ps-primary" onClick={onEdit}>
                Add text <ArrowRight size={16} />
              </button>
            </div>
          )}
        </article>
      </section>
      <aside
        className="ps-reading-evidence"
        aria-label="Evidence beside your document"
      >
        <header>
          <h2>Evidence check</h2>
          <span className={`ps-reading-state ${stale ? "stale" : ""}`}>
            {stateLabel}
          </span>
        </header>
        {findings.length > 0 && !stale && (
          <div className="ps-evidence-counts">
            <span className="supported">
              <strong>{counts.supported}</strong>
              <CheckCircle2 size={13} /> Supported
            </span>
            <span className="review">
              <strong>{counts.review}</strong>
              <TriangleAlert size={13} /> To review
            </span>
            <span className="unverified">
              <strong>{counts.unverified}</strong>
              <CircleHelp size={13} /> Unverified
            </span>
          </div>
        )}
        {current && !stale ? (
          <>
            <section
              id="studio-evidence-detail"
              className="ps-evidence-detail"
              ref={detailRef}
              tabIndex={-1}
              aria-label="Selected claim evidence"
            >
              <span className={`ps-evidence-label ${findingTone(current)}`}>
                {findingLabel(current)}
              </span>
              <blockquote>{current.claim.text}</blockquote>
              <p className="ps-evidence-facts">
                {citationLabel(current.citation)} ·{" "}
                {processingLabel(current.processing)}
              </p>
              {current.explanation.map((explanation, i) => (
                <p key={i}>{explanation}</p>
              ))}
              {current.evidence.length === 0 && (
                <p>No readable source passage is attached to this finding.</p>
              )}
              {current.evidence.map((passage, i) => (
                <details key={`${passage.id}:${i}`} open={i === 0}>
                  <summary>
                    {sources.find((s) => s.id === passage.assetId)?.metadata
                      .title || "Source passage"}{" "}
                    · page {passage.pageLabel || passage.pageIndex}
                  </summary>
                  <blockquote>{passage.text}</blockquote>
                  <p>
                    {passage.role} source ·{" "}
                    {passage.support.replaceAll("_", " ")}
                  </p>
                </details>
              ))}
              {current.fix && (
                <details>
                  <summary>Suggested edit</summary>
                  <p>Original</p>
                  <blockquote>{current.fix.original}</blockquote>
                  <p>Replacement</p>
                  <blockquote>{current.fix.replacement}</blockquote>
                  <button
                    className="ps-primary"
                    disabled={locked}
                    onClick={() => onApply(current)}
                  >
                    Apply this edit
                  </button>
                </details>
              )}
            </section>
            <nav
              className="ps-evidence-findings"
              aria-label="All document findings"
            >
              {findings.map((f) => (
                <button
                  key={f.id}
                  className={current.id === f.id ? "active" : ""}
                  aria-pressed={current.id === f.id}
                  onClick={() => {
                    setSelected(f.id);
                    document
                      .getElementById(`ps-claim-${f.id}`)
                      ?.scrollIntoView({
                        block: "center",
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "instant"
                          : "smooth",
                      });
                  }}
                >
                  <span className={`ps-evidence-label ${findingTone(f)}`}>
                    {findingLabel(f)}
                  </span>
                  <span>{f.claim.text}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </nav>
          </>
        ) : (
          <div className="ps-evidence-empty">
            <CircleHelp size={28} />
            <h3>
              {stale
                ? "Refresh the evidence"
                : status === "queued" || status === "running"
                  ? "Checking your document"
                  : "Read with the evidence"}
            </h3>
            <p>
              {stale
                ? "Previous findings belong to an earlier version of this draft."
                : "Run an analysis to see claims highlighted here. Select a claim to read its source passages."}
            </p>
            <button className="ps-primary" onClick={onAnalyze}>
              {stale ? "Check again" : "Set up a check"}{" "}
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
