import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  PencilLine,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { Finding, Source, Status } from "../shared/types";
import { accessLabels, labels } from "../shared/types";

type Props = {
  finding: Finding;
  source?: Source;
  position: number;
  total: number;
  stale: boolean;
  applied: boolean;
  ignored: boolean;
  onBack: () => void;
  onApply: () => void;
  onEdit: () => void;
  onAddSource: () => void;
  onRecheck: () => void;
  onIgnore: () => void;
  onPrevious: () => void;
  onNext: () => void;
};
const titles: Record<Status, string> = {
  supported: "This claim matches the evidence.",
  partial: "Only part of this claim is supported.",
  overstated: "The wording is stronger than the evidence.",
  contradicted: "The source says something different.",
  not_addressed: "The checked passages do not address this claim.",
  numeric_mismatch: "The numbers do not match.",
  citation_missing: "This claim may need a citation.",
  source_unavailable: "Add the source to check this claim.",
  uncertain: "There is not enough evidence to decide.",
};
const nextSteps: Partial<Record<Status, string>> = {
  partial:
    "Narrow the sentence to what the source actually supports, or add evidence for the remaining claim.",
  overstated: "Qualify the wording to match the study’s scope and certainty.",
  contradicted:
    "Revise the sentence to reflect the reported finding, or cite different evidence.",
  not_addressed:
    "Add a source that addresses this specific claim, or revise the sentence.",
  numeric_mismatch:
    "Compare the values in the source, then edit the number in your sentence.",
  citation_missing:
    "Add a citation in the sentence, then add its source if it is not in your bibliography.",
  source_unavailable:
    "Add the paper’s DOI or upload its text, then run the check again.",
  uncertain:
    "Check the source directly, add more evidence, or revise the sentence.",
};
function Highlight({ text, value }: { text: string; value?: string }) {
  if (!value) return <>{text}</>;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<!\\d)${escaped}(?!\\d)`).exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <mark>{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

export default function FindingDetail({
  finding,
  source,
  position,
  total,
  stale,
  applied,
  ignored,
  onBack,
  onApply,
  onEdit,
  onAddSource,
  onRecheck,
  onIgnore,
  onPrevious,
  onNext,
}: Props) {
  const correction = finding.numericCorrection;
  const isUnverified = ["uncertain", "source_unavailable"].includes(
    finding.status,
  );
  const tone =
    finding.status === "supported"
      ? "green"
      : isUnverified
        ? "slate"
        : finding.status === "contradicted"
          ? "red"
          : "amber";
  const Icon =
    finding.status === "supported"
      ? CircleCheck
      : isUnverified
        ? CircleHelp
        : CircleAlert;
  const excerpt =
    finding.evidenceExcerpt ||
    (finding.evidence && finding.evidence.length <= 450
      ? finding.evidence
      : undefined);
  const fullPassage = !!finding.evidence && excerpt !== finding.evidence;
  const needsSource = [
    "source_unavailable",
    "citation_missing",
    "not_addressed",
  ].includes(finding.status);
  const showFix = !!finding.fix && !stale;
  return (
    <div className="finding-detail clarified-finding">
      <div className="detail-navigation">
        <button onClick={onBack}>
          <ArrowLeft size={14} />
          All findings
        </button>
        <span>
          {position} / {total}
        </span>
      </div>
      <span className={`status-badge ${tone}`}>
        <Icon size={15} />
        {labels[finding.status]}
      </span>
      <h4 className="finding-title">
        {correction
          ? `The source reports ${correction.to} ${correction.unit}.`
          : titles[finding.status]}
      </h4>
      {!correction && <p className="finding-summary">{finding.explanation}</p>}
      {stale ? (
        <div className="resolution-card">
          <p>
            The document has changed. Refresh this finding before making another
            correction.
          </p>
          <button className="button primary full" onClick={onRecheck}>
            <RotateCcw size={16} />
            Check updated document
          </button>
        </div>
      ) : showFix ? (
        <section className="resolution-card" aria-label="Suggested correction">
          {correction ? (
            <>
              <div className="number-comparison">
                <div>
                  <span>Your draft</span>
                  <strong className="old-number">{correction.from}</strong>
                  <small>{correction.unit}</small>
                </div>
                <ArrowRight size={19} />
                <div>
                  <span>Source</span>
                  <strong className="correct-number">{correction.to}</strong>
                  <small>{correction.unit}</small>
                </div>
              </div>
              <button
                className="button primary full fix-action"
                disabled={applied}
                onClick={onApply}
              >
                <Check size={17} />
                Correct to {correction.to}
              </button>
              <p className="action-hint">
                Only this number changes. You can undo it.
              </p>
              <details className="correction-preview">
                <summary>Preview corrected sentence</summary>
                <p>
                  <Highlight text={finding.fix!} value={correction.to} />
                </p>
              </details>
            </>
          ) : (
            <>
              <span className="resolution-label">Suggested correction</span>
              <p className="replacement-sentence">{finding.fix}</p>
              <button
                className="button primary full fix-action"
                disabled={applied}
                onClick={onApply}
              >
                <Check size={17} />
                Apply suggested wording
              </button>
              <p className="action-hint">
                Replaces this sentence with a source quotation. You can undo it.
              </p>
            </>
          )}
        </section>
      ) : finding.status === "supported" ? (
        <button
          className="button secondary full supported-next"
          onClick={position < total ? onNext : onBack}
        >
          {position < total ? "Next finding" : "Back to all findings"}
          <ArrowRight size={15} />
        </button>
      ) : (
        <section
          className="resolution-card manual-resolution"
          aria-label="How to fix this"
        >
          <span className="resolution-label">How to fix this</span>
          <p>{nextSteps[finding.status]}</p>
          <button
            className="button primary full"
            onClick={needsSource ? onAddSource : onEdit}
          >
            {needsSource ? <Plus size={16} /> : <PencilLine size={16} />}{" "}
            {needsSource
              ? finding.status === "source_unavailable"
                ? "Add the cited source"
                : "Add a supporting source"
              : "Edit this sentence"}
          </button>
          {needsSource && (
            <button className="manual-edit-link" onClick={onEdit}>
              <PencilLine size={13} />
              Edit this sentence instead
            </button>
          )}
        </section>
      )}
      {source && (
        <section
          className="focused-evidence"
          aria-label="Evidence for this finding"
        >
          <div className="focused-evidence-heading">
            <BookOpen size={15} />
            <h5>
              {finding.status === "supported"
                ? "Supporting evidence"
                : correction
                  ? "Why this was flagged"
                  : "Source evidence"}
            </h5>
          </div>
          {finding.status === "supported" && (
            <span className="sr-only">Supporting evidence</span>
          )}
          {excerpt ? (
            <blockquote>
              <Highlight text={excerpt} value={correction?.to} />
            </blockquote>
          ) : (
            <p className="no-passage">
              {finding.evidence
                ? "Read the source passage in context before revising."
                : "No supporting passage was identified in this check. Review the paper before drawing a conclusion."}
            </p>
          )}
          {fullPassage && (
            <details className="full-evidence">
              <summary>Read the full passage</summary>
              <blockquote>{finding.evidence}</blockquote>
            </details>
          )}
          <div className="compact-source">
            <span>
              {source.authors[0] || "Unknown author"}
              {source.authors.length > 1 ? " et al." : ""}, {source.year}
            </span>
            <span className="source-access">{accessLabels[source.access]}</span>
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer">
                Open paper
                <ArrowUpRight size={13} />
              </a>
            )}
          </div>
        </section>
      )}
      <details className="finding-context">
        <summary>Original claim</summary>
        <p>{finding.text}</p>
      </details>
      {finding.checkedPassages && (
        <details className="checked-passages finding-context">
          <summary>
            Source details &amp; {finding.checkedPassages.length} checked
            passages
          </summary>
          {source && (
            <>
              <p className="source-detail-title">{source.title}</p>
              <small>
                {source.provider} · {accessLabels[source.access]}
              </small>
            </>
          )}
          {finding.checkedPassages.map((passage, i) => (
            <p key={i}>{passage}</p>
          ))}
          <small>
            {finding.model} ·{" "}
            {finding.confidence !== undefined
              ? Math.round(finding.confidence * 100) + "% model confidence. "
              : ""}
            Confidence is a model estimate, not a guarantee.
          </small>
        </details>
      )}
      <div className="detail-actions">
        <button className="text-button" onClick={onIgnore}>
          {ignored ? "Restore finding" : "Ignore finding"}
        </button>
        <div>
          <button
            className="icon-button"
            aria-label="Previous finding"
            disabled={position === 1}
            onClick={onPrevious}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next finding"
            disabled={position === total}
            onClick={onNext}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="judgment-note">
        <ShieldCheck size={14} />
        <span>
          {finding.method === "Jev"
            ? "Based on the checked passages."
            : "This claim has not been verified."}
          {source?.access === "abstract"
            ? " Only the abstract was available."
            : source?.access === "uploaded"
              ? " Uploaded text has not been independently authenticated."
              : ""}
        </span>
      </div>
    </div>
  );
}
