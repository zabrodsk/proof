import { useState, useEffect } from "react";
import { Search, ArrowUpRight, LoaderCircle, Plus } from "lucide-react";
import type { SearchReport, SearchCandidate } from "../shared/discovery";
import { labels, accessLabels } from "../shared/types";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Search failed");
  return d;
}
export default function FindSources({
  text,
  onText,
  onUse,
  initialClaim,
  onBusyChange,
}: {
  text: string;
  onText: (text: string) => void;
  onUse: (candidate: SearchCandidate) => void;
  initialClaim?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [sentences, setSentences] = useState<{ id: string; text: string }[]>(
    [],
  );
  const [claim, setClaim] = useState(initialClaim || "");
  const [query, setQuery] = useState("");
  const [job, setJob] = useState("");
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState<SearchReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy || !!job);
    return () => onBusyChange?.(false);
  }, [busy, job, onBusyChange]);
  useEffect(() => {
    setSentences([]);
    setClaim("");
    setQuery("");
  }, [text]);
  useEffect(() => {
    if (initialClaim) setClaim(initialClaim);
  }, [initialClaim]);
  useEffect(() => {
    if (!job) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const j = await api<{
          status: string;
          progress: string;
          report?: SearchReport;
          error?: string;
        }>(`/api/class/searches/${job}`);
        if (stop) return;
        setProgress(j.progress);
        if (j.status === "complete") {
          setReport(j.report);
          setJob("");
        } else if (j.status === "failed") {
          setError(j.error || "Search failed");
          setJob("");
        } else timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!stop) {
          setError((e as Error).message);
          setJob("");
        }
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job]);
  async function split() {
    setError("");
    setBusy(true);
    try {
      const r = await api<{ sentences: { id: string; text: string }[] }>(
        "/api/class/claims",
        { text },
      );
      setSentences(r.sentences);
      if (r.sentences[0]) setClaim(r.sentences[0].text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    setError("");
    setBusy(true);
    setReport(undefined);
    try {
      const chosen = claim.trim() || text.trim();
      if (!chosen || chosen.length > 4000)
        throw new Error("Choose one sentence to find sources for.");
      const r = await api<{ id: string }>("/api/class/searches", {
        claim: chosen,
        query: query || undefined,
      });
      setJob(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="class-error" role="alert">
          {error}
        </p>
      )}
      <section className="class-card">
        <h2>What do you need a source for?</h2>
        <textarea
          className="class-discovery-input"
          data-tour="find"
          aria-label="Text to find sources for"
          value={text}
          onChange={(e) => {
            onText(e.target.value);
            setClaim("");
            setSentences([]);
            setReport(undefined);
          }}
          placeholder="Paste your paragraph or essay here."
        />
        <button
          className="button secondary"
          disabled={busy || !!job || text.trim().length < 10}
          onClick={split}
        >
          Choose a sentence from my text
        </button>
        {sentences.length > 0 && (
          <label className="class-claim-picker">
            Choose a sentence
            <select
              value={sentences.find((s) => s.text === claim)?.id || ""}
              onChange={(e) => {
                setClaim(
                  sentences.find((s) => s.id === e.target.value)?.text || "",
                );
                setQuery("");
              }}
            >
              {sentences.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.text.slice(0, 150)}
                </option>
              ))}
            </select>
          </label>
        )}
        {claim && <p>Finding sources for: {claim}</p>}
        <details>
          <summary>Change search words</summary>
          <label className="class-claim-picker">
            Search words
            <input
              value={query}
              maxLength={500}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try a topic, group, or outcome"
            />
          </label>
        </details>
        <button
          className="button primary"
          disabled={busy || !!job || (claim.trim() || text.trim()).length < 10}
          onClick={search}
        >
          <Search size={16} /> Find sources
        </button>
      </section>
      {job && (
        <div className="class-progress" role="status">
          <LoaderCircle size={18} className="spin" />
          {progress || "Searching scholarly literature"}
        </div>
      )}
      {report && (
        <>
          <section className="class-card">
            <h2>Articles that passed the source checks</h2>
            <blockquote>{report.claim}</blockquote>
            {report.usage && (
              <p>
                Estimated cost: ${report.usage.estimatedUsd.toFixed(5)} USD
                {report.usage.unmeteredRequests > 0
                  ? " · partial estimate"
                  : ""}
              </p>
            )}
            {report.notices.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </section>
          {report.candidates.map((c) => (
            <section className="class-card" key={c.source.id}>
              <div className="class-row">
                <h2>{c.source.title}</h2>
                <span className="class-status">
                  {c.finding.status === "supported"
                    ? "Evidence found · confirm quote"
                    : labels[c.finding.status]}
                </span>
              </div>
              <p>
                {c.source.authors.join(", ")} · {c.source.journal} ·{" "}
                {c.source.year}
              </p>
              <p>
                <strong>{accessLabels[c.source.access]}</strong> ·{" "}
                {c.finding.explanation}
              </p>
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
                  {c.finding.fullTextCheck.chunks}.
                </p>
              )}
              {c.finding.evidence && (
                <blockquote>{c.finding.evidence}</blockquote>
              )}
              <div className="class-actions">
                <a href={c.source.url} target="_blank" rel="noreferrer">
                  Open source <ArrowUpRight size={15} />
                </a>
                <button className="button primary" onClick={() => onUse(c)}>
                  <Plus size={15} /> Prepare MLA citation
                </button>
              </div>
              <details>
                <summary>Inspect quoted passages</summary>
                {c.finding.checkedPassages?.length ? (
                  c.finding.checkedPassages.map((p, i) => <p key={i}>{p}</p>)
                ) : (
                  <p>
                    No source text was available. This is a research lead, not
                    verified evidence.
                  </p>
                )}
              </details>
            </section>
          ))}
        </>
      )}
    </>
  );
}
