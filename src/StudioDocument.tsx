import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  CheckCheck,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { BackendFinding, RunInput } from "../shared/backend";
import {
  documentHighlights,
  findingAssessment,
  findingDetail,
  findingTone,
  citationExempt,
} from "./studio-document";
import { citationLabel, runStageLabel } from "./studio-status";
import "./studio-review.css";

export type CheckMode = RunInput["mode"];

export const checkModes = [
  {
    value: "source_check",
    label: "Check citations",
    description:
      "Check evidence, in-text citations, and references against your sources.",
    icon: BookOpen,
  },
  {
    value: "discover",
    label: "Generate citations",
    description:
      "Find evidence and review citations before adding them to your draft.",
    icon: Search,
  },
  {
    value: "fact_check",
    label: "Fact-check",
    description:
      "Check your selected claims using the search scope you choose.",
    icon: ShieldCheck,
  },
] as const;

type Filter = "review" | "supported" | "all";
type SaveState = "saved" | "unsaved" | "saving" | "error";

const reducedMotion = () =>
  document.documentElement.dataset.proofMotion === "reduced" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const wordCount = (text: string) =>
  text.trim().split(/\s+/).filter(Boolean).length;

const dismissKey = (finding: BackendFinding) =>
  `${finding.claim.text}\u0000${finding.fix?.original ?? ""}`;

export default function StudioDocument({
  content,
  findings,
  run,
  stale,
  active,
  locked,
  mode,
  onMode,
  setup,
  canCheck,
  sourceTitle,
  sourcePagination,
  researchResults = [],
  resultSettings,
  citationReview,
  citationFocus,
  documentActions,
  onEditorReady,
  onSave,
  onAccept,
  onAcceptAll,
  onCancel,
}: {
  content: string;
  findings: BackendFinding[];
  run?: {
    id: string;
    status: string;
    stage: string;
    error?: string;
    carried?: boolean;
    coverage?: Record<string, unknown>;
    usage?: { provider: string; status: string; requests: number }[];
  };
  stale: boolean;
  active: boolean;
  locked: boolean;
  mode: CheckMode;
  onMode: (mode: CheckMode) => void;
  setup: ReactNode;
  canCheck: boolean;
  sourceTitle: (assetId: string) => string | undefined;
  sourcePagination?: (assetId: string) => string | undefined;
  researchResults?: {
    candidates: {
      title: string;
      url: string;
      doi?: string;
      access?: string;
      eligibility: string;
      reason?: string;
      assetId?: string;
    }[];
    notices?: string[];
  }[];
  resultSettings?: string;
  citationReview?: ReactNode;
  citationFocus?: { start: number; end: number; token: number };
  documentActions?: ReactNode;
  onEditorReady?: (ready: boolean) => void;
  onSave: (text: string) => Promise<void>;
  onAccept: (finding: BackendFinding) => Promise<void>;
  onAcceptAll: (findings: BackendFinding[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(content);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState<Filter>("review");
  const [setupOpen, setSetupOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [accepting, setAccepting] = useState<string>();
  const saved = useRef(content);
  const latest = useRef(draft);
  const saving = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  latest.current = draft;

  useEffect(() => {
    const previous = saved.current;
    setDraft((current) => (current === previous ? content : current));
    saved.current = content;
  }, [content]);
  useEffect(() => setSetupOpen(false), [run?.id, mode]);
  useEffect(() => setSelected(undefined), [run?.id]);
  useEffect(() => {
    if (
      !citationFocus ||
      stale ||
      !input.current ||
      citationFocus.start < 0 ||
      citationFocus.end < citationFocus.start ||
      citationFocus.end > latest.current.length
    )
      return;
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(citationFocus.start, citationFocus.end);
    input.current.scrollIntoView({
      block: "center",
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  }, [citationFocus, stale]);

  const dirty = draft !== saved.current;
  const readOnly = active || locked;
  useEffect(() => {
    onEditorReady?.(!dirty && saveState === "saved");
  }, [dirty, saveState, onEditorReady]);

  async function save() {
    if (saving.current || latest.current === saved.current) return;
    saving.current = true;
    const text = latest.current;
    setSaveState("saving");
    try {
      await onSave(text);
      saved.current = text;
      const pending = latest.current !== text;
      setSaveState(pending ? "unsaved" : "saved");
      // Wait for the parent to render the new version before saving again.
      if (pending) setTimeout(() => void saveRef.current(), 400);
    } catch {
      setSaveState("error");
    } finally {
      saving.current = false;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty) return;
    setSaveState((state) => (state === "saving" ? state : "unsaved"));
    const timer = setTimeout(() => void saveRef.current(), 1200);
    return () => clearTimeout(timer);
  }, [draft]);

  const visible = findings.filter(
    (finding) => showDismissed || !dismissed.has(dismissKey(finding)),
  );
  const highlights = useMemo(
    () =>
      documentHighlights(
        draft,
        visible.filter((finding) => !citationExempt(finding, mode)),
        stale,
      ),
    [draft, visible, stale, mode],
  );
  const counts = {
    review: visible.filter(
      (f) => findingTone(f) !== "supported" && !citationExempt(f, mode),
    ).length,
    supported: visible.filter((f) => findingTone(f) === "supported").length,
    citationExempt: visible.filter((f) => citationExempt(f, mode)).length,
  };
  const listed = visible.filter((finding) =>
    filter === "all"
      ? true
      : filter === "supported"
        ? findingTone(finding) === "supported"
        : findingTone(finding) !== "supported" &&
          !citationExempt(finding, mode),
  );
  const acceptable = visible.filter(
    (finding) => finding.fix && !dismissed.has(dismissKey(finding)),
  );
  const acceptBlocked = stale || dirty || active || locked || !!accepting;
  const hiddenCount = findings.filter((f) =>
    dismissed.has(dismissKey(f)),
  ).length;

  const fragments: ReactNode[] = [];
  let cursor = 0;
  for (const finding of highlights) {
    fragments.push(draft.slice(cursor, finding.claim.start));
    fragments.push(
      <mark
        key={finding.id}
        id={`ps-mark-${finding.id}`}
        className={`ps-mark ${findingTone(finding)} ${selected === finding.id ? "is-selected" : ""}`}
      >
        {finding.claim.text}
      </mark>,
    );
    cursor = finding.claim.end;
  }
  fragments.push(draft.slice(cursor));

  function selectAtCaret() {
    const area = input.current;
    if (!area || area.selectionStart !== area.selectionEnd) return;
    const hit = highlights.find(
      ({ claim }) =>
        area.selectionStart >= claim.start && area.selectionStart <= claim.end,
    );
    if (!hit) return;
    setSelected(hit.id);
    if (findingTone(hit) === "supported" && filter === "review")
      setFilter("all");
    if (findingTone(hit) !== "supported" && filter === "supported")
      setFilter("all");
    requestAnimationFrame(() =>
      document.getElementById(`ps-change-${hit.id}`)?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion() ? "instant" : "smooth",
      }),
    );
  }

  function selectFinding(finding: BackendFinding) {
    const next = selected === finding.id ? undefined : finding.id;
    setSelected(next);
    if (next)
      backdrop.current
        ?.querySelector(`#ps-mark-${CSS.escape(finding.id)}`)
        ?.scrollIntoView({
          block: "center",
          behavior: reducedMotion() ? "instant" : "smooth",
        });
  }

  async function accept(finding: BackendFinding) {
    setAccepting(finding.id);
    try {
      await onAccept(finding);
    } finally {
      setAccepting(undefined);
    }
  }

  const modeInfo = checkModes.find((item) => item.value === mode)!;
  const showSetup = !run || setupOpen;

  return (
    <div className="ps-workspace">
      <section className="ps-draft" aria-label="Your text">
        <div className="ps-draft-bar">
          <span
            className={`ps-save-state is-${readOnly ? "paused" : saveState}`}
          >
            {readOnly && active ? (
              "Editing pauses while Proof checks this version"
            ) : saveState === "saving" ? (
              <>
                <LoaderCircle size={14} className="ps-spin" /> Saving
              </>
            ) : saveState === "unsaved" ? (
              "Unsaved changes"
            ) : saveState === "error" ? (
              <>
                <CircleAlert size={14} /> Not saved.{" "}
                <button onClick={() => void save()}>Retry</button>
              </>
            ) : (
              <>
                <Check size={14} /> Saved
              </>
            )}
          </span>
          <span className="ps-draft-count">
            {wordCount(draft).toLocaleString()} words
          </span>
        </div>
        <div className="ps-draft-page">
          <div className="ps-draft-surface">
            <div
              className="ps-draft-backdrop"
              ref={backdrop}
              aria-hidden="true"
            >
              {fragments}
              {"\u200b"}
            </div>
            <textarea
              ref={input}
              className="ps-draft-input"
              aria-label="Document text"
              placeholder="Paste or write your text here."
              spellCheck
              maxLength={100000}
              value={draft}
              readOnly={readOnly}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void save()}
              onClick={selectAtCaret}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow")) selectAtCaret();
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </div>
        </div>
        {documentActions}
      </section>

      <aside className="ps-review" aria-label="Proposed changes">
        <div className="ps-review-modes" role="group" aria-label="Check type">
          {checkModes.map((item) => (
            <button
              key={item.value}
              aria-pressed={mode === item.value}
              onClick={() => onMode(item.value)}
              disabled={active}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </div>
        {!showSetup && (
          <p className="ps-review-mode-note">{modeInfo.description}</p>
        )}
        {!showSetup && resultSettings && (
          <p className="ps-review-muted">{resultSettings}</p>
        )}

        {showSetup ? (
          <div className="ps-review-setup">
            {setup}
            {run && (
              <button
                className="ps-review-link"
                onClick={() => setSetupOpen(false)}
              >
                Back to results
              </button>
            )}
          </div>
        ) : (
          <>
            {active ? (
              <div className="ps-review-progress" role="status">
                <LoaderCircle size={18} className="ps-spin" />
                <div>
                  <strong>
                    {mode === "source_check"
                      ? "Checking citations"
                      : mode === "discover"
                        ? "Finding evidence for citations"
                        : "Fact-checking selected claims"}
                  </strong>
                  <span>
                    {runStageLabel(run.stage)} · results appear as each claim is
                    checked
                  </span>
                </div>
                <button className="ps-review-link" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="ps-review-summary">
                <p>
                  <strong>{counts.review}</strong> to review
                  <span aria-hidden="true"> · </span>
                  <strong>{counts.supported}</strong> supported
                  {counts.citationExempt > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <strong>{counts.citationExempt}</strong>{" "}
                      {counts.citationExempt === 1 ? "needs" : "need"} no
                      citation
                    </>
                  )}
                </p>
                <button
                  className="ps-review-link"
                  onClick={() => setSetupOpen(true)}
                  disabled={!canCheck}
                >
                  <RotateCcw size={14} /> New check
                </button>
              </div>
            )}
            {typeof run.coverage?.completedClaims === "number" && (
              <p className="ps-review-muted" role="status">
                {run.coverage.completedClaims} of{" "}
                {String(
                  run.coverage.selectedClaims ?? run.coverage.totalClaims ?? 0,
                )}{" "}
                selected claims checked.
                {Array.isArray(run.coverage.unprocessedSpans) &&
                  run.coverage.unprocessedSpans.length > 0 &&
                  ` ${run.coverage.unprocessedSpans.length} claims were left unchecked by the limit.`}
              </p>
            )}
            {run.usage && run.usage.length > 0 && (
              <details className="ps-research-details">
                <summary>
                  API usage ·{" "}
                  {run.usage.reduce((n, item) => n + item.requests, 0)} requests
                </summary>
                <ul>
                  {run.usage.map((item) => (
                    <li key={`${item.provider}:${item.status}`}>
                      {item.provider}: {item.requests} ·{" "}
                      {item.status.replaceAll("_", " ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {Array.isArray(run.coverage?.sources) &&
              run.coverage.sources.some(
                (source) =>
                  source.unreadablePages?.length || source.omittedPages?.length,
              ) && (
                <details className="ps-research-details" open>
                  <summary>Source extraction gaps</summary>
                  <ul>
                    {run.coverage.sources
                      .filter(
                        (source) =>
                          source.unreadablePages?.length ||
                          source.omittedPages?.length,
                      )
                      .map((source) => (
                        <li key={source.extractionId}>
                          {sourceTitle(source.assetId) || "Selected source"}
                          <p>
                            {source.unreadablePages?.length > 0 &&
                              `Unreadable physical pages: ${source.unreadablePages.join(", ")}. `}
                            {source.omittedPages?.length > 0 &&
                              `Omitted physical pages: ${source.omittedPages.join(", ")}.`}
                          </p>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            {researchResults.some((item) => item.candidates.length > 0) && (
              <details className="ps-research-details">
                <summary>Retrieved sources and access gaps</summary>
                <ul>
                  {Array.from(
                    new Map(
                      researchResults
                        .flatMap((item) => item.candidates)
                        .map((candidate) => [
                          candidate.doi || candidate.url,
                          candidate,
                        ]),
                    ).values(),
                  ).map((candidate) => (
                    <li key={candidate.doi || candidate.url}>
                      <a
                        href={
                          /^https:\/\//.test(candidate.url)
                            ? candidate.url
                            : undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {candidate.title}
                      </a>
                      <p>
                        {candidate.access?.replaceAll("_", " ") ||
                          "No readable text"}{" "}
                        · {candidate.eligibility}
                        <br />
                        {candidate.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {Array.isArray(run.coverage?.skippedSpans) &&
              run.coverage.skippedSpans.length > 0 && (
                <p className="ps-review-muted" role="status">
                  {run.coverage.skippedSpans.length} text segments skipped.
                  Names, dates, headings, questions, preferences, and assignment
                  instructions do not need an evidence check.
                </p>
              )}
            {stale && !active && (
              <div className="ps-review-stale" role="status">
                <CircleAlert size={16} />
                <p>
                  Your text changed where these claims were. Their results
                  belong to the earlier version.
                </p>
                <button
                  className="ps-soft"
                  onClick={() => setSetupOpen(true)}
                  disabled={!canCheck}
                >
                  Check again
                </button>
              </div>
            )}
            {run.error && (
              <p className="ps-review-error" role="alert">
                {run.error}
              </p>
            )}
            {citationReview}
            {findings.length > 0 && (
              <div className="ps-review-toolbar">
                <div
                  className="ps-review-filter"
                  role="group"
                  aria-label="Show"
                >
                  {(
                    [
                      ["review", `To review ${counts.review}`],
                      ["supported", `Supported ${counts.supported}`],
                      ["all", "All"],
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
                {acceptable.length > 1 && (
                  <button
                    className="ps-review-accept-all"
                    disabled={acceptBlocked}
                    onClick={() => {
                      setAccepting("all");
                      void onAcceptAll(acceptable).finally(() =>
                        setAccepting(undefined),
                      );
                    }}
                  >
                    {accepting === "all" ? (
                      <LoaderCircle size={15} className="ps-spin" />
                    ) : (
                      <CheckCheck size={15} />
                    )}
                    Accept all {acceptable.length}
                  </button>
                )}
              </div>
            )}
            {dirty && acceptable.length > 0 && (
              <p className="ps-review-hint" role="status">
                Saving your edits before you can accept changes.
              </p>
            )}
            <ol className="ps-changes">
              {listed.map((finding) => {
                const tone = findingTone(finding);
                const open = selected === finding.id;
                const isDismissed = dismissed.has(dismissKey(finding));
                const assessment = findingAssessment(finding, mode);
                return (
                  <li
                    key={finding.id}
                    id={`ps-change-${finding.id}`}
                    className={`ps-change ${tone} ${open ? "is-open" : ""} ${isDismissed ? "is-dismissed" : ""}`}
                  >
                    <button
                      className="ps-change-head"
                      aria-expanded={open}
                      onClick={() => selectFinding(finding)}
                    >
                      <span className={`ps-change-tag ${tone}`}>
                        {findingDetail(finding, mode)}
                      </span>
                      <span className="ps-change-claim">
                        {finding.claim.text}
                      </span>
                    </button>
                    {finding.fix && (
                      <div className="ps-change-edit">
                        <p className="ps-change-diff">
                          <del>{finding.fix.original}</del>
                          <ins>{finding.fix.replacement}</ins>
                        </p>
                        <div className="ps-change-actions">
                          <button
                            className="ps-change-accept"
                            disabled={acceptBlocked || isDismissed}
                            onClick={() => void accept(finding)}
                          >
                            {accepting === finding.id ? (
                              <LoaderCircle size={15} className="ps-spin" />
                            ) : (
                              <Check size={15} />
                            )}
                            Accept
                          </button>
                          <button
                            className="ps-change-dismiss"
                            aria-label={
                              isDismissed ? "Restore suggestion" : "Dismiss"
                            }
                            onClick={() =>
                              setDismissed((current) => {
                                const next = new Set(current);
                                if (isDismissed)
                                  next.delete(dismissKey(finding));
                                else next.add(dismissKey(finding));
                                return next;
                              })
                            }
                          >
                            {isDismissed ? (
                              <RotateCcw size={15} />
                            ) : (
                              <X size={15} />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                    {open && (
                      <div className="ps-change-detail">
                        <p>{assessment.meaning}</p>
                        <p className="ps-change-next">{assessment.next}</p>
                        {finding.evidence.length === 0 ? (
                          <p className="ps-change-muted">
                            No readable source passage is attached to this
                            finding.
                          </p>
                        ) : (
                          finding.evidence.map((passage, index) => (
                            <figure
                              className="ps-change-passage"
                              key={`${passage.id}:${index}`}
                            >
                              <blockquote>{passage.text}</blockquote>
                              <figcaption>
                                {sourceTitle(passage.assetId) ||
                                  "Source passage"}
                                {" · "}
                                {sourcePagination?.(passage.assetId) ===
                                "unavailable"
                                  ? "Retrieved text. Citation page unavailable"
                                  : passage.labelStatus === "unknown"
                                    ? `Physical page ${passage.pageIndex}. Printed page unconfirmed`
                                    : `Page ${passage.pageLabel || passage.pageIndex}`}
                                {" · "}
                                {passage.support.replaceAll("_", " ")}
                              </figcaption>
                            </figure>
                          ))
                        )}
                        <details>
                          <summary>How Proof checked this</summary>
                          <p className="ps-change-muted">
                            {citationLabel(finding.citation)}
                          </p>
                          {finding.explanation.map((text, index) => (
                            <p key={index}>{text}</p>
                          ))}
                        </details>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {!active && findings.length === 0 && !run.error && (
              <p className="ps-review-muted">
                {run.carried && !stale
                  ? "You have handled every finding from this check. Run a new check to review the edited text."
                  : run.coverage?.totalClaims === 0
                    ? "No candidate claims found. Skipped text has not been fact-checked."
                    : "No findings were returned. This does not verify the text."}
              </p>
            )}
            {findings.length > 0 && listed.length === 0 && (
              <p className="ps-review-muted">
                {filter === "review"
                  ? "Nothing left to review in this check."
                  : "No supported claims in this check."}
              </p>
            )}
            {hiddenCount > 0 && (
              <button
                className="ps-review-link ps-review-dismissed"
                onClick={() => setShowDismissed(!showDismissed)}
              >
                {showDismissed ? "Hide" : "Show"} {hiddenCount} dismissed
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
