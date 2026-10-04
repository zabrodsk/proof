import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Search,
  X,
} from "lucide-react";
import { referenceHtml, type CitationPlan } from "../shared/citation-plan";
import {
  bibliographyIssueEntryIndex,
  occurrenceNeedsReview,
  occurrenceEvidenceUnchecked,
} from "./studio-citation-review";
import "./studio-citation-inventory.css";

export type CitationInventoryTab = "sources" | "in-text" | "works-cited";
export type CitationInventorySelection = {
  kind: "occurrence" | "entry";
  id: string;
};
export interface StudioCitationInventoryProps {
  plan?: CitationPlan;
  content: string;
  stale: boolean;
  busy: boolean;
  tab: CitationInventoryTab;
  onTab: (tab: CitationInventoryTab) => void;
  selection?: CitationInventorySelection;
  onSelection: (selection: CitationInventorySelection | undefined) => void;
  sourceLibrary: ReactNode;
  importControls: ReactNode;
  sourceCount: number;
  sourceTitle: (id: string) => string | undefined;
  onLocate: (start: number, end: number) => void;
  onOpenSource: (id: string) => void;
  onBackToReview: () => void;
  onSaveEntry: (index: number, text: string) => Promise<void>;
}

type Occurrence = NonNullable<CitationPlan["audit"]>["occurrences"][number];
type Entry = CitationPlan["bibliography"]["entries"][number];
const tabs: CitationInventoryTab[] = ["sources", "in-text", "works-cited"];
const sourceLabels = {
  matched: "Source matched",
  ambiguous: "Source ambiguous",
  unmatched: "Source not matched",
};
const supportLabels = {
  supported: "Evidence supports claim",
  partial: "Evidence partly supports claim",
  overstated: "Claim overstates evidence",
  contradicted: "Evidence contradicts claim",
  mixed: "Mixed evidence",
  not_verified: "Evidence not verified",
};
const issueLabels: Record<string, string> = {
  source_access: "Source text unavailable",
  identity: "Check source identity",
  metadata: "Metadata incomplete",
  ambiguous: "Source ambiguous",
  unmatched: "Source not matched",
  format: "Check formatting",
  unused: "Not cited",
  duplicate: "Duplicate entry",
  missing: "Entry missing",
  unnecessary_citation: "Citation may be unnecessary",
};
function evidenceLabel(occurrence: Occurrence) {
  if (occurrence.items?.length)
    return [
      ...new Set(occurrence.items.map((item) => supportLabels[item.support])),
    ].join(" · ");
  if (occurrence.citation === "correct")
    return "Citation matches checked evidence";
  if (occurrence.citation === "wrong_source")
    return "Citation points to wrong source";
  if (occurrence.citation === "not_required") return "No citation needed";
  return "Evidence not checked";
}
function locatorLabel(occurrence: Occurrence) {
  if (
    occurrence.citation === "wrong_locator" ||
    occurrence.items?.some((item) => item.citation === "wrong_locator")
  )
    return "Check locator";
  if (!occurrence.locator) return "No locator recorded";
  if (occurrence.citation === "correct")
    return "Locator matches checked evidence";
  return "Locator not confirmed";
}
function validSpan(
  content: string,
  start?: number,
  end?: number,
  original?: string,
) {
  return (
    start !== undefined &&
    end !== undefined &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= content.length &&
    content.slice(start, end) === original
  );
}
function entryIdentity(original: string, index: number) {
  const text = original.trim();
  if (!text) return `Entry ${index + 1}`;
  // Keep the writer's text; author, year, and title boundaries are not inferred.
  const sentence = new Intl.Segmenter("en", { granularity: "sentence" })
    .segment(text)
    [Symbol.iterator]()
    .next().value;
  return sentence?.segment.trim() || text;
}
function contextText(content: string, occurrence: Occurrence) {
  if (!validSpan(content, occurrence.start, occurrence.end, occurrence.text))
    return undefined;
  const paragraphStart = content.lastIndexOf("\n", occurrence.start - 1) + 1;
  const paragraphEnd = content.indexOf("\n", occurrence.end);
  const start = Math.max(paragraphStart, occurrence.start - 100);
  const end = Math.min(
    paragraphEnd < 0 ? content.length : paragraphEnd,
    occurrence.end + 100,
  );
  return `${start > paragraphStart ? "…" : ""}${content.slice(start, end)}${end < (paragraphEnd < 0 ? content.length : paragraphEnd) ? "…" : ""}`;
}

export default function StudioCitationInventory(
  props: StudioCitationInventoryProps,
) {
  const {
    plan,
    content,
    stale,
    busy,
    tab,
    onTab,
    selection,
    onSelection,
    sourceLibrary,
    importControls,
    sourceCount,
    sourceTitle,
    onLocate,
    onOpenSource,
    onBackToReview,
    onSaveEntry,
  } = props;
  const id = useId();
  const [entryQuery, setEntryQuery] = useState("");
  const [occurrenceQuery, setOccurrenceQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState("all");
  const [occurrenceFilter, setOccurrenceFilter] = useState("all");
  const [copyStatus, setCopyStatus] = useState("");
  const pane = useRef<HTMLElement>(null);
  const lastRow = useRef<HTMLButtonElement | null>(null);
  const occurrences = plan?.audit?.occurrences || [];
  const entryRows = useMemo(
    () =>
      (plan?.bibliography.entries || []).map((entry, index) => {
        const reference = plan?.references.find(
          (item) => item.id === entry.referenceId,
        );
        const issues = (plan?.audit?.bibliographyIssues || []).filter(
          (issue, issueIndex) =>
            plan?.bibliography.entries.some(
              (entry) => entry.original.trim() === issue.text.trim(),
            )
              ? bibliographyIssueEntryIndex(plan, issueIndex) === index
              : Boolean(
                  reference &&
                  (issue.referenceIds.includes(reference.id) ||
                    issue.referenceIds.includes(reference.assetId)),
                ),
        );
        const linked = reference
          ? occurrences.filter((item) =>
              item.sourceIds.includes(reference.assetId),
            )
          : [];
        return {
          entry,
          index,
          reference,
          issues,
          linked,
          identity: entryIdentity(entry.original, index),
        };
      }),
    [plan],
  );
  const selectedEntry =
    selection?.kind === "entry" && tab === "works-cited"
      ? entryRows.find((row) => `entry:${row.index}` === selection.id)
      : undefined;
  const selectedOccurrence =
    selection?.kind === "occurrence" && tab === "in-text"
      ? occurrences.find((item) => item.id === selection.id)
      : undefined;
  const showPane = Boolean(selectedEntry || selectedOccurrence);
  useEffect(() => {
    setCopyStatus("");
    if (showPane) pane.current?.focus();
  }, [selection?.id, selection?.kind, tab, showPane]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Citation copied.");
    } catch {
      setCopyStatus("Could not copy. Select and copy the citation text.");
    }
  };
  const close = () => {
    onSelection(undefined);
    requestAnimationFrame(() => lastRow.current?.focus());
  };
  const select = (
    value: CitationInventorySelection,
    button: HTMLButtonElement,
  ) => {
    lastRow.current = button;
    onSelection(value);
  };
  const filteredEntries = entryRows.filter((row) => {
    const query = entryQuery.trim().toLocaleLowerCase();
    return (
      (!query ||
        `${row.entry.original} ${row.reference ? sourceTitle(row.reference.assetId) || "" : ""} ${row.issues.map((issue) => issue.detail).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (entryFilter === "all" ||
        (entryFilter === "issues" && row.issues.length > 0) ||
        (entryFilter === "used" && row.linked.length > 0) ||
        (entryFilter === "unused" &&
          row.reference &&
          plan?.audit &&
          row.linked.length === 0))
    );
  });
  const filteredOccurrences = occurrences.filter((item) => {
    const query = occurrenceQuery.trim().toLocaleLowerCase();
    return (
      (!query ||
        `${item.text} ${item.locator || ""} ${item.sourceIds.map((source) => sourceTitle(source) || "").join(" ")} ${evidenceLabel(item)}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (occurrenceFilter === "all" ||
        occurrenceFilter === item.status ||
        (occurrenceFilter === "issues" && occurrenceNeedsReview(item)) ||
        (occurrenceFilter === "not-checked" &&
          occurrenceEvidenceUnchecked(item)) ||
        (occurrenceFilter === "locator" &&
          locatorLabel(item) === "Check locator"))
    );
  });
  const unmatchedIssues = (plan?.audit?.bibliographyIssues || []).filter(
    (issue) => !entryRows.some((row) => row.issues.includes(issue)),
  );
  const counts = {
    sources: sourceCount,
    "in-text": plan?.audit ? occurrences.length : undefined,
    "works-cited": plan ? entryRows.length : undefined,
  };
  const labels = {
    sources: "Sources",
    "in-text": "In-text citations",
    "works-cited": "Works Cited",
  };
  const importDisclosure = (
    <details className="ps-inventory-import">
      <summary>Import references</summary>
      <div>{importControls}</div>
    </details>
  );

  return (
    <section
      className="ps-citation-inventory"
      aria-label="Sources and citations inventory"
    >
      <div
        className="ps-inventory-tabs"
        role="tablist"
        aria-label="Sources and citations"
      >
        {tabs.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${id}-${value}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTab(value)}
            onKeyDown={(event) => {
              const current = tabs.indexOf(value);
              const target =
                event.key === "ArrowRight"
                  ? (current + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (current + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (target < 0) return;
              event.preventDefault();
              onTab(tabs[target]);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                [target]?.focus();
            }}
          >
            {labels[value]}
            {counts[value] !== undefined && <span>{counts[value]}</span>}
          </button>
        ))}
      </div>
      {stale && plan && (
        <p className="ps-inventory-notice" role="status">
          <CircleAlert size={16} />
          Results belong to the previous checked version. Run a new check to
          locate citations or save entries.
        </p>
      )}
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        tabIndex={0}
      >
        {tab === "sources" ? (
          <div className="ps-inventory-source-library">{sourceLibrary}</div>
        ) : (
          <>
            <div
              className={`ps-inventory-layout${showPane ? " has-selection" : ""}`}
            >
              <div className="ps-inventory-master">
                <div className="ps-inventory-return">
                  <button
                    type="button"
                    className="ps-inventory-link"
                    onClick={onBackToReview}
                  >
                    <ArrowLeft size={16} />
                    Back to review
                  </button>
                  {plan && <span>From citation review</span>}
                </div>
                {!plan || (tab === "in-text" && !plan.audit) ? (
                  <div className="ps-inventory-empty">
                    <h3>
                      No checked{" "}
                      {tab === "works-cited"
                        ? "bibliography"
                        : "citation inventory"}{" "}
                      yet
                    </h3>
                    <p>
                      Run a citation check to inspect the citations and entries
                      in your draft.
                    </p>
                    {importDisclosure}
                    {!plan && (
                      <div className="ps-inventory-source-library">
                        {sourceLibrary}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="ps-inventory-tools">
                      <label className="ps-inventory-search">
                        <Search size={18} />
                        <span className="ps-inventory-sr-only">
                          {tab === "works-cited"
                            ? "Search entries"
                            : "Search in-text citations"}
                        </span>
                        <input
                          type="search"
                          value={
                            tab === "works-cited" ? entryQuery : occurrenceQuery
                          }
                          placeholder={
                            tab === "works-cited"
                              ? "Search entries…"
                              : "Search citations…"
                          }
                          onChange={(event) =>
                            tab === "works-cited"
                              ? setEntryQuery(event.target.value)
                              : setOccurrenceQuery(event.target.value)
                          }
                        />
                      </label>
                      <label className="ps-inventory-filter">
                        <span className="ps-inventory-sr-only">
                          Filter {labels[tab]}
                        </span>
                        <select
                          value={
                            tab === "works-cited"
                              ? entryFilter
                              : occurrenceFilter
                          }
                          onChange={(event) =>
                            tab === "works-cited"
                              ? setEntryFilter(event.target.value)
                              : setOccurrenceFilter(event.target.value)
                          }
                        >
                          <option value="all">
                            {tab === "works-cited"
                              ? "All entries"
                              : "All citations"}
                          </option>
                          <option value="issues">Needs review</option>
                          {tab === "works-cited" ? (
                            <>
                              <option value="used">Used in draft</option>
                              <option value="unused">Not cited</option>
                            </>
                          ) : (
                            <>
                              <option value="matched">Source matched</option>
                              <option value="ambiguous">
                                Source ambiguous
                              </option>
                              <option value="unmatched">
                                Source not matched
                              </option>
                              <option value="not-checked">
                                Evidence not checked
                              </option>
                              <option value="locator">Check locator</option>
                            </>
                          )}
                        </select>
                      </label>
                    </div>
                    {tab === "works-cited" ? (
                      <>
                        {importDisclosure}
                        <div
                          className="ps-inventory-column-head ps-inventory-entry-grid"
                          aria-hidden="true"
                        >
                          <span>Reference</span>
                          <span>Used in draft</span>
                          <span>Review</span>
                        </div>
                        <ul className="ps-inventory-list">
                          {filteredEntries.map((row) => (
                            <li key={row.index}>
                              <button
                                type="button"
                                className={`ps-inventory-row ps-inventory-entry-grid${selectedEntry?.index === row.index ? " is-selected" : ""}`}
                                aria-expanded={
                                  selectedEntry?.index === row.index
                                }
                                aria-controls={`${id}-detail`}
                                onClick={(event) =>
                                  select(
                                    { kind: "entry", id: `entry:${row.index}` },
                                    event.currentTarget,
                                  )
                                }
                              >
                                <span className="ps-inventory-row-identity">
                                  <strong>{row.identity}</strong>
                                  {row.reference &&
                                    sourceTitle(row.reference.assetId) && (
                                      <span>
                                        {sourceTitle(row.reference.assetId)}
                                      </span>
                                    )}
                                </span>
                                <span className="ps-inventory-usage">
                                  <span className="ps-inventory-mobile-label">
                                    Used in draft
                                  </span>
                                  {!plan.audit || !row.reference
                                    ? "Usage not confirmed"
                                    : `${row.linked.length} citation${row.linked.length === 1 ? "" : "s"}`}
                                </span>
                                <span
                                  className={`ps-inventory-review${row.issues.length ? " needs-attention" : ""}`}
                                >
                                  {row.issues.length ? (
                                    <>
                                      <CircleAlert size={15} />
                                      {issueLabels[row.issues[0].kind] ||
                                        "Needs review"}
                                      {row.issues.length > 1 &&
                                        ` +${row.issues.length - 1}`}
                                    </>
                                  ) : !plan.audit ? (
                                    "Not audited"
                                  ) : (
                                    <>
                                      <Check size={15} />
                                      No issue found
                                    </>
                                  )}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {!filteredEntries.length && (
                          <p className="ps-inventory-empty">
                            {entryRows.length
                              ? "No entries match these filters."
                              : "No Works Cited entries were found in the checked draft."}
                          </p>
                        )}
                        <p className="ps-inventory-total">
                          {entryRows.length}{" "}
                          {entryRows.length === 1 ? "entry" : "entries"}
                          {plan.audit &&
                            ` · ${occurrences.length} in-text citations`}
                        </p>
                        {!!unmatchedIssues.length && (
                          <details className="ps-inventory-other-issues">
                            <summary>
                              Other bibliography issues ·{" "}
                              {unmatchedIssues.length}
                            </summary>
                            <ul>
                              {unmatchedIssues.map((issue, index) => (
                                <li key={index}>
                                  <strong>{issue.text}</strong>
                                  <p>{issue.detail}</p>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="ps-inventory-caption">
                          Source identity, evidence support, and locator checks
                          are separate assessments.
                        </p>
                        <div
                          className="ps-inventory-column-head ps-inventory-citation-grid"
                          aria-hidden="true"
                        >
                          <span>Citation</span>
                          <span>Source match</span>
                          <span>Evidence</span>
                          <span>Locator</span>
                        </div>
                        <ul className="ps-inventory-list">
                          {filteredOccurrences.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={`ps-inventory-row ps-inventory-citation-grid${selectedOccurrence?.id === item.id ? " is-selected" : ""}`}
                                aria-expanded={
                                  selectedOccurrence?.id === item.id
                                }
                                aria-controls={`${id}-detail`}
                                onClick={(event) =>
                                  select(
                                    { kind: "occurrence", id: item.id },
                                    event.currentTarget,
                                  )
                                }
                              >
                                <span className="ps-inventory-row-identity">
                                  <strong>{item.text}</strong>
                                </span>
                                <span>
                                  <span className="ps-inventory-mobile-label">
                                    Source match
                                  </span>
                                  {sourceLabels[item.status]}
                                </span>
                                <span>
                                  <span className="ps-inventory-mobile-label">
                                    Evidence
                                  </span>
                                  {evidenceLabel(item)}
                                </span>
                                <span>
                                  <span className="ps-inventory-mobile-label">
                                    Locator
                                  </span>
                                  {item.locator && (
                                    <span className="ps-inventory-locator">
                                      {item.locator}
                                    </span>
                                  )}
                                  {locatorLabel(item)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {!filteredOccurrences.length && (
                          <p className="ps-inventory-empty">
                            {occurrences.length
                              ? "No citations match these filters."
                              : "No in-text citations were found in the checked draft."}
                          </p>
                        )}
                        <p className="ps-inventory-total">
                          {occurrences.length} in-text citation
                          {occurrences.length === 1 ? "" : "s"}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
              {showPane && (
                <aside
                  className="ps-inventory-detail"
                  id={`${id}-detail`}
                  ref={pane}
                  tabIndex={-1}
                  aria-label={
                    selectedEntry
                      ? "Selected bibliography entry"
                      : "Selected in-text citation"
                  }
                >
                  <div className="ps-inventory-detail-heading">
                    <button
                      type="button"
                      className="ps-inventory-link ps-inventory-mobile-back"
                      onClick={close}
                    >
                      <ArrowLeft size={16} />
                      Back to list
                    </button>
                    <span>
                      {selectedEntry ? "Selected entry" : "Selected citation"}
                    </span>
                    <button
                      type="button"
                      className="ps-inventory-close"
                      aria-label="Close citation detail"
                      onClick={close}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  {selectedEntry ? (
                    <>
                      <p className="ps-inventory-eyebrow">Original entry</p>
                      <p className="ps-inventory-original">
                        {selectedEntry.entry.original}
                      </p>
                      {selectedEntry.reference &&
                      selectedEntry.reference.text.trim() !==
                        selectedEntry.entry.original.trim() ? (
                        <>
                          <p className="ps-inventory-eyebrow">
                            Formatted entry ·{" "}
                            {plan?.profile === "mla9" ? "MLA 9" : "Classroom"}
                          </p>
                          {selectedEntry.reference.html ? (
                            <div
                              className="ps-inventory-formatted"
                              dangerouslySetInnerHTML={{
                                __html: referenceHtml(
                                  selectedEntry.reference.html,
                                ),
                              }}
                            />
                          ) : (
                            <div className="ps-inventory-formatted">
                              {selectedEntry.reference.text}
                            </div>
                          )}
                        </>
                      ) : !selectedEntry.reference ? (
                        <p className="ps-inventory-caption">
                          Match a source to preview a formatted entry.
                        </p>
                      ) : null}
                      <div className="ps-inventory-detail-actions">
                        <button
                          type="button"
                          className="ps-inventory-link"
                          disabled={
                            stale ||
                            !validSpan(
                              content,
                              selectedEntry.entry.start,
                              selectedEntry.entry.end,
                              selectedEntry.entry.original,
                            )
                          }
                          onClick={() =>
                            onLocate(
                              selectedEntry.entry.start!,
                              selectedEntry.entry.end!,
                            )
                          }
                        >
                          <Search size={15} />
                          Locate in draft
                        </button>
                        {selectedEntry.reference && (
                          <button
                            type="button"
                            className="ps-inventory-link"
                            onClick={() =>
                              onOpenSource(selectedEntry.reference!.assetId)
                            }
                          >
                            Open source
                            <ArrowRight size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="ps-inventory-link"
                          onClick={() =>
                            void copy(
                              selectedEntry.reference?.text ||
                                selectedEntry.entry.original,
                            )
                          }
                        >
                          <Copy size={14} />
                          Copy citation
                        </button>
                      </div>
                      <EntryFix
                        key={`${plan?.id}:${selectedEntry.index}:${selectedEntry.entry.original}`}
                        entry={selectedEntry.entry}
                        replacement={selectedEntry.reference?.text}
                        index={selectedEntry.index}
                        blocked={
                          stale ||
                          busy ||
                          !validSpan(
                            content,
                            selectedEntry.entry.start,
                            selectedEntry.entry.end,
                            selectedEntry.entry.original,
                          )
                        }
                        spanAvailable={validSpan(
                          content,
                          selectedEntry.entry.start,
                          selectedEntry.entry.end,
                          selectedEntry.entry.original,
                        )}
                        onSave={onSaveEntry}
                      />
                    </>
                  ) : (
                    selectedOccurrence && (
                      <>
                        <h3>{selectedOccurrence.text}</h3>
                        <dl className="ps-inventory-assessments">
                          <dt>Source match</dt>
                          <dd>{sourceLabels[selectedOccurrence.status]}</dd>
                          <dt>Evidence</dt>
                          <dd>{evidenceLabel(selectedOccurrence)}</dd>
                          <dt>Locator</dt>
                          <dd>
                            {selectedOccurrence.locator &&
                              `${selectedOccurrence.locator} · `}
                            {locatorLabel(selectedOccurrence)}
                          </dd>
                        </dl>
                        {!stale && contextText(content, selectedOccurrence) && (
                          <blockquote className="ps-inventory-context">
                            {contextText(content, selectedOccurrence)}
                          </blockquote>
                        )}
                        <button
                          type="button"
                          className="ps-inventory-link"
                          disabled={
                            stale ||
                            busy ||
                            !validSpan(
                              content,
                              selectedOccurrence.start,
                              selectedOccurrence.end,
                              selectedOccurrence.text,
                            )
                          }
                          onClick={() =>
                            onLocate(
                              selectedOccurrence.start,
                              selectedOccurrence.end,
                            )
                          }
                        >
                          Locate in draft
                          <ArrowRight size={15} />
                        </button>
                        <div className="ps-inventory-related">
                          <h4>
                            {selectedOccurrence.status === "ambiguous"
                              ? "Possible sources"
                              : "Linked sources"}
                          </h4>
                          {selectedOccurrence.sourceIds.length ? (
                            <ul className="ps-inventory-occurrence-links">
                              {[...new Set(selectedOccurrence.sourceIds)].map(
                                (source) => (
                                  <li key={source}>
                                    <button
                                      type="button"
                                      className="ps-inventory-link"
                                      onClick={() => onOpenSource(source)}
                                    >
                                      {sourceTitle(source) || "Open source"}
                                      <ArrowRight size={14} />
                                    </button>
                                  </li>
                                ),
                              )}
                            </ul>
                          ) : (
                            <p className="ps-inventory-caption">
                              No source was matched to this citation.
                            </p>
                          )}
                        </div>
                        {Boolean(selectedOccurrence.items?.length) && (
                          <details className="ps-inventory-other-issues">
                            <summary>Individual citation checks</summary>
                            <ul>
                              {selectedOccurrence.items?.map((item, index) => (
                                <li key={index}>
                                  <strong>{item.text}</strong>
                                  <p>
                                    {sourceLabels[item.status]} ·{" "}
                                    {supportLabels[item.support]}
                                  </p>
                                  <p>
                                    {item.locator
                                      ? `Locator: ${item.locator}. `
                                      : "No locator recorded. "}
                                    {item.citation === "wrong_locator"
                                      ? "Check locator."
                                      : item.citation === "correct"
                                        ? "Citation matches checked evidence."
                                        : "Citation assessment: " +
                                          item.citation.replaceAll("_", " ") +
                                          "."}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    )
                  )}
                  {copyStatus && (
                    <p className="ps-inventory-caption" role="status">
                      {copyStatus}
                    </p>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EntryFix({
  entry,
  replacement,
  index,
  blocked,
  spanAvailable,
  onSave,
}: {
  entry: Entry;
  replacement?: string;
  index: number;
  blocked: boolean;
  spanAvailable: boolean;
  onSave: StudioCitationInventoryProps["onSaveEntry"];
}) {
  const text = replacement || entry.original;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [lastSavedText, setLastSavedText] = useState(entry.original);
  if (text.trim() === entry.original.trim()) return null;
  return (
    <form
      className="ps-inventory-entry-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked || saving || !text.trim() || text === lastSavedText) return;
        setSaving(true);
        setError("");
        setSaved("");
        void onSave(index, text)
          .then(() => {
            setLastSavedText(text);
            setSaved("Entry fixed. Run a new check to refresh these results.");
          })
          .catch((reason: unknown) =>
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not save this entry. Try again.",
            ),
          )
          .finally(() => setSaving(false));
      }}
    >
      {!spanAvailable && (
        <p className="ps-inventory-caption">
          This entry's location could not be confirmed in the current draft. Run
          a new check before saving.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
      <button
        type="submit"
        className="ps-inventory-save"
        disabled={blocked || saving || !text.trim() || text === lastSavedText}
      >
        {saving ? "Fixing…" : saved ? "Entry fixed" : "Fix entry"}
      </button>
    </form>
  );
}
