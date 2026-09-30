import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  CircleHelp,
  Clipboard,
  FileText,
  Library,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  documentHighlights,
  findingLabel,
  findingTone,
} from "./studio-document";
import "./studio-analysis.css";
import StudioDocument from "./StudioDocument";
import type { BackendFinding, RunInput } from "../shared/backend";
import { api, ApiError, type StudioWork } from "./studio-api";

type Source = {
  id: string;
  metadata: { title: string };
  status: string;
  access: string;
  eligibility: string;
  extraction_id?: string;
  extraction_status?: string;
};
type Run = {
  id: string;
  status: string;
  stage: string;
  invalidated: boolean;
  document_version_id: string;
  error?: string;
  coverage: Record<string, unknown>;
};
type Citation = {
  id: string;
  text: string;
  warnings: string[];
  missingMetadata: string[];
};

export default function StudioAnalysis({
  work,
  section,
  onUpdated,
  onEdit,
  onAnalyze,
}: {
  work: StudioWork;
  section: string;
  onUpdated: () => Promise<void>;
  onEdit: () => void;
  onAnalyze: () => void;
}) {
  const [sourceSearch, setSourceSearch] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<RunInput["mode"]>("source_check");
  const [permission, setPermission] = useState(false);
  const [run, setRun] = useState<Run>();
  const [findings, setFindings] = useState<BackendFinding[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [bibliography, setBibliography] = useState("");
  const [referenceId, setReferenceId] = useState<string>();
  const [importStatus, setImportStatus] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const active = run && ["queued", "running"].includes(run.status);
  const stale =
    run &&
    (run.invalidated || run.document_version_id !== work.documentVersionId);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function loadSources() {
    const all: Source[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await api<{ items: Source[] }>(
        `/api/v1/sources?limit=100&offset=${offset}`,
      );
      all.push(...page.items);
      if (page.items.length < 100) break;
    }
    setSources(all);
  }
  useEffect(() => {
    if (!work.documentVersionId) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const all: Source[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await api<{ items: Source[] }>(
            `/api/v1/sources?limit=100&offset=${offset}`,
          );
          all.push(...page.items);
          if (page.items.length < 100) break;
        }
        const runs = await api<{ items: Run[] }>(
          `/api/v1/documents/${work.id}/runs`,
        );
        if (disposed) return;
        setSources(all);
        setHistory(runs.items);
        setRun((current) => current || runs.items[0]);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [work.id, work.documentVersionId]);
  useEffect(() => {
    if (!run?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<Run>(`/api/v1/runs/${run.id}`);
        const rows: BackendFinding[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await api<{ items: BackendFinding[] }>(
            `/api/v1/runs/${run.id}/findings?limit=100&offset=${offset}`,
          );
          rows.push(...page.items);
          if (page.items.length < 100) break;
        }
        if (disposed) return;
        setRun(next);
        setFindings(rows);
        timer = setTimeout(
          () => void refresh(),
          ["queued", "running"].includes(next.status) ? 2000 : 5000,
        );
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
            setFindings([]);
            setRun(undefined);
            setHistory((current) =>
              current.filter((item) => item.id !== run.id),
            );
            return;
          }
          timer = setTimeout(() => void refresh(), 5000);
        }
      }
    };
    setFindings([]);
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [run?.id]);
  useEffect(() => {
    if (!work.documentVersionId) return;
    let disposed = false;
    void api<{
      item?: { id: string; status: string; input: { text?: string } };
    }>(`/api/v1/documents/${work.id}/bibliography`)
      .then((result) => {
        if (disposed || !result.item) return;
        setBibliography(result.item.input.text || "");
        setReferenceId(result.item.id);
        setImportStatus(result.item.status);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [work.id]);
  useEffect(() => {
    if (!referenceId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await api<{ status: string }>(
          `/api/v1/source-imports/${referenceId}`,
        );
        if (disposed) return;
        if (result.status === "complete") {
          const formatted = await api<{ items: Citation[] }>(
            `/api/v1/reference-imports/${referenceId}/citations`,
            {},
          );
          if (disposed) return;
          setCitations(formatted.items);
          setImportStatus("complete");
          return;
        }
        setImportStatus(result.status);
        if (
          ["pending", "processing", "running", "queued"].includes(result.status)
        )
          timer = setTimeout(() => void refresh(), 1500);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setImportStatus("failed");
        }
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [referenceId]);
  if (!work.documentVersionId && section === "dashboard")
    return (
      <div className="ps-live">
        <StudioOverview
          findings={[]}
          stale={false}
          active={false}
          hasRun={false}
          onAnalyze={onAnalyze}
        />
        <StudioDocument
          title={work.title}
          text={work.content}
          findings={[]}
          stale={false}
          sources={[]}
          onEdit={onEdit}
          onAnalyze={onAnalyze}
          onApply={() => {}}
          locked={false}
        />
      </div>
    );
  if (!work.documentVersionId)
    return (
      <section className="ps-home-panel ps-live-panel">
        <h2>Analysis tools</h2>
        <p>
          This draft is saved in this browser. The persistent analysis service
          is unavailable.
        </p>
        <a href="/app/class">Open class tools</a> ·{" "}
        <a href="/app/evidence">Open evidence editor</a>
      </section>
    );
  const ready = sources.filter(
    (s) =>
      s.status === "ready" &&
      s.extraction_id &&
      ["complete", "partial"].includes(s.extraction_status || ""),
  );
  const selectedReady = ready.filter((source) => selected.includes(source.id));
  const visibleSources = sources.filter((source) =>
    source.metadata.title.toLowerCase().includes(sourceSearch.toLowerCase()),
  );
  const importing = ["pending", "processing", "running", "queued"].includes(
    importStatus,
  );
  return (
    <div className="ps-live">
      {error && (
        <p className="ps-live-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="ps-analysis-busy" role="status">
          <LoaderCircle size={16} className="ps-analysis-spin" />
          {busy}
        </p>
      )}
      {section === "dashboard" && (
        <>
          <StudioOverview
            findings={documentHighlights(work.content, findings, !!stale)}
            stale={!!stale}
            active={!!active}
            hasRun={!!run}
            onAnalyze={onAnalyze}
          />
          <StudioDocument
            title={work.title}
            text={work.content}
            findings={findings}
            stale={!!stale}
            status={run?.status}
            sources={sources}
            onEdit={onEdit}
            onAnalyze={onAnalyze}
            locked={!!busy || !!active}
            onApply={(finding) => {
              if (!finding.fix || !run || stale || busy || active) return;
              void action("Applying edit...", async () => {
                await api(`/api/v1/documents/${work.id}/apply-fix`, {
                  approved: true,
                  documentVersionId: work.documentVersionId,
                  findingId: finding.id,
                });
                await onUpdated();
              });
            }}
          />
        </>
      )}
      {section !== "dashboard" && (
        <div className="ps-detail-heading">
          <div>
            <h2>
              {section === "citations"
                ? "Sources & citations"
                : "Evidence analysis"}
            </h2>
            <p>
              {section === "citations"
                ? "Keep your references organized and consistent."
                : "Inspect the support behind your claims."}
            </p>
          </div>
          <span className="ps-pill">
            {section === "citations" ? (
              <>
                <BookOpen size={16} />
                MLA 9
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                {stale
                  ? "Previous draft"
                  : active
                    ? "Check in progress"
                    : run
                      ? run.status.replaceAll("_", " ")
                      : "Not checked yet"}
              </>
            )}
          </span>
        </div>
      )}
      {section === "analysis" && (
        <>
          <FindingSummary findings={findings} stale={!!stale} />
          {history.length > 1 && (
            <label className="ps-field-label ps-analysis-history">
              Previous runs
              <select
                className="ps-field"
                value={run?.id || ""}
                onChange={(e) => {
                  setFindings([]);
                  setRun(history.find((r) => r.id === e.target.value));
                }}
              >
                {history.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.status} · {r.id.slice(0, 8)}
                    {r.document_version_id !== work.documentVersionId
                      ? " · previous draft"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {run && (
            <section className="ps-card ps-live-panel ps-analysis-results ps-analysis-issues">
              <div className="ps-analysis-heading">
                <div>
                  <ShieldCheck size={19} />
                  <h2>Suggestions to improve</h2>
                </div>
                <button className="ps-outline" onClick={onEdit}>
                  <FileText size={16} />
                  Edit draft
                </button>
              </div>
              <div
                className={`ps-analysis-run-status ${active ? "is-running" : ""}`}
                role="status"
              >
                {active ? (
                  <LoaderCircle size={18} className="ps-analysis-spin" />
                ) : (
                  <FileText size={18} />
                )}
                <div>
                  <strong>{run.status.replaceAll("_", " ")}</strong>
                  <span>
                    {run.stage.replaceAll("_", " ")} · {findings.length}{" "}
                    {findings.length === 1 ? "finding" : "findings"}
                  </span>
                </div>
              </div>
              {stale && (
                <p
                  className="ps-analysis-warning ps-analysis-stale"
                  role="alert"
                >
                  <CircleAlert size={17} />
                  This report describes a previous draft. Run analysis again
                  before relying on it.
                </p>
              )}
              {run.error && <p role="alert">{run.error}</p>}
              {active && (
                <button
                  className="ps-outline"
                  disabled={!!busy}
                  onClick={() =>
                    void action("Cancelling...", async () => {
                      await api(`/api/v1/runs/${run.id}/cancel`, {});
                      setRun(await api<Run>(`/api/v1/runs/${run.id}`));
                    })
                  }
                >
                  Cancel analysis
                </button>
              )}
              {!findings.length && !active && (
                <p>
                  No findings were returned. This does not verify the draft.
                </p>
              )}
              {findings.map((finding, index) => (
                <article
                  className="ps-live-finding ps-analysis-finding"
                  key={finding.id}
                >
                  <div className="ps-analysis-finding-heading">
                    <span>Claim {index + 1}</span>
                    <span
                      className={`ps-analysis-support is-${findingTone(finding)}`}
                    >
                      {findingLabel(finding)}
                    </span>
                  </div>
                  <blockquote>{finding.claim.text}</blockquote>
                  <p className="ps-analysis-finding-meta">
                    Citation {finding.citation.replaceAll("_", " ")} ·
                    Processing {finding.processing} · Eligibility{" "}
                    {finding.eligibility}
                  </p>
                  {finding.explanation.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                  {finding.evidence.map((passage, i) => (
                    <details
                      className="ps-analysis-passage"
                      key={`${passage.id}:${i}`}
                    >
                      <summary>
                        {sources.find((source) => source.id === passage.assetId)
                          ?.metadata.title || "Source passage"}{" "}
                        · {passage.role} · physical page {passage.pageIndex}
                        {passage.pageLabel
                          ? ` · printed label ${passage.pageLabel}`
                          : ""}
                      </summary>
                      <blockquote>{passage.text}</blockquote>
                      <p>{passage.support.replaceAll("_", " ")}</p>
                    </details>
                  ))}
                  {finding.fix && (
                    <details className="ps-analysis-fix">
                      <summary>Review suggested edit</summary>
                      <div className="ps-analysis-edit-text">
                        <span>Original</span>
                        <p>{finding.fix.original}</p>
                      </div>
                      <div className="ps-analysis-edit-text is-replacement">
                        <span>Suggested replacement</span>
                        <p>{finding.fix.replacement}</p>
                      </div>
                      <button
                        className="ps-outline"
                        disabled={!!busy || !!stale || !!active}
                        onClick={() =>
                          void action("Applying approved edit...", async () => {
                            await api(
                              `/api/v1/documents/${work.id}/apply-fix`,
                              {
                                approved: true,
                                documentVersionId: work.documentVersionId,
                                findingId: finding.id,
                              },
                            );
                            await onUpdated();
                            setRun(await api<Run>(`/api/v1/runs/${run.id}`));
                          })
                        }
                      >
                        <Check size={16} />
                        Approve this edit
                      </button>
                    </details>
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
      {section !== "dashboard" && (
        <div
          className={`ps-analysis-layout ${section === "citations" ? "ps-analysis-citations" : ""}`}
        >
          <section
            className="ps-card ps-citations ps-live-panel ps-analysis-sources"
            aria-labelledby="source-library-title"
          >
            <div className="ps-analysis-heading">
              <div>
                <Library size={19} />
                <h2 id="source-library-title">Source library</h2>
              </div>
              <span className="ps-analysis-count">{sources.length}</span>
            </div>
            <p className="ps-analysis-intro">
              Choose the sources to use in your check.
            </p>
            <label
              className={`ps-analysis-upload ${busy ? "is-disabled" : ""}`}
            >
              <Upload size={22} />
              <strong>Upload a source</strong>
              <span>PDF, DOCX, TXT, or Markdown</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                disabled={!!busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void action("Uploading source...", async () => {
                    const ext = file.name.split(".").pop()?.toLowerCase();
                    const mediaType =
                      ext === "pdf"
                        ? "application/pdf"
                        : ext === "docx"
                          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          : ext === "md"
                            ? "text/markdown"
                            : "text/plain";
                    const intent = await api<{
                      id: string;
                      uploadUrl: string;
                      headers: Record<string, string>;
                    }>("/api/v1/uploads", {
                      filename: file.name,
                      mediaType,
                      bytes: file.size,
                      metadata: { title: file.name, authors: [], year: "" },
                      allowExternalProcessing: permission,
                    });
                    const response = await fetch(intent.uploadUrl, {
                      method: "PUT",
                      headers: intent.headers,
                      body: file,
                    });
                    if (!response.ok)
                      throw Error("Source upload failed. Please retry.");
                    await api(`/api/v1/uploads/${intent.id}/complete`, {});
                    await loadSources();
                  });
                }}
              />
            </label>
            <p className="ps-analysis-provenance">
              <CircleHelp size={14} />
              Uploads have unverified provenance. Checks cover the text Proof
              can extract.
            </p>
            {sources.length > 0 && (
              <>
                <div className="ps-analysis-source-tools">
                  <label className="ps-analysis-search">
                    <Search size={16} />
                    <input
                      aria-label="Search sources"
                      placeholder="Search sources"
                      value={sourceSearch}
                      onChange={(event) => setSourceSearch(event.target.value)}
                    />
                  </label>
                  <span>{selectedReady.length} selected</span>
                </div>
              </>
            )}
            {!sources.length && (
              <div className="ps-analysis-empty">
                <BookOpen size={26} />
                <strong>No sources yet</strong>
                <p>
                  Upload a paper or book excerpt to check your draft against it.
                </p>
              </div>
            )}
            {!!sources.length && !visibleSources.length && (
              <p className="ps-analysis-no-matches">
                No sources match your search.
              </p>
            )}
            <div className="ps-analysis-source-list">
              {visibleSources.map((source) => (
                <label
                  className={`ps-source-option ps-analysis-source ${selected.includes(source.id) ? "is-selected" : ""}`}
                  key={`${source.id}:${source.extraction_id || "pending"}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(source.id)}
                    disabled={!ready.some((s) => s.id === source.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, source.id]
                          : current.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <span className="ps-source-icon">
                    <FileText size={19} />
                  </span>
                  <span className="ps-analysis-source-copy">
                    <strong>{source.metadata.title}</strong>
                    <small className="ps-analysis-source-state">
                      {source.extraction_status === "complete" &&
                      source.status === "ready"
                        ? "Text extracted"
                        : source.extraction_status === "partial" &&
                            source.status === "ready"
                          ? "Partial text"
                          : `${source.status.replaceAll("_", " ")} · ${source.extraction_status?.replaceAll("_", " ") || "awaiting extraction"}`}
                    </small>
                    <small>
                      {source.access.replaceAll("_", " ")} · Eligibility{" "}
                      {source.eligibility}
                    </small>
                    {source.extraction_status === "partial" && (
                      <small>
                        Some pages could not be read. Analysis covers extracted
                        text only.
                      </small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </section>
          {section === "citations" ? (
            <section className="ps-card ps-citations ps-live-panel ps-analysis-bibliography">
              <div className="ps-analysis-heading">
                <div>
                  <BookOpen size={19} />
                  <h2>MLA bibliography</h2>
                </div>
              </div>
              <p className="ps-analysis-intro">
                Paste your references to format them in MLA. Review missing
                details before you use the result.
              </p>
              <label
                className="ps-analysis-input-label"
                htmlFor="studio-bibliography"
              >
                Your references
              </label>
              <textarea
                id="studio-bibliography"
                className="ps-editor"
                aria-label="Bibliography"
                placeholder="Paste your bibliography here, one reference per line..."
                value={bibliography}
                onChange={(e) => setBibliography(e.target.value)}
              />
              <button
                className="ps-primary"
                disabled={
                  !!busy ||
                  !bibliography.trim() ||
                  ["pending", "processing", "running", "queued"].includes(
                    importStatus,
                  )
                }
                onClick={() =>
                  void action("Importing bibliography...", async () => {
                    const result = await api<{ id: string }>(
                      "/api/v1/source-imports",
                      {
                        kind: "bibliography",
                        documentId: work.id,
                        text: bibliography,
                        externalAccess: false,
                      },
                    );
                    setReferenceId(result.id);
                    setImportStatus("pending");
                    setCitations([]);
                  })
                }
              >
                {importing ? (
                  <LoaderCircle size={17} className="ps-analysis-spin" />
                ) : (
                  <BookOpen size={17} />
                )}{" "}
                {importing ? "Formatting..." : "Format bibliography"}
              </button>
              {importStatus && (
                <p className="ps-analysis-import-status" role="status">
                  {importing
                    ? "Your references are being processed."
                    : importStatus === "complete"
                      ? `${citations.length} formatted ${citations.length === 1 ? "reference" : "references"}`
                      : `Import ${importStatus.replaceAll("_", " ")}`}
                </p>
              )}
              {!!citations.length && (
                <div className="ps-analysis-citation-list">
                  <div className="ps-analysis-citation-heading">
                    <h3>Formatted references</h3>
                    <span>MLA 9</span>
                  </div>
                  {citations.map((c, index) => (
                    <article
                      className="ps-source ps-analysis-citation"
                      key={c.id}
                    >
                      <span className="ps-source-icon">
                        <FileText size={20} />
                      </span>
                      <div>
                        <p className="ps-analysis-reference-text">{c.text}</p>
                        {[
                          ...c.warnings,
                          ...c.missingMetadata.map((m) => `Missing: ${m}`),
                        ].map((warning, i) => (
                          <p className="ps-analysis-warning" key={i}>
                            <CircleAlert size={14} />
                            {warning}
                          </p>
                        ))}
                        <button
                          className="ps-outline"
                          onClick={() =>
                            void action("Copying citation...", async () => {
                              await navigator.clipboard.writeText(c.text);
                              setCopiedId(c.id);
                            })
                          }
                        >
                          {copiedId === c.id ? (
                            <Check size={15} />
                          ) : (
                            <Clipboard size={15} />
                          )}
                          {copiedId === c.id ? "Copied" : "Copy citation"}
                        </button>
                      </div>
                      <span className="ps-source-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="ps-card ps-live-panel ps-analysis-setup">
                <div className="ps-analysis-heading">
                  <div>
                    <ShieldCheck size={19} />
                    <h2>Check your draft</h2>
                  </div>
                </div>
                <p className="ps-analysis-intro">
                  Choose how Proof should review the evidence.
                </p>
                <fieldset
                  className="ps-analysis-modes"
                  disabled={!!busy || !!active}
                >
                  <legend className="ps-analysis-input-label">
                    Check type
                  </legend>
                  {(
                    [
                      {
                        value: "source_check",
                        title: "Check my sources",
                        description:
                          "Compare claims with selected sources and your bibliography.",
                        icon: BookOpen,
                      },
                      {
                        value: "discover",
                        title: "Find research",
                        description:
                          "Look for academic research relevant to this draft.",
                        icon: Sparkles,
                      },
                      {
                        value: "fact_check",
                        title: "Check public research",
                        description:
                          "Check claims against academic research found online.",
                        icon: Search,
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      className={`ps-analysis-mode ${mode === option.value ? "is-selected" : ""}`}
                      key={option.value}
                    >
                      <input
                        type="radio"
                        name="studio-check-mode"
                        value={option.value}
                        checked={mode === option.value}
                        onChange={() => {
                          setMode(option.value);
                          setPermission(false);
                        }}
                      />
                      <option.icon size={19} />
                      <span>
                        <strong>{option.title}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {mode === "source_check" && (
                  <p className="ps-analysis-selection-summary">
                    <Library size={15} />
                    {selectedReady.length}{" "}
                    {selectedReady.length === 1 ? "source" : "sources"} selected
                    {referenceId && importStatus === "complete"
                      ? " · Bibliography included"
                      : ""}
                  </p>
                )}
                <label className="ps-source-option ps-analysis-consent">
                  <input
                    type="checkbox"
                    checked={permission}
                    onChange={(e) => setPermission(e.target.checked)}
                  />
                  <span>
                    Allow providers to process this draft and selected sources
                    {mode !== "source_check"
                      ? ", including external research"
                      : ""}
                    .
                  </span>
                </label>
                <button
                  className="ps-primary"
                  disabled={
                    !!busy ||
                    !!active ||
                    !permission ||
                    (mode === "source_check" &&
                      !(referenceId && importStatus === "complete") &&
                      !selected.some((id) => ready.some((s) => s.id === id)))
                  }
                  onClick={() =>
                    void action("Starting analysis...", async () => {
                      const body: RunInput = {
                        documentVersionId: work.documentVersionId!,
                        mode,
                        checkScope:
                          referenceId && importStatus === "complete"
                            ? "cited_first_then_selected_library"
                            : "selected_library",
                        referenceImportVersionId:
                          mode === "source_check" && importStatus === "complete"
                            ? referenceId
                            : undefined,
                        selectedSources: ready
                          .filter((s) => selected.includes(s.id))
                          .map((s) => ({
                            assetId: s.id,
                            extractionId: s.extraction_id!,
                            pageRanges: [],
                          })),
                        externalAccess:
                          mode === "source_check" ? "none" : "research",
                        sourcePolicy:
                          mode === "source_check"
                            ? "user_supplied"
                            : "academic",
                        allowProviderProcessing: permission,
                        budgetPreset: "standard",
                      };
                      const response = await fetch("/api/v1/runs", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "Idempotency-Key": crypto.randomUUID(),
                        },
                        body: JSON.stringify(body),
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw Error(
                          result.error || "Could not start analysis.",
                        );
                      setFindings([]);
                      setRun(await api<Run>(`/api/v1/runs/${result.id}`));
                    })
                  }
                >
                  {active ? (
                    <LoaderCircle size={17} className="ps-analysis-spin" />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                  {active ? "Analysis in progress" : "Start analysis"}
                </button>
                {!active && !permission && (
                  <p className="ps-analysis-start-hint">
                    Allow processing above to start the check.
                  </p>
                )}
                {!active &&
                  permission &&
                  mode === "source_check" &&
                  !selectedReady.length &&
                  !(referenceId && importStatus === "complete") && (
                    <p className="ps-analysis-start-hint">
                      Select an extracted source or format your bibliography
                      first.
                    </p>
                  )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function findingCounts(findings: BackendFinding[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[findingTone(finding)] += 1;
      return counts;
    },
    { supported: 0, review: 0, unverified: 0 },
  );
}

function FindingSummary({
  findings,
  stale,
}: {
  findings: BackendFinding[];
  stale: boolean;
}) {
  const counts = findingCounts(findings);
  return (
    <div className="ps-analysis-report-summary">
      <div className="ps-analysis-summary" aria-label="Finding summary">
        {(
          [
            { key: "supported", title: "Supported", track: "" },
            { key: "review", title: "Needs review", track: "partial" },
            { key: "unverified", title: "Unverified", track: "needs" },
          ] as const
        ).map((item) => {
          const percent = findings.length
            ? Math.round((counts[item.key] / findings.length) * 100)
            : 0;
          return (
            <div className="ps-card ps-stat" key={item.key}>
              <span>{item.title}</span>
              <strong>{findings.length ? `${percent}%` : "0"}</strong>
              <div className={`ps-track ${item.track}`}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <small>
                {counts[item.key]}{" "}
                {counts[item.key] === 1 ? "finding" : "findings"}
              </small>
            </div>
          );
        })}
      </div>
      <p className="ps-analysis-summary-note">
        {findings.length
          ? `Based on ${findings.length} returned findings${stale ? " from a previous draft" : ""}.`
          : "Run a check to see evidence for this draft."}
      </p>
    </div>
  );
}

function StudioOverview({
  findings,
  stale,
  active,
  hasRun,
  onAnalyze,
}: {
  findings: BackendFinding[];
  stale: boolean;
  active: boolean;
  hasRun: boolean;
  onAnalyze: () => void;
}) {
  const counts = findingCounts(findings);
  const percent = (value: number) =>
    findings.length ? Math.round((value / findings.length) * 100) : 0;
  const issues = findings.filter(
    (finding) => findingTone(finding) !== "supported",
  );
  const passages = new Set(
    findings.flatMap((finding) =>
      finding.evidence.map((passage) => passage.id),
    ),
  ).size;
  const summary = stale
    ? "Your draft has changed"
    : active
      ? "Your check is in progress"
      : findings.length
        ? `${findings.length} claims reviewed`
        : hasRun
          ? "No findings returned"
          : "Check your citations";
  const description = stale
    ? "Run a new check to see evidence for this version."
    : active
      ? "Findings will appear as Proof finishes the check."
      : findings.length
        ? `${counts.supported} supported, ${counts.review} need review, ${counts.unverified} unverified.`
        : hasRun
          ? "An empty report does not verify this draft."
          : "Add sources and run a check to inspect the evidence.";
  return (
    <div className="ps-live-overview">
      <div className="ps-overview">
        <section className="ps-card ps-health">
          <h2>Citation check overview</h2>
          <div className="ps-health-content">
            <div
              className="ps-score-ring"
              style={{
                background: `conic-gradient(var(--forest) 0 ${percent(counts.supported)}%, var(--sage) ${percent(counts.supported)}% 100%)`,
              }}
              aria-label={`${findings.length} findings for this draft`}
            >
              <div className="ps-score-inner">
                <strong>{findings.length}</strong>
                <span>Findings</span>
              </div>
            </div>
            <div className="ps-health-copy">
              <h3>{summary}</h3>
              <p>{description}</p>
              <button className="ps-soft" onClick={onAnalyze}>
                <ArrowRight size={18} />
                {findings.length ? "View analysis" : "Start a check"}
              </button>
            </div>
          </div>
        </section>
        <section className="ps-card ps-evidence">
          <div className="ps-card-heading">
            <h2>Evidence coverage</h2>
            <button className="ps-text-link" onClick={onAnalyze}>
              View analysis <ArrowRight size={16} />
            </button>
          </div>
          {findings.length ? (
            <>
              <div
                className="ps-coverage ps-live-coverage"
                aria-label="Support for returned findings"
              >
                {findings.map((finding) => (
                  <span
                    key={finding.id}
                    className={
                      findingTone(finding) === "supported"
                        ? "covered"
                        : findingTone(finding) === "review"
                          ? "partial"
                          : "uncovered"
                    }
                    title={`${findingLabel(finding)}: ${finding.claim.text}`}
                  />
                ))}
              </div>
              <div className="ps-legend">
                <div>
                  <span className="ps-legend-dot well" />
                  <span>Supported</span>
                  <strong>{percent(counts.supported)}%</strong>
                </div>
                <div>
                  <span className="ps-legend-dot partly" />
                  <span>Needs review</span>
                  <strong>{percent(counts.review)}%</strong>
                </div>
                <div>
                  <span className="ps-legend-dot needs" />
                  <span>Unverified</span>
                  <strong>{percent(counts.unverified)}%</strong>
                </div>
              </div>
              <p className="ps-live-coverage-note">
                Each square represents one returned finding.
              </p>
            </>
          ) : (
            <div className="ps-live-overview-empty">
              <ShieldCheck size={28} />
              <p>
                {stale
                  ? "Evidence coverage needs a new check."
                  : "Evidence coverage will appear after a check."}
              </p>
            </div>
          )}
        </section>
      </div>
      <section className="ps-card ps-insights">
        <h2>
          <Sparkles size={22} className="ps-green" />
          Quick insights
        </h2>
        <div className="ps-insights-grid">
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <BookOpen size={22} />
            </span>
            <div>
              <h3>Source passages</h3>
              <p>
                {findings.length
                  ? `${passages} source ${passages === 1 ? "passage is" : "passages are"} linked to this report.`
                  : "Run a check to see the passages behind each claim."}
              </p>
            </div>
          </div>
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <CircleAlert size={22} />
            </span>
            <div>
              <h3>Claims to review</h3>
              <p>
                {findings.length
                  ? `${counts.review} ${counts.review === 1 ? "claim needs" : "claims need"} a closer look at the evidence or citation.`
                  : "Claims needing review will appear here."}
              </p>
            </div>
          </div>
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <CircleHelp size={22} />
            </span>
            <div>
              <h3>Unverified evidence</h3>
              <p>
                {findings.length
                  ? `${counts.unverified} ${counts.unverified === 1 ? "claim could" : "claims could"} not be verified by this check.`
                  : "A claim stays unverified until the check has enough evidence."}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="ps-card ps-issues">
        <div className="ps-card-heading">
          <h2>
            <CircleAlert size={20} className="ps-green" />
            Recent issues
          </h2>
          <button className="ps-text-link" onClick={onAnalyze}>
            View all issues <ArrowRight size={16} />
          </button>
        </div>
        <div className="ps-issue-list">
          {issues.length ? (
            issues.slice(0, 5).map((finding) => (
              <button className="ps-issue" key={finding.id} onClick={onAnalyze}>
                <span
                  className={`ps-severity ${findingTone(finding) === "review" ? "medium" : "unknown"}`}
                >
                  <i />
                  {findingLabel(finding)}
                </span>
                <span className="ps-issue-copy">
                  <strong>{finding.claim.text}</strong>
                  <span>
                    {finding.explanation[0] ||
                      `Citation ${finding.citation.replaceAll("_", " ")} · Processing ${finding.processing}`}
                  </span>
                </span>
                <ArrowRight size={16} className="ps-issue-arrow" />
              </button>
            ))
          ) : (
            <p className="ps-home-empty">
              {stale
                ? "Run a new check to see issues for this draft."
                : !hasRun || active
                  ? "Issues will appear when a check returns findings."
                  : !findings.length
                    ? "No findings were returned. This does not verify the draft."
                    : "No issues were returned for the reviewed claims."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
