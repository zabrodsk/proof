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
} from "./studio-document";
import { citationLabel, runStageLabel } from "./studio-status";
import "./studio-review.css";

export type CheckMode = RunInput["mode"];

export const checkModes = [
  {
    value: "source_check",
    label: "My sources",
    description: "Compare each claim with the sources you upload or cite.",
    icon: BookOpen,
  },
  {
    value: "fact_check",
    label: "Research",
    description: "Compare claims with published academic research.",
    icon: ShieldCheck,
  },
  {
    value: "discover",
    label: "Find sources",
    description: "Find academic research you could cite for each claim.",
    icon: Search,
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
  };
  stale: boolean;
  active: boolean;
  locked: boolean;
  mode: CheckMode;
  onMode: (mode: CheckMode) => void;
  setup: ReactNode;
  canCheck: boolean;
  sourceTitle: (assetId: string) => string | undefined;
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
    setDraft((current) => (current === saved.current ? content : current));
    saved.current = content;
  }, [content]);
  useEffect(() => setSetupOpen(false), [run?.id, mode]);
  useEffect(() => setSelected(undefined), [run?.id]);

  const dirty = draft !== saved.current;
  const readOnly = active || locked;

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
    () => documentHighlights(draft, visible, stale),
    [draft, visible, stale],
  );
  const counts = {
    review: visible.filter((f) => findingTone(f) !== "supported").length,
    supported: visible.filter((f) => findingTone(f) === "supported").length,
  };
  const listed = visible.filter((finding) =>
    filter === "all"
      ? true
      : filter === "supported"
        ? findingTone(finding) === "supported"
        : findingTone(finding) !== "supported",
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
        {!showSetup && <p className="ps-review-mode-note">{modeInfo.description}</p>}

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
                  <strong>Checking your text</strong>
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
                const assessment = findingAssessment(finding);
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
                        {findingDetail(finding)}
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
                                {" · "}page{" "}
                                {passage.pageLabel || passage.pageIndex}
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
