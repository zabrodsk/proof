import { useEffect, useState } from "react";
import { LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import type {
  EvidenceMode,
  EvidenceReport,
  SourceInput,
} from "../shared/evidence";
import type { ClassPaper } from "../shared/classroom";
import { labels, accessLabels } from "../shared/types";

export type EvidenceWorkspace = {
  mode: EvidenceMode;
  sources: SourceInput[];
  job?: string;
  report?: EvidenceReport;
  input?: string;
};
export const emptyEvidence: EvidenceWorkspace = {
  mode: "supplied",
  sources: [],
};
const fingerprint = (text: string, state: EvidenceWorkspace) =>
  JSON.stringify([
    text,
    state.mode,
    state.mode === "supplied" ? state.sources : [],
  ]);
async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers:
            body instanceof FormData
              ? undefined
              : { "Content-Type": "application/json" },
          body: body instanceof FormData ? body : JSON.stringify(body),
        },
  );
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error || "Something went wrong. Try again.");
  return result;
}
export default function EvidenceCheck({
  text,
  value,
  onChange,
  papers,
  disabled,
  onBusyChange,
}: {
  text: string;
  value: EvidenceWorkspace;
  onChange: (change: Partial<EvidenceWorkspace>) => void;
  papers: ClassPaper[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [links, setLinks] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = busy || !!value.job || disabled;
  useEffect(() => {
    onBusyChange(busy || !!value.job);
    return () => onBusyChange(false);
  }, [busy, value.job, onBusyChange]);
  useEffect(() => {
    if (!value.job) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const j = await api<{
          status: string;
          progress: string;
          error?: string;
          report?: EvidenceReport;
        }>(`/api/class/evidence-checks/${value.job}`);
        if (stop) return;
        setProgress(j.progress);
        if (j.status === "complete")
          onChange({ report: j.report, job: undefined });
        else if (j.status === "failed") {
          setError(j.error || "Could not finish the check.");
          onChange({ job: undefined });
        } else timer = setTimeout(poll, 1800);
      } catch (e) {
        if (!stop) {
          setError((e as Error).message);
          onChange({ job: undefined });
        }
      }
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // Only the job ID starts or stops polling. Parent updates do not restart it.
  }, [value.job]);
  function addSources(sources: SourceInput[]) {
    if (sources.some((s) => (s.text?.length || 0) > 100000)) {
      setError(
        "This source is too long. Paste a section with up to 100,000 characters.",
      );
      return false;
    }
    if (value.sources.length + sources.length > 8) {
      setError("Use up to eight sources at a time.");
      return false;
    }
    onChange({ sources: [...value.sources, ...sources] });
    setError("");
    return true;
  }
  function addLinks() {
    const urls = links
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      urls.some(
        (url) => !/^https:\/\//i.test(url) && !/^10\.\d{4,9}\/\S+$/i.test(url),
      )
    ) {
      setError(
        "Paste a full https:// link on each line. Article DOI numbers also work.",
      );
      return;
    }
    if (addSources(urls.map((url) => ({ label: "", url })))) setLinks("");
  }
  async function start() {
    setError("");
    setBusy(true);
    try {
      const j = await api<{ id: string }>("/api/class/evidence-checks", {
        text,
        mode: value.mode,
        sources: value.mode === "supplied" ? value.sources : [],
      });
      onChange({
        job: j.id,
        input: fingerprint(text, value),
        report: undefined,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const report = value.report;
  return (
    <section data-tour="evidence">
      {value.mode === "supplied" ? (
        <section className="class-card">
          <h2>Which journal articles should I use?</h2>
          <label className="class-claim-picker">
            Paste article links, one per line
            <textarea
              aria-label="Source links"
              value={links}
              disabled={locked}
              onChange={(e) => setLinks(e.target.value)}
              placeholder="https://example.com/article"
            />
          </label>
          <div className="class-actions">
            <button
              className="button secondary"
              disabled={locked || !links.trim()}
              onClick={addLinks}
            >
              <Plus size={16} /> Add links
            </button>
            <label className="button secondary evidence-upload">
              <Upload size={16} /> Upload a source
              <input
                type="file"
                accept=".pdf,.txt,.docx,.md"
                disabled={locked}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setBusy(true);
                  setError("");
                  try {
                    const data = new FormData();
                    data.set("file", file);
                    const result = await api<{ text: string }>(
                      "/api/class/import",
                      data,
                    );
                    if (result.text.trim().length < 40)
                      throw new Error(
                        "This file has too little readable text. Paste the source text instead.",
                      );
                    addSources([{ label: file.name, text: result.text }]);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </div>
          <details className="evidence-paste">
            <summary>Or paste the full article text</summary>
            <label>
              Source name
              <input
                value={label}
                disabled={locked}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={300}
                placeholder="e.g. Article from class"
              />
            </label>
            <label>
              Text from the source
              <textarea
                value={sourceText}
                disabled={locked}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Include the article title and DOI from its first page. We will retrieve and check the published full text."
              />
            </label>
            <button
              className="button secondary"
              disabled={locked || sourceText.trim().length < 40}
              onClick={() => {
                if (
                  addSources([
                    {
                      label:
                        label.trim() ||
                        `Pasted source ${value.sources.length + 1}`,
                      text: sourceText.trim(),
                    },
                  ])
                ) {
                  setSourceText("");
                  setLabel("");
                }
              }}
            >
              Add source text
            </button>
          </details>
          {papers.length > 0 && (
            <details>
              <summary>Use articles from My sources</summary>
              {papers.map((p) => (
                <button
                  key={p.id}
                  className="button secondary"
                  disabled={locked}
                  onClick={() =>
                    addSources([
                      p.pages.length
                        ? {
                            label: p.mla.title,
                            text: p.pages.map((page) => page.text).join("\n\n"),
                          }
                        : {
                            label: p.mla.title,
                            url: `https://doi.org/${p.mla.doi}`,
                          },
                    ])
                  }
                >
                  Add {p.mla.title}
                </button>
              ))}
            </details>
          )}
          {value.sources.length > 0 && (
            <ul className="evidence-source-list">
              {value.sources.map((s, i) => (
                <li key={i}>
                  <div>
                    <strong>{s.label || s.url}</strong>
                    <small>
                      {s.text
                        ? "We’ll identify the article and retrieve its published full text."
                        : "Peer review and full text must be verified."}
                    </small>
                  </div>
                  <button
                    className="class-icon"
                    aria-label={`Remove source ${i + 1}`}
                    disabled={locked}
                    onClick={() =>
                      onChange({
                        sources: value.sources.filter((_, at) => at !== i),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="class-note">
            This check uses only the articles you add. Journal peer review and
            readable full text must be verified first. Abstracts and unverified
            pasted text are excluded.
          </p>
        </section>
      ) : (
        <p className="evidence-scope">
          Proof checks each sentence against peer-reviewed journal articles it
          can read in full. Abstracts, previews and unverified sources are
          excluded.
        </p>
      )}
      {error && (
        <p role="alert" className="class-error">
          {error}
        </p>
      )}
      <div className="class-actions evidence-start">
        <button
          className="button primary"
          data-tour="check"
          disabled={
            locked ||
            text.trim().length < 10 ||
            (value.mode === "supplied" && !value.sources.length) ||
            (value.mode === "supplied" && !!(links.trim() || sourceText.trim()))
          }
          onClick={start}
        >
          {busy || value.job ? (
            <LoaderCircle size={16} className="spin" />
          ) : null}
          {value.job
            ? "Checking your text"
            : value.mode === "supplied"
              ? "Check with my sources"
              : "Check with public sources"}
        </button>
        <small>
          {value.mode === "supplied" && (links.trim() || sourceText.trim())
            ? "Add your pasted sources before checking."
            : value.mode === "public"
              ? "Up to 25 sentences per public-source check."
              : "Up to 100 sentences per check."}
        </small>
      </div>
      {value.job && (
        <p role="status" className="class-progress">
          {progress || "Starting your check"} · You can switch tabs while this
          runs.
        </p>
      )}
      {report && (
        <div className="evidence-report">
          {value.input !== fingerprint(text, value) && (
            <p className="class-error">
              Your text or sources have changed. These results are from the
              previous check.
            </p>
          )}
          <section className="class-card">
            <h2>Your results</h2>
            <p>
              {report.mode === "supplied"
                ? "Checked against your supplied sources."
                : "Checked against public academic research."}{" "}
              {report.completed} of {report.total} sentences completed all
              available comparisons. A completed check does not mean the
              sentence is correct.
            </p>
            {report.usage && (
              <p>
                Estimated cost: ${report.usage.estimatedUsd.toFixed(5)} USD
                {report.usage.unmeteredRequests ? " · partial estimate" : ""}
              </p>
            )}
          </section>
          {report.rows.map((row, i) => (
            <section className="class-card" key={row.id}>
              <h2>
                Sentence {i + 1}
                {!row.completed ? " · needs another look" : ""}
              </h2>
              <blockquote>{row.text}</blockquote>
              {row.notices.map((n, j) => (
                <p key={j}>{n}</p>
              ))}
              {row.candidates.map((c, j) => (
                <details
                  key={j}
                  className="evidence-result"
                  open={row.candidates.length === 1}
                >
                  <summary>
                    <span className="class-status">
                      {c.finding.status === "supported"
                        ? "Evidence found · confirm quote"
                        : labels[c.finding.status]}
                    </span>{" "}
                    {c.source.title}
                  </summary>
                  <p>
                    {c.finding.explanation.replace(
                      "its provenance has not been independently verified",
                      "its origin has not been checked",
                    )}
                  </p>
                  {c.source.notice && <p>{c.source.notice}</p>}
                  {c.source.scholarly?.reviewPolicy && (
                    <p>
                      <a
                        href={c.source.scholarly.reviewPolicy}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Journal peer-review policy ↗
                      </a>
                    </p>
                  )}
                  {c.source.scholarly?.fullTextUrl && (
                    <p>
                      <a
                        href={c.source.scholarly.fullTextUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Full article checked ↗
                      </a>
                    </p>
                  )}
                  {c.finding.fullTextCheck && (
                    <p>
                      Full-text sections checked:{" "}
                      {c.finding.fullTextCheck.completed} of{" "}
                      {c.finding.fullTextCheck.chunks}. Confirm the quoted
                      evidence before using it.
                    </p>
                  )}
                  <p>
                    {c.source.access === "full_text"
                      ? "Available source text read"
                      : accessLabels[c.source.access]}
                  </p>
                  {c.finding.evidence && (
                    <blockquote>{c.finding.evidence}</blockquote>
                  )}
                  {c.source.url && /^https:\/\//.test(c.source.url) && (
                    <a href={c.source.url} target="_blank" rel="noreferrer">
                      Open source ↗
                    </a>
                  )}
                  <details>
                    <summary>See the quoted passages</summary>
                    {c.finding.checkedPassages?.length ? (
                      c.finding.checkedPassages.map((p, k) => (
                        <p key={k}>{p}</p>
                      ))
                    ) : (
                      <p>No readable evidence was checked.</p>
                    )}
                  </details>
                </details>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
