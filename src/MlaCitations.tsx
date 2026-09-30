import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  Copy,
  Link2,
  LoaderCircle,
  PencilLine,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { Source } from "../shared/types";
import {
  addMlaEntry,
  applyCitationEdit,
  bibliography,
  blankMlaSource,
  citationDois,
  formatMla,
  mlaFromSource,
  mlaAuthorKey,
  mlaWarnings,
  reviewMla,
  uniqueMlaSources,
  type MlaSource,
} from "../shared/mla";

export function CitationText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*[^*\n]+\*)/g)
        .map((part, i) =>
          part.startsWith("*") && part.endsWith("*") ? (
            <em key={i}>{part.slice(1, -1)}</em>
          ) : (
            part
          ),
        )}
    </>
  );
}
type Props = {
  text: string;
  sources: Source[];
  saved: MlaSource[];
  initialSource?: Source;
  onSource: (source: Source) => void;
  onChange: (text: string, source?: MlaSource) => void;
  onUndo: () => void;
  canUndo: boolean;
};
export default function MlaCitations({
  text,
  sources,
  saved,
  initialSource,
  onSource,
  onChange,
  onUndo,
  canUndo,
}: Props) {
  const [tab, setTab] = useState<"add" | "review">("add");
  const [source, setSource] = useState<MlaSource>(
    initialSource ? mlaFromSource(initialSource) : blankMlaSource,
  );
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [scope, setScope] = useState<"document" | "pasted">("document");
  const [pasted, setPasted] = useState("");
  const [pastedUndo, setPastedUndo] = useState<string | null>(null);
  const [locator, setLocator] = useState("");
  const [target, setTarget] = useState("");
  const [localSources, setLocalSources] = useState<MlaSource[]>([]);
  const known = uniqueMlaSources([
    ...sources.map(mlaFromSource),
    ...saved,
    ...localSources,
    ...(source.title.trim() && source.journal.trim() ? [source] : []),
  ]);
  const formatted = formatMla(
    source,
    locator,
    known.filter((s) => mlaAuthorKey(s) === mlaAuthorKey(source)).length > 1,
  );
  const warnings = mlaWarnings(source);
  const valid =
    !!source.title.trim() &&
    !!source.journal.trim() &&
    (!source.doi.trim() || citationDois(source.doi).length > 0);
  const reviewText = scope === "document" ? text : pasted;
  const issues = reviewed
    ? reviewMla(reviewText, known, scope === "pasted")
    : [];
  const body = text.slice(0, bibliography(text).heading?.start ?? text.length);
  const targets = [...body.matchAll(/[^\r\n]+/g)].filter(
    (m) => m[0].split(/\s+/).length >= 5 && !/\([^()]*\)\s*[.!?]?$/.test(m[0]),
  );
  const existingEntry =
    source.title.trim() &&
    bibliography(text).entries.find((e) =>
      citationDois(source.doi)[0]
        ? citationDois(e.text)[0] === citationDois(source.doi)[0]
        : e.text.includes(`"${source.title.replace(/[.!?]$/, "")}`),
    );
  const update = (key: keyof MlaSource, value: string) => {
    setSource((prev) => ({ ...prev, [key]: value }));
    setMessage("");
  };
  async function resolve(value: string) {
    const response = await fetch("/api/sources/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doi: value }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || "Could not retrieve source details. Enter them below.",
      );
    onSource(result);
    return result as Source;
  }
  async function lookup() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await resolve(doi);
      setSource(mlaFromSource(result));
      setMessage("Source details loaded. Check them against the paper.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    setMessage("");
    const missing = citationDois(reviewText).filter(
      (d) => !known.some((s) => citationDois(s.doi)[0] === d),
    );
    const loaded: MlaSource[] = [];
    const failed: string[] = [];
    for (const id of missing.slice(0, 20)) {
      try {
        loaded.push(mlaFromSource(await resolve(id)));
      } catch {
        failed.push(id);
      }
    }
    setLocalSources((prev) => uniqueMlaSources([...prev, ...loaded]));
    if (failed.length)
      setError(
        `Could not retrieve ${failed.length} ${failed.length === 1 ? "source" : "sources"}. Those entries need a manual check. Add the source details in Add citation.`,
      );
    if (missing.length > 20)
      setMessage(
        "The first 20 new DOIs were retrieved. Review the remaining entries manually.",
      );
    setReviewed(true);
    setBusy(false);
  }
  async function copy(value: string) {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const html = value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\*([^*]+)\*/g, "<i>$1</i>");
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([value.replace(/\*([^*]+)\*/g, "$1")], {
              type: "text/plain",
            }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else
        await navigator.clipboard.writeText(
          value.replace(/\*([^*]+)\*/g, "$1"),
        );
      setMessage("Citation copied.");
    } catch {
      setError(
        "Clipboard access is unavailable. Select the citation preview and copy it.",
      );
    }
  }
  function addEntry() {
    setError("");
    try {
      const next = addMlaEntry(text, source);
      if (next === text) {
        setMessage("This entry is already in Works Cited.");
        return;
      }
      onChange(next, source);
      setMessage(
        existingEntry
          ? "Works Cited entry updated. You can undo this change."
          : "Entry added to Works Cited. You can undo this change.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function insertInText() {
    const match = targets.find((m) => String(m.index) === target);
    if (!match) {
      setError("Choose the paragraph to cite.");
      return;
    }
    const original = match[0];
    const replacement = original.replace(
      /([.!?]?)\s*$/,
      ` ${formatted.inText}$1`,
    );
    try {
      onChange(
        applyCitationEdit(text, {
          start: match.index!,
          end: match.index! + original.length,
          original,
          replacement,
        }),
        source,
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setTarget("");
    setMessage(
      "In-text citation added. Include the source in Works Cited, too.",
    );
  }
  return (
    <div className="mla-tool">
      <div
        className="source-tabs mla-tabs"
        role="tablist"
        aria-label="MLA tools"
      >
        <button
          role="tab"
          aria-selected={tab === "add"}
          className={tab === "add" ? "active" : ""}
          disabled={busy}
          onClick={() => setTab("add")}
        >
          <Plus size={15} />
          Add citation
        </button>
        <button
          role="tab"
          aria-selected={tab === "review"}
          className={tab === "review" ? "active" : ""}
          disabled={busy}
          onClick={() => setTab("review")}
        >
          <CheckCheck size={16} />
          Review citations
        </button>
      </div>
      {error && (
        <p className="mla-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mla-message" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
      {tab === "add" ? (
        <div className="mla-add-grid">
          <div className="mla-fields">
            <h3>Start with a journal article</h3>
            <form
              className="mla-doi-form"
              onSubmit={(e) => {
                e.preventDefault();
                void lookup();
              }}
            >
              <label htmlFor="mla-doi-lookup">DOI or doi.org link</label>
              <div>
                <input
                  id="mla-doi-lookup"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                  placeholder="10.1136/bmj-2023-075847"
                  maxLength={250}
                />
                <button
                  className="button secondary"
                  disabled={busy || !doi.trim()}
                >
                  {busy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Find source
                </button>
              </div>
            </form>
            {known.length > 0 && (
              <label className="mla-field">
                Or use a source in this document
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    setSource({ ...known[Number(e.target.value)] });
                    setMessage("");
                  }}
                >
                  <option value="" disabled>
                    Choose a source
                  </option>
                  {known.map((s, i) => (
                    <option key={i} value={i}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <details className="mla-metadata" open={!source.title}>
              <summary>
                <PencilLine size={14} />
                {source.title
                  ? "Review or edit source details"
                  : "Or enter source details"}
              </summary>
              <div className="mla-field-grid">
                <label className="mla-field span-two">
                  Authors
                  <textarea
                    value={source.authors}
                    onChange={(e) => update("authors", e.target.value)}
                    placeholder={"Noetel, Michael\nSanders, Taren"}
                    rows={3}
                    maxLength={10000}
                  />
                  <small>
                    One author per line: Last name, First name. Keep
                    organizations as written.
                  </small>
                </label>
                <label className="mla-field span-two">
                  Article title
                  <input
                    value={source.title}
                    onChange={(e) => update("title", e.target.value)}
                    maxLength={1500}
                  />
                  <small>
                    Use title case for English titles. Keep names and acronyms
                    as published.
                  </small>
                </label>
                <label className="mla-field span-two">
                  Journal
                  <input
                    value={source.journal}
                    onChange={(e) => update("journal", e.target.value)}
                    maxLength={400}
                  />
                </label>
                {(
                  [
                    ["year", "Publication year"],
                    ["volume", "Volume"],
                    ["issue", "Issue"],
                    ["pages", "Page range"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="mla-field" key={key}>
                    {label}
                    <input
                      value={source[key]}
                      onChange={(e) => update(key, e.target.value)}
                      maxLength={50}
                    />
                  </label>
                ))}
                <label className="mla-field span-two">
                  DOI <span className="field-optional">optional for print</span>
                  <input
                    value={source.doi}
                    onChange={(e) => update("doi", e.target.value)}
                    maxLength={250}
                  />
                </label>
              </div>
            </details>
          </div>
          <div className="mla-preview-column">
            <section className="mla-citation-preview">
              <div className="mla-preview-title">
                <BookOpen size={17} />
                <h3>Works Cited</h3>
                <span>MLA 9</span>
              </div>
              {source.title && source.journal ? (
                <p className="mla-entry">
                  <CitationText text={formatted.entry} />
                </p>
              ) : (
                <p className="mla-placeholder">
                  Find a source or enter its title and journal to preview the
                  citation.
                </p>
              )}
              {source.title && warnings.length > 0 && (
                <ul className="mla-warnings">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {existingEntry && existingEntry.text !== formatted.entry && (
                <details className="mla-current-entry">
                  <summary>Compare with current entry</summary>
                  <p>
                    <CitationText text={existingEntry.text} />
                  </p>
                </details>
              )}
              <button
                className="button primary full"
                disabled={!valid || busy}
                onClick={addEntry}
              >
                <Plus size={16} />
                {existingEntry ? "Update Works Cited" : "Add to Works Cited"}
              </button>
              <button
                className="text-button mla-copy"
                disabled={!valid}
                onClick={() => void copy(formatted.entry)}
              >
                <Copy size={14} />
                Copy citation
              </button>
            </section>
            <section className="mla-intext">
              <h3>In-text citation</h3>
              <label className="mla-field">
                Page or locator{" "}
                <span className="field-optional">if relevant</span>
                <input
                  value={locator}
                  onChange={(e) => setLocator(e.target.value)}
                  placeholder="e.g. 42 or 42-45"
                  maxLength={60}
                />
              </label>
              <p className="mla-inline-preview">
                {source.title ? formatted.inText : "(Author page)"}
              </p>
              <p className="mla-help">
                Use a page number for a specific passage when the source has
                pages. Leave blank for an unpaginated source or the whole work.
              </p>
              <button
                className="text-button"
                disabled={!valid}
                onClick={() => void copy(formatted.inText)}
              >
                <Copy size={14} />
                Copy in-text citation
              </button>
              <details className="mla-insert">
                <summary>Insert into the document</summary>
                <label className="mla-field">
                  Paragraph to cite
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">Choose a paragraph</option>
                    {targets.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m[0].slice(0, 110)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary full"
                  disabled={!valid || !target || busy}
                  onClick={insertInText}
                >
                  Insert citation
                  <ArrowRight size={14} />
                </button>
                <p className="mla-help">
                  For a specific sentence, copy the citation and place it in
                  Edit.
                </p>
              </details>
            </section>
          </div>
        </div>
      ) : (
        <div className="mla-review">
          <div className="mla-review-heading">
            <div>
              <h3>Check your MLA citations</h3>
              <p>
                Review in-text citations and Works Cited entries against the
                available source details.
              </p>
            </div>
            <select
              aria-label="Citation review scope"
              value={scope}
              disabled={busy}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                setReviewed(false);
                setError("");
                setMessage("");
              }}
            >
              <option value="document">This document</option>
              <option value="pasted">Pasted Works Cited entry</option>
            </select>
          </div>
          {scope === "pasted" && (
            <label className="mla-field">
              Citation to review
              <textarea
                rows={5}
                value={pasted}
                disabled={busy}
                onChange={(e) => {
                  setPasted(e.target.value);
                  setReviewed(false);
                }}
                placeholder="Paste a Works Cited entry, including its DOI if available."
                maxLength={20000}
              />
            </label>
          )}
          <button
            className="button primary"
            disabled={busy || !reviewText.trim()}
            onClick={() => void review()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <CheckCheck size={17} />
            )}{" "}
            {busy
              ? "Checking source details..."
              : reviewed
                ? "Review again"
                : "Review citations"}
          </button>
          {reviewed && (
            <div className="mla-review-results" aria-live="polite">
              <h4>
                {issues.length
                  ? `${issues.length} ${issues.length === 1 ? "item" : "items"} to review`
                  : "No issues found by these checks"}
              </h4>
              {!issues.length && (
                <p className="mla-help">
                  Confirm page locators, title capitalization, and any special
                  source requirements against the original.
                </p>
              )}
              {issues.map((issue) => (
                <article className="mla-review-card" key={issue.id}>
                  <h4>{issue.title}</h4>
                  <p>{issue.explanation}</p>
                  {issue.context && (
                    <blockquote className="mla-claim-context">
                      {issue.context}
                    </blockquote>
                  )}
                  {issue.original && (
                    <div className="mla-before">
                      <span>Current</span>
                      <p>
                        <CitationText text={issue.original} />
                      </p>
                    </div>
                  )}
                  {issue.edit && (
                    <>
                      <div className="mla-after">
                        <span>Suggested</span>
                        <p>
                          {issue.edit.replacement ? (
                            <CitationText text={issue.edit.replacement} />
                          ) : (
                            "Remove this duplicate entry."
                          )}
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => {
                          try {
                            const next = applyCitationEdit(
                              reviewText,
                              issue.edit!,
                            );
                            if (scope === "document") onChange(next);
                            else {
                              setPastedUndo(pasted);
                              setPasted(next);
                            }
                            setMessage(
                              "Citation updated. You can undo this change.",
                            );
                            setError("");
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <Check size={15} />
                        Apply correction
                      </button>
                    </>
                  )}
                  {!issue.edit && (
                    <button
                      className="text-button"
                      onClick={() => setTab("add")}
                    >
                      Add source details
                      <ArrowRight size={14} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
          {scope === "pasted" && reviewed && (
            <div className="mla-pasted-actions">
              <button
                className="button secondary"
                onClick={() => void copy(pasted)}
              >
                <Copy size={14} />
                Copy reviewed citation
              </button>
              {pastedUndo !== null && (
                <button
                  className="text-button"
                  onClick={() => {
                    setPasted(pastedUndo);
                    setPastedUndo(null);
                  }}
                >
                  Undo correction
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <footer className="mla-footer">
        <p>
          Checks cover journal articles and common MLA patterns. Source
          accuracy, page locators, and final page layout still need your review.
          Italics display here and use *asterisks* in plain-text exports.{" "}
          <a
            href="https://style.mla.org/works-cited/citations-by-format/"
            target="_blank"
            rel="noreferrer"
          >
            MLA Style Center
          </a>
        </p>
        {canUndo && (
          <button
            className="text-button"
            onClick={() => {
              onUndo();
              setMessage("Change undone.");
            }}
          >
            <RotateCcw size={14} />
            Undo last change
          </button>
        )}
      </footer>
    </div>
  );
}
