import { useEffect, useRef, useState } from "react";
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
  Upload,
} from "lucide-react";
import { sourceCheckScope } from "./studio-document";
import "./studio-analysis.css";
import StudioDocument, { type CheckMode } from "./StudioDocument";
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
  input?: { mode?: CheckMode };
  coverage: Record<string, unknown>;
};
type Citation = {
  id: string;
  text: string;
  warnings: string[];
  missingMetadata: string[];
};

const runMode = (run: Run) => run.input?.mode ?? "source_check";
const importPending = (status: string) =>
  ["pending", "processing", "running", "queued"].includes(status);

export default function StudioAnalysis({
  work,
  section,
  onUpdated,
  onSave,
  onOpenSources,
}: {
  work: StudioWork;
  section: string;
  onUpdated: () => Promise<void>;
  onSave: (text: string) => Promise<{ runId?: string } | undefined>;
  onOpenSources: () => void;
}) {
  const [sourceSearch, setSourceSearch] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<CheckMode>("source_check");
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
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const active = !!run && ["queued", "running"].includes(run.status);
  const stale =
    !!run &&
    (run.invalidated || run.document_version_id !== work.documentVersionId);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      throw e;
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
        setRun(
          (current) =>
            current ||
            runs.items.find((item) => runMode(item) === modeRef.current),
        );
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
        if (importPending(result.status))
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

  async function openRun(runId?: string) {
    if (!runId) return;
    const next = await api<Run>(`/api/v1/runs/${runId}`);
    setHistory((current) => [next, ...current]);
    setRun(next);
  }
  async function applyFix(findingId: string, documentVersionId: string) {
    const result = await api<{ id: string; runId?: string }>(
      `/api/v1/documents/${work.id}/apply-fix`,
      { approved: true, documentVersionId, findingId },
    );
    return result;
  }
  async function uploadSource(file: File) {
    await action("Uploading source...", async () => {
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
      if (!response.ok) throw Error("Source upload failed. Please retry.");
      await api(`/api/v1/uploads/${intent.id}/complete`, {});
      setSelected((ids) => [...new Set([...ids, intent.id])]);
      await loadSources();
    }).catch(() => {});
  }

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
  const importing = importPending(importStatus);
  const bibliographyReady = !!referenceId && importStatus === "complete";
  const uploadInput = (
    <input
      type="file"
      accept=".pdf,.docx,.txt,.md"
      disabled={!!busy}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadSource(file);
      }}
    />
  );
  const errorNotice = error && (
    <p className="ps-live-error" role="alert">
      {error}
    </p>
  );
  const notices = (
    <>
      {errorNotice}
      {busy && (
        <p className="ps-analysis-busy" role="status">
          <LoaderCircle size={16} className="ps-analysis-spin" />
          {busy}
        </p>
      )}
    </>
  );

  if (section !== "citations") {
    const persistent = !!work.documentVersionId;
    const canStart =
      persistent &&
      !busy &&
      !active &&
      permission &&
      (mode !== "source_check" || bibliographyReady || !!selectedReady.length);
    const setup = !persistent ? (
      <p className="ps-setup-copy">
        This text is saved in this browser. Checks need the workspace service,
        which is unavailable right now.
      </p>
    ) : (
      <div className="ps-setup">
        {mode === "source_check" ? (
          <>
            {sources.length > 0 && (
              <div className="ps-setup-head">
                <strong>Your sources</strong>
                <span>{selectedReady.length} selected</span>
              </div>
            )}
            {sources.length ? (
              <div className="ps-setup-sources">
                {sources.map((source) => {
                  const usable = ready.some((s) => s.id === source.id);
                  return (
                    <label
                      key={`${source.id}:${source.extraction_id || "pending"}`}
                      className={`ps-setup-source ${usable ? "" : "is-waiting"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(source.id)}
                        disabled={!usable}
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
                          {usable
                            ? source.extraction_status === "partial"
                              ? "Some pages could not be read"
                              : "Ready"
                            : "Reading the text…"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="ps-setup-copy">
                Add sources to check your claims against.
              </p>
            )}
            <label className={`ps-setup-upload ${busy ? "is-disabled" : ""}`}>
              <Upload size={16} />
              <span>Upload sources<small>PDF, Word, text, or Markdown</small></span>
              {uploadInput}
            </label>
            <p className="ps-setup-row">
              <BookOpen size={15} />
              <span>
                {bibliographyReady
                  ? `Bibliography included · ${citations.length} ${citations.length === 1 ? "reference" : "references"}`
                  : importing
                    ? "Formatting your bibliography…"
                    : "Bibliography"}
              </span>
              <button className="ps-review-link" onClick={onOpenSources}>
                {bibliographyReady ? "Manage" : "Add references"}
              </button>
            </p>
          </>
        ) : (
          <p className="ps-setup-copy">
            {mode === "fact_check"
              ? "Proof searches open academic research, reads the passages it can access, and compares each claim with them. Titles and abstracts alone never count as support."
              : "Proof searches open academic research for claims that need a source and shows the passages it found. You decide what to cite."}
          </p>
        )}
        <label className="ps-setup-consent">
          <input
            type="checkbox"
            checked={permission}
            onChange={(e) => setPermission(e.target.checked)}
          />
          <span>
            Allow AI providers to process my text
            {mode === "source_check"
              ? " and sources"
              : " and search research"}
            .
          </span>
        </label>
        <button
          className="ps-primary ps-setup-start"
          disabled={!canStart}
          onClick={() =>
            void action("Starting check", async () => {
              const body: RunInput = {
                documentVersionId: work.documentVersionId!,
                mode,
                checkScope: sourceCheckScope(
                  selectedReady.length,
                  bibliographyReady,
                ),
                referenceImportVersionId:
                  mode === "source_check" && bibliographyReady
                    ? referenceId
                    : undefined,
                selectedSources:
                  mode === "source_check"
                    ? selectedReady.map((s) => ({
                        assetId: s.id,
                        extractionId: s.extraction_id!,
                        pageRanges: [],
                      }))
                    : [],
                externalAccess:
                  mode === "source_check"
                    ? bibliographyReady && !selectedReady.length
                      ? "resolve_selected_references"
                      : "none"
                    : "research",
                sourcePolicy:
                  mode === "source_check" ? "user_supplied" : "academic",
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
                throw Error(result.error || "Could not start the check.");
              setFindings([]);
              await openRun(result.id);
            }).catch(() => {})
          }
        >
          {busy === "Starting check" ? (
            <LoaderCircle size={17} className="ps-analysis-spin" />
          ) : (
            <ArrowRight size={17} />
          )}
          {mode === "discover" ? "Find sources" : "Check my text"}
        </button>
        {permission && mode === "source_check" && !selectedReady.length && !bibliographyReady && (
          <p className="ps-setup-hint">
            {sources.length ? "Select a source or add references to continue." : "Upload a source or add references to continue."}
          </p>
        )}
      </div>
    );
    return (
      <div className="ps-live ps-live-workspace">
        {errorNotice}
        <StudioDocument
          content={work.content}
          findings={findings}
          run={
            run && {
              ...run,
              carried: typeof run.coverage?.carriedFrom === "string",
            }
          }
          stale={stale}
          active={active}
          locked={!!busy}
          mode={mode}
          canCheck={persistent}
          onMode={(next) => {
            if (next === mode) return;
            setMode(next);
            setPermission(false);
            setFindings([]);
            setRun(history.find((item) => runMode(item) === next));
          }}
          setup={setup}
          sourceTitle={(id) =>
            sources.find((source) => source.id === id)?.metadata.title
          }
          onSave={async (text) => {
            const result = await onSave(text);
            if (result?.runId) await openRun(result.runId);
          }}
          onAccept={(finding) =>
            action("Applying edit", async () => {
              if (!work.documentVersionId) return;
              const result = await applyFix(finding.id, work.documentVersionId);
              await onUpdated();
              await openRun(result.runId);
            }).catch(() => {})
          }
          onAcceptAll={(chosen) =>
            action("Applying edits", async () => {
              let version = work.documentVersionId!;
              let current = chosen.map((finding) => finding.id);
              const keys = new Set(
                chosen.map(
                  (finding) =>
                    `${finding.claim.text}\u0000${finding.fix?.original}`,
                ),
              );
              let runId: string | undefined;
              while (current.length) {
                const result = await applyFix(current[0], version);
                version = result.id;
                runId = result.runId;
                if (!runId) break;
                const page = await api<{ items: BackendFinding[] }>(
                  `/api/v1/runs/${runId}/findings?limit=100&offset=0`,
                );
                current = page.items
                  .filter(
                    (finding) =>
                      finding.fix &&
                      keys.has(
                        `${finding.claim.text}\u0000${finding.fix.original}`,
                      ),
                  )
                  .map((finding) => finding.id);
              }
              await onUpdated();
              await openRun(runId);
            }).catch(() => {})
          }
          onCancel={() =>
            run &&
            void action("Cancelling", async () => {
              await api(`/api/v1/runs/${run.id}/cancel`, {});
              setRun(await api<Run>(`/api/v1/runs/${run.id}`));
            }).catch(() => {})
          }
        />
      </div>
    );
  }

  return (
    <div className="ps-live">
      {notices}
      <div className="ps-detail-heading">
        <div>
          <h2>Sources & citations</h2>
          <p>
            Upload the sources you cite and keep your references consistent.
          </p>
        </div>
        <span className="ps-pill">
          <BookOpen size={16} />
          MLA 9
        </span>
      </div>
      <div className="ps-analysis-layout ps-analysis-citations">
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
            Sources you upload here can be used in “My sources” checks.
          </p>
          <label className={`ps-analysis-upload ${busy ? "is-disabled" : ""}`}>
            <Upload size={22} />
            <strong>Upload a source</strong>
            <span>PDF, DOCX, TXT, or Markdown</span>
            {uploadInput}
          </label>
          <p className="ps-analysis-provenance">
            <CircleHelp size={14} />
            Proof has not independently confirmed the origin of uploaded
            sources. Checks cover the text Proof can extract.
          </p>
          {sources.length > 0 && (
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
          )}
          {!sources.length && (
            <div className="ps-analysis-empty">
              <BookOpen size={26} />
              <strong>No sources yet</strong>
              <p>
                Upload a paper or book excerpt to check your text against it.
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
        <section className="ps-card ps-citations ps-live-panel ps-analysis-bibliography">
          <div className="ps-analysis-heading">
            <div>
              <BookOpen size={19} />
              <h2>MLA bibliography</h2>
            </div>
          </div>
          <p className="ps-analysis-intro">
            Paste your references to format them in MLA. Review missing details
            before you use the result.
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
            disabled={!!busy || !bibliography.trim() || importing}
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
              }).catch(() => {})
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
                <article className="ps-source ps-analysis-citation" key={c.id}>
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
                        }).catch(() => {})
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
      </div>
    </div>
  );
}
