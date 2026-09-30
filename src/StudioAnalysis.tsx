import { useEffect, useState } from "react";
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
  return (
    <div className="ps-live">
      {error && (
        <p className="ps-live-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {section === "dashboard" && (
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
      )}
      {section !== "dashboard" && (
        <>
          <section className="ps-home-panel ps-live-panel">
            <h2>Source library</h2>
            <p>
              Upload sources you want to check against. Uploaded material has
              unverified provenance.
            </p>
            <label className="ps-field-label">
              Upload PDF, DOCX, or text
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
            {!sources.length && <p>No sources uploaded.</p>}
            {sources.map((source) => (
              <label
                className="ps-source-option"
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
                <span>
                  <strong>{source.metadata.title}</strong>
                  <small>
                    {source.status} ·{" "}
                    {source.extraction_status || "awaiting extraction"} ·{" "}
                    {source.access} · eligibility {source.eligibility}
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
          </section>
          {section === "citations" ? (
            <section className="ps-home-panel ps-live-panel">
              <h2>MLA citations</h2>
              <p>
                Paste a bibliography to parse and format. Review missing
                metadata before using the citations.
              </p>
              <textarea
                className="ps-editor"
                aria-label="Bibliography"
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
                Format bibliography
              </button>
              {importStatus && <p role="status">Import {importStatus}</p>}
              {citations.map((c) => (
                <article key={c.id}>
                  <p>{c.text}</p>
                  {[
                    ...c.warnings,
                    ...c.missingMetadata.map((m) => `Missing: ${m}`),
                  ].map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                  <button
                    className="ps-outline"
                    onClick={() =>
                      void action("Copying citation...", () =>
                        navigator.clipboard.writeText(c.text),
                      )
                    }
                  >
                    Copy citation
                  </button>
                </article>
              ))}
            </section>
          ) : (
            <>
              <section className="ps-home-panel ps-live-panel">
                <h2>Run analysis</h2>
                <label className="ps-field-label">
                  Check type
                  <select
                    className="ps-field"
                    value={mode}
                    disabled={!!busy || !!active}
                    onChange={(e) => {
                      setMode(e.target.value as RunInput["mode"]);
                      setPermission(false);
                    }}
                  >
                    <option value="source_check">
                      Check against selected sources
                    </option>
                    <option value="discover">
                      Find research for this draft
                    </option>
                    <option value="fact_check">
                      Check against public research
                    </option>
                  </select>
                </label>
                <label className="ps-source-option">
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
                  Start analysis
                </button>
              </section>
              {history.length > 1 && (
                <label className="ps-field-label">
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
                <section className="ps-home-panel ps-live-panel">
                  <h2>Analysis results</h2>
                  <p role="status">
                    {run.status} · {run.stage} · {findings.length} findings
                  </p>
                  {stale && (
                    <p role="alert">
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
                  {findings.map((finding) => (
                    <article className="ps-live-finding" key={finding.id}>
                      <h3>{finding.support.replaceAll("_", " ")}</h3>
                      <blockquote>{finding.claim.text}</blockquote>
                      <p>
                        Citation {finding.citation.replaceAll("_", " ")} ·
                        Processing {finding.processing} · Eligibility{" "}
                        {finding.eligibility}
                      </p>
                      {finding.explanation.map((text, i) => (
                        <p key={i}>{text}</p>
                      ))}
                      {finding.evidence.map((passage, i) => (
                        <details key={`${passage.id}:${i}`}>
                          <summary>
                            Source passage · {passage.role} · physical page{" "}
                            {passage.pageIndex}
                            {passage.pageLabel
                              ? ` · printed label ${passage.pageLabel}`
                              : ""}
                          </summary>
                          <blockquote>{passage.text}</blockquote>
                          <p>{passage.support.replaceAll("_", " ")}</p>
                        </details>
                      ))}
                      {finding.fix && (
                        <details>
                          <summary>Review suggested edit</summary>
                          <p>Original: {finding.fix.original}</p>
                          <p>Replacement: {finding.fix.replacement}</p>
                          <button
                            className="ps-outline"
                            disabled={!!busy || !!stale || !!active}
                            onClick={() =>
                              void action(
                                "Applying approved edit...",
                                async () => {
                                  await api(
                                    `/api/v1/documents/${work.id}/apply-fix`,
                                    {
                                      approved: true,
                                      documentVersionId: work.documentVersionId,
                                      findingId: finding.id,
                                    },
                                  );
                                  await onUpdated();
                                  setRun(
                                    await api<Run>(`/api/v1/runs/${run.id}`),
                                  );
                                },
                              )
                            }
                          >
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
        </>
      )}
    </div>
  );
}
