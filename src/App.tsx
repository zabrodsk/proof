import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FileText,
  FileUp,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Audit, Finding, Mode, Source, Status } from "../shared/types";
import { labels, accessLabels } from "../shared/types";
import { demoText, demoTitle } from "../shared/demo";
import FindingDetail from "./FindingDetail";
import { DocumentIllustration, DrawnIcon, InkUnderline } from "./Drawn";
import MlaCitations, { CitationText } from "./MlaCitations";
import { uniqueMlaSources, type MlaSource } from "../shared/mla";

type Draft = {
  text: string;
  title: string;
  example: boolean;
  mlaSources?: MlaSource[];
};
type View = "document" | "sources";
type Filter = "all" | "issues" | "supported" | "unverified";
const storageKey = "proof.draft.v1";
function initialDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      saved &&
      typeof saved.text === "string" &&
      typeof saved.title === "string"
    )
      return saved;
  } catch {}
  return { text: demoText, title: demoTitle, example: true };
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers:
            body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" },
          body: body instanceof FormData ? body : JSON.stringify(body),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}
const unverified = (f: Finding) =>
  ["uncertain", "source_unavailable"].includes(f.status);
const issue = (f: Finding) => f.status !== "supported" && !unverified(f);
const tone = (status: Status) =>
  status === "supported"
    ? "green"
    : unverified({ status } as Finding)
      ? "slate"
      : status === "contradicted"
        ? "red"
        : "amber";
function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  return status === "supported" ? (
    <CircleCheck size={size} />
  ) : unverified({ status } as Finding) ? (
    <CircleHelp size={size} />
  ) : (
    <CircleAlert size={size} />
  );
}
function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status-badge ${tone(status)}`}>
      <StatusIcon status={status} />
      {labels[status]}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className={wide ? "modal wide" : "modal"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
async function download(name: string, text: string, type = "text/plain") {
  const { url } = await api<{ url: string }>("/api/exports", {
    name,
    text,
    type,
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}

export default function App() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [view, setView] = useState<View>("document");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [mode, setMode] = useState<Mode>("audit");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [undo, setUndo] = useState<{
    draft: Draft;
    audit: Audit | null;
    applied: string[];
  } | null>(null);
  const [dialog, setDialog] = useState<
    "new" | "source" | "privacy" | "mla" | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<{ jevConfigured: boolean } | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [mlaSource, setMlaSource] = useState<Source | undefined>();
  const [saveError, setSaveError] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const stale = !!audit && audit.text !== draft.text;
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [draft]);
  useEffect(() => {
    api<{ jevConfigured: boolean }>("/api/health")
      .then(setHealth)
      .catch(() =>
        setError(
          "Could not connect to Proof. Start the local server and reload.",
        ),
      );
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebar(false);
        setExportOpen(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const findings = audit?.findings || [];
  const activeFindings = findings.filter(
    (f) => !ignored.includes(f.id) && !applied.includes(f.id),
  );
  const filtered = activeFindings.filter(
    (f) =>
      filter === "all" ||
      (filter === "issues" && issue(f)) ||
      (filter === "supported" && f.status === "supported") ||
      (filter === "unverified" && unverified(f)),
  );
  const selectedFinding = findings.find((f) => f.id === selected);
  const selectedSource = sources.find(
    (s) => s.id === selectedFinding?.sourceId,
  );
  const counts = {
    issues: activeFindings.filter(issue).length,
    supported: activeFindings.filter((f) => f.status === "supported").length,
    unverified: activeFindings.filter(unverified).length,
  };
  const words = draft.text.trim().split(/\s+/).filter(Boolean).length;
  const readMinutes = Math.max(1, Math.ceil(words / 200));
  const goView = (v: View) => {
    setView(v);
    setSidebar(false);
  };
  const runAudit = async () => {
    setBusy(true);
    setError("");
    setSelected(null);
    setEditing(false);
    setView("document");
    try {
      const result = await api<Audit>("/api/audit", {
        text: draft.text,
        mode,
        sourceIds: sources.map((s) => s.id),
      });
      setAudit(result);
      setSources(result.sources);
      setIgnored([]);
      setApplied([]);
      setFilter("all");
      setUndo(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const replaceDraft = (next: Draft) => {
    setDraft(next);
    setAudit(null);
    setSources([]);
    setIgnored([]);
    setApplied([]);
    setSelected(null);
    setError("");
    setEditing(false);
    setDialog(null);
    setView("document");
    setUndo(null);
  };
  const importFile = async (file: File) => {
    setImportBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      const result = await api<{ text: string; title: string }>(
        "/api/documents/import",
        data,
      );
      replaceDraft({ ...result, example: false });
      setNotice(
        "Document imported. Review the extracted text before auditing.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };
  const applyFix = (finding: Finding) => {
    if (!finding.fix || stale) return;
    if (draft.text.slice(finding.start, finding.end) !== finding.text) {
      setError(
        "The document has changed. Run a new audit before applying this fix.",
      );
      return;
    }
    setUndo({ draft, audit, applied });
    setDraft({
      ...draft,
      text:
        draft.text.slice(0, finding.start) +
        finding.fix +
        draft.text.slice(finding.end),
      example: false,
    });
    setApplied([...applied, finding.id]);
    setSelected(null);
    setNotice(
      "Correction applied. Run a new audit to check the revised document.",
    );
  };
  const exportReport = () => {
    if (!audit) return;
    download(
      "proof-audit.md",
      `# Proof audit\n\n${draft.title}\nChecked ${new Date(audit.createdAt).toLocaleString()}\nMode: ${audit.mode}\n${stale ? "\nThis report refers to an earlier version of the document.\n" : ""}\n` +
        audit.findings
          .map(
            (f) =>
              `## ${labels[f.status]}\n\n${f.text}\n\n${f.explanation}\n\n${f.evidence ? "> " + f.evidence + "\n\n" : ""}${
                f.sourceId
                  ? (() => {
                      const s = audit.sources.find((s) => s.id === f.sourceId);
                      return s
                        ? `Source: ${s.title}\nAccess: ${accessLabels[s.access]}\n${s.url || ""}\n`
                        : "";
                    })()
                  : ""
              }Method: ${f.method}\n${f.model ? "Model: " + f.model + "\n" : ""}`,
          )
          .join("\n") +
        (audit.notices.length
          ? "\n## Notes\n\n" + audit.notices.join("\n")
          : "") +
        "\n## Audited document\n\n" +
        audit.text,
      "text/markdown",
    ).catch((error: Error) => setError(error.message));
    setExportOpen(false);
  };
  const renderText = () => {
    const blocks = [...draft.text.matchAll(/[^\n]+/g)];
    return blocks.map((match, index) => {
      const start = match.index!,
        end = start + match[0].length;
      if (index === 0 && !/[.!?]$/.test(match[0]) && match[0].length < 100)
        return <h1 key={start}>{match[0]}</h1>;
      if (/^(works cited|references|bibliography)$/i.test(match[0].trim()))
        return (
          <h3 className="bibliography-title" key={start}>
            {match[0]}
          </h3>
        );
      const overlaps = !stale
        ? findings.filter((f) => f.start >= start && f.end <= end)
        : [];
      const fragments: ReactNode[] = [];
      let cursor = start;
      for (const finding of overlaps) {
        fragments.push(draft.text.slice(cursor, finding.start));
        fragments.push(
          <button
            key={finding.id}
            id={finding.id}
            className={`claim-highlight ${tone(finding.status)} ${selected === finding.id ? "selected" : ""} ${ignored.includes(finding.id) ? "ignored" : ""}`}
            onClick={() => {
              setSelected(finding.id);
              setView("document");
            }}
            title={labels[finding.status]}
          >
            {finding.text}
          </button>,
        );
        cursor = finding.end;
      }
      fragments.push(draft.text.slice(cursor, end));
      const isRef = draft.text
        .slice(0, start)
        .match(/^\s*(works cited|references|bibliography)\s*$/im);
      return (
        <p key={start} className={isRef ? "reference-text" : ""}>
          {isRef ? <CitationText text={match[0]} /> : fragments}
        </p>
      );
    });
  };
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        inert={compact && !sidebar}
        className={`sidebar ${sidebar ? "open" : ""}`}
      >
        <a
          className="brand"
          aria-label="Proof home"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            goView("document");
          }}
        >
          <img
            className="proof-logo-mark"
            src="/images/proof-logo-drawn-v1.png"
            alt=""
            width="44"
            height="44"
          />
          <span>
            proof<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="new-document"
          onClick={() => setDialog("new")}
          disabled={busy}
        >
          <Plus size={17} />
          New document
        </button>
        <nav aria-label="Main navigation">
          <button
            className={view === "document" ? "nav-item active" : "nav-item"}
            aria-pressed={view === "document"}
            onClick={() => goView("document")}
          >
            <DrawnIcon name="document" size={23} />
            My document
          </button>
          <button
            className={view === "sources" ? "nav-item active" : "nav-item"}
            aria-pressed={view === "sources"}
            onClick={() => goView("sources")}
          >
            <DrawnIcon name="library" size={23} />
            Sources<span className="nav-count">{sources.length}</span>
          </button>
        </nav>
        <div className="sidebar-section">
          <span>Current document</span>
          <button
            className="icon-button small"
            aria-label="Create a document"
            onClick={() => setDialog("new")}
            disabled={busy}
          >
            <Plus size={14} />
          </button>
        </div>
        <button className="document-link" onClick={() => goView("document")}>
          <span className="document-mini">
            <FileText size={14} />
          </span>
          <span>
            {draft.title}
            <small>
              {draft.example ? "Example document" : "Saved in this browser"}
            </small>
          </span>
        </button>
        <div className="sidebar-bottom">
          <button className="privacy-link" onClick={() => setDialog("privacy")}>
            <CircleHelp size={15} />
            How Proof checks your work
            <ArrowUpRight size={14} />
          </button>
          <div className="workspace-label">
            <span className="avatar">P</span>
            <span>
              Personal workspace<small>Evidence review</small>
            </span>
            <span
              className={`connection-dot ${health?.jevConfigured ? "connected" : ""}`}
              title={
                health?.jevConfigured ? "Jev configured" : "Jev not configured"
              }
            />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={sidebar}
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={14} />
            <span>{view === "sources" ? "Sources" : draft.title}</span>
          </div>
          <div className="top-actions">
            <span className="saved-state">
              <span />
              {saveError
                ? "Not saved"
                : busy
                  ? "Checking evidence"
                  : "Saved locally"}
            </span>
            <div className="export-container">
              <button
                className="button secondary compact"
                onClick={() => setExportOpen(!exportOpen)}
                aria-expanded={exportOpen}
              >
                <ArrowDownToLine size={15} />
                Export
                <ChevronDown size={13} />
              </button>
              {exportOpen && (
                <div className="export-menu">
                  <button
                    onClick={() => {
                      download(`${draft.title}.txt`, draft.text).catch(
                        (error: Error) => setError(error.message),
                      );
                      setExportOpen(false);
                    }}
                  >
                    Download document .txt
                  </button>
                  <button disabled={!audit} onClick={exportReport}>
                    Download audit report .md
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {view === "document" ? (
          <>
            <section className="page-heading">
              <div>
                <h2>
                  Check your{" "}
                  <span className="ink-word">
                    citations.
                    <InkUnderline />
                  </span>
                </h2>
                <p>Compare your claims with their sources.</p>
              </div>
              <div className="heading-actions">
                <button
                  className="button secondary"
                  disabled={busy || importBusy}
                  onClick={() => importRef.current?.click()}
                >
                  {importBusy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <DrawnIcon name="upload" size={21} />
                  )}
                  Import document
                </button>
                <button
                  className="button primary"
                  onClick={runAudit}
                  disabled={busy || draft.text.trim().length < 20}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <CheckCheck size={18} />
                  )}{" "}
                  {busy ? "Checking…" : audit ? "Run again" : "Check document"}
                  {!busy && <ArrowRight size={16} />}
                </button>
              </div>
            </section>
            <section className="workspace-grid">
              <div className="document-column">
                <div className="document-toolbar">
                  <div className="segmented" aria-label="Document view">
                    <button
                      className={!editing ? "selected" : ""}
                      aria-pressed={!editing}
                      onClick={() => setEditing(false)}
                    >
                      <DrawnIcon name="book" size={18} />
                      Read
                    </button>
                    <button
                      disabled={busy}
                      className={editing ? "selected" : ""}
                      aria-pressed={editing}
                      onClick={() => {
                        setEditing(true);
                        setSelected(null);
                      }}
                    >
                      <DrawnIcon name="pen" size={18} />
                      Edit
                    </button>
                  </div>
                  <div className="document-meta">
                    <button
                      className="mla-toolbar-button"
                      disabled={busy}
                      onClick={() => {
                        setMlaSource(undefined);
                        setDialog("mla");
                      }}
                    >
                      <BookOpen size={15} />
                      MLA citations
                    </button>
                    <span>{words} words</span>
                    <button
                      className="icon-button"
                      aria-label="Add a source"
                      disabled={busy}
                      onClick={() => setDialog("source")}
                    >
                      <Link2 size={17} />
                    </button>
                  </div>
                </div>
                {(stale || undo) && (
                  <div className="stale-banner">
                    <RotateCcw size={15} />
                    <span>
                      {stale
                        ? "Document changed. Run again to refresh the findings."
                        : "Document updated."}
                    </span>
                    {undo && (
                      <button
                        onClick={() => {
                          setDraft(undo.draft);
                          setAudit(undo.audit);
                          setApplied(undo.applied);
                          setUndo(null);
                          setNotice("Change undone.");
                        }}
                      >
                        Undo change
                      </button>
                    )}
                  </div>
                )}
                <article
                  className={`paper ${editing ? "editing" : ""}`}
                  aria-label="Document"
                >
                  <div className="paper-meta">
                    <span>
                      {draft.example ? "Sample research note" : "Working draft"}
                    </span>
                    <span>{readMinutes} min read</span>
                  </div>
                  {editing ? (
                    <>
                      <label className="field-label" htmlFor="document-title">
                        Document name
                      </label>
                      <input
                        id="document-title"
                        className="title-input"
                        value={draft.title}
                        maxLength={120}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            title: e.target.value,
                            example: false,
                          })
                        }
                      />
                      <label className="sr-only" htmlFor="document-text">
                        Document text
                      </label>
                      <textarea
                        id="document-text"
                        ref={editorRef}
                        value={draft.text}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            text: e.target.value,
                            example: false,
                          })
                        }
                        spellCheck={false}
                        maxLength={150000}
                      />
                    </>
                  ) : (
                    <div className="paper-content">{renderText()}</div>
                  )}
                  <div className="paper-footer">
                    <span>Proof</span>
                    <span>End of document</span>
                  </div>
                </article>
                <div className="document-caption">
                  <ShieldCheck size={14} />
                  <span>Changes are applied only when you choose them.</span>
                  <button onClick={() => setDialog("privacy")}>
                    About verification
                  </button>
                </div>
              </div>
              <aside className="audit-panel" aria-label="Evidence audit">
                <div className="audit-panel-head">
                  <span className="audit-symbol">
                    <DrawnIcon name="pen" size={23} />
                  </span>
                  <h3>Evidence check</h3>
                  {audit && !busy && (
                    <span
                      className="checked-time"
                      title={new Date(audit.createdAt).toLocaleString()}
                    >
                      <Check size={12} />
                      Checked
                    </span>
                  )}
                </div>
                <div className="mode-row">
                  <div className="mode-switch">
                    <button
                      className={mode === "audit" ? "active" : ""}
                      aria-pressed={mode === "audit"}
                      onClick={() => setMode("audit")}
                      disabled={busy}
                    >
                      Audit
                    </button>
                    <button
                      className={mode === "strict" ? "active" : ""}
                      aria-pressed={mode === "strict"}
                      onClick={() => setMode("strict")}
                      disabled={busy}
                    >
                      Strict
                      <span className="strict-dot" />
                    </button>
                  </div>
                  <span className="mode-description">
                    {mode === "audit"
                      ? "Existing citations"
                      : "Includes uncited claims"}
                  </span>
                </div>
                {busy ? (
                  <div className="audit-loading" role="status">
                    <div className="loading-symbol">
                      <Search size={27} />
                      <span />
                    </div>
                    <h4>Checking your citations...</h4>
                    <p>
                      Resolving sources and comparing each claim with the
                      relevant passages.
                    </p>
                    <div className="loading-line" />
                    <small>You can keep reading while Proof checks.</small>
                  </div>
                ) : !audit ? (
                  <div className="audit-empty">
                    <DocumentIllustration kind="notebook" />
                    <h4>Ready to check.</h4>
                    <p>
                      See where your sources support your claims and where
                      something needs a closer look.
                    </p>
                    <button
                      className="button primary"
                      onClick={runAudit}
                      disabled={draft.text.trim().length < 20}
                    >
                      <CheckCheck size={17} />
                      Check document
                      <ArrowRight size={15} />
                    </button>
                    <div className="empty-steps">
                      <span>
                        <DrawnIcon name="book" size={20} />
                        Find the cited source
                      </span>
                      <span>
                        <DrawnIcon name="document" size={20} />
                        Compare the evidence
                      </span>
                      <span>
                        <DrawnIcon name="pen" size={20} />
                        Review, then revise
                      </span>
                    </div>
                    {health && !health.jevConfigured && (
                      <p className="connection-warning">
                        Jev needs a TypeSafe API key. Source retrieval works,
                        but semantic checks will remain unverified.
                      </p>
                    )}
                  </div>
                ) : selectedFinding ? (
                  <FindingDetail
                    key={selectedFinding.id}
                    finding={selectedFinding}
                    source={selectedSource}
                    position={findings.indexOf(selectedFinding) + 1}
                    total={findings.length}
                    stale={stale}
                    applied={applied.includes(selectedFinding.id)}
                    ignored={ignored.includes(selectedFinding.id)}
                    onBack={() => setSelected(null)}
                    onApply={() => applyFix(selectedFinding)}
                    onEdit={() => {
                      setEditing(true);
                      setSelected(null);
                      requestAnimationFrame(() => {
                        const editor = editorRef.current;
                        editor?.focus();
                        if (!stale)
                          editor?.setSelectionRange(
                            selectedFinding.start,
                            selectedFinding.end,
                          );
                        editor?.scrollIntoView({ block: "center" });
                      });
                    }}
                    onAddSource={() => setDialog("source")}
                    onRecheck={runAudit}
                    onIgnore={() => {
                      setIgnored(
                        ignored.includes(selectedFinding.id)
                          ? ignored.filter((id) => id !== selectedFinding.id)
                          : [...ignored, selectedFinding.id],
                      );
                      setSelected(null);
                    }}
                    onPrevious={() =>
                      setSelected(
                        findings[findings.indexOf(selectedFinding) - 1].id,
                      )
                    }
                    onNext={() =>
                      setSelected(
                        findings[findings.indexOf(selectedFinding) + 1].id,
                      )
                    }
                  />
                ) : (
                  <div className="audit-results">
                    <div className="results-title">
                      <h4>
                        {stale
                          ? "Previous audit"
                          : counts.issues
                            ? "Claims to review"
                            : counts.unverified
                              ? "Claims need more evidence"
                              : "Check complete"}
                      </h4>
                      <p>
                        {findings.length}{" "}
                        {findings.length === 1 ? "claim" : "claims"} reviewed
                        {audit.mode === "strict" ? " in strict mode" : ""}
                      </p>
                    </div>
                    <div className="summary-grid">
                      <button
                        onClick={() =>
                          setFilter(
                            filter === "supported" ? "all" : "supported",
                          )
                        }
                        className={`summary-item green ${filter === "supported" ? "chosen" : ""}`}
                      >
                        <span>{counts.supported}</span>
                        <small>
                          <CircleCheck size={12} />
                          Supported
                        </small>
                      </button>
                      <button
                        onClick={() =>
                          setFilter(filter === "issues" ? "all" : "issues")
                        }
                        className={`summary-item amber ${filter === "issues" ? "chosen" : ""}`}
                      >
                        <span>{counts.issues}</span>
                        <small>
                          <CircleAlert size={12} />
                          To review
                        </small>
                      </button>
                      <button
                        onClick={() =>
                          setFilter(
                            filter === "unverified" ? "all" : "unverified",
                          )
                        }
                        className={`summary-item slate ${filter === "unverified" ? "chosen" : ""}`}
                      >
                        <span>{counts.unverified}</span>
                        <small>
                          <CircleHelp size={12} />
                          Unverified
                        </small>
                      </button>
                    </div>
                    <div className="findings-heading">
                      <span>
                        {filter === "all"
                          ? "All findings"
                          : filter === "issues"
                            ? "Needs review"
                            : filter === "supported"
                              ? "Supported claims"
                              : "Unverified claims"}
                      </span>
                      {filter !== "all" && (
                        <button onClick={() => setFilter("all")}>
                          Show all
                        </button>
                      )}
                    </div>
                    <div className="findings-list">
                      {filtered.map((finding, index) => (
                        <button
                          className="finding-row"
                          key={finding.id}
                          onClick={() => {
                            setSelected(finding.id);
                            document
                              .getElementById(finding.id)
                              ?.scrollIntoView({
                                block: "center",
                                behavior: "instant",
                              });
                          }}
                        >
                          <span
                            className={`finding-marker ${tone(finding.status)}`}
                          >
                            <StatusIcon status={finding.status} size={17} />
                          </span>
                          <span>
                            <span
                              className={`finding-status ${tone(finding.status)}`}
                            >
                              {labels[finding.status]}
                            </span>
                            <span className="finding-preview">
                              {finding.text}
                            </span>
                            <span className="finding-citation">
                              {finding.citations[0] || "No citation"}
                            </span>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                      {!filtered.length && (
                        <div className="no-findings">
                          <CircleCheck size={23} />
                          <p>
                            {findings.length
                              ? "No findings in this view."
                              : "No claims found with recognized citations."}
                          </p>
                          {!findings.length && (
                            <span>
                              Try Strict mode or add author-year citations.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {ignored.length > 0 && (
                      <button
                        className="restore-button"
                        onClick={() => setIgnored([])}
                      >
                        <RotateCcw size={13} />
                        Restore {ignored.length} ignored{" "}
                        {ignored.length === 1 ? "finding" : "findings"}
                      </button>
                    )}
                    {!!audit.notices.length && (
                      <details className="audit-notices">
                        <summary>
                          {audit.notices.length}{" "}
                          {audit.notices.length === 1
                            ? "audit note"
                            : "audit notes"}
                        </summary>
                        {audit.notices.map((note, i) => (
                          <p key={i}>{note}</p>
                        ))}
                      </details>
                    )}
                    <div className="audit-footnote">
                      <ShieldCheck size={14} />
                      <p>
                        A judgment is only as complete as its evidence. Open a
                        finding to see exactly what was checked.
                      </p>
                    </div>
                  </div>
                )}
              </aside>
            </section>
          </>
        ) : (
          <section className="sources-page">
            <div className="page-heading">
              <div>
                <h2>
                  Your{" "}
                  <span className="ink-word">
                    sources.
                    <InkUnderline />
                  </span>
                </h2>
                <p>The papers used to check your document.</p>
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setDialog("source")}
              >
                <Plus size={17} />
                Add source
              </button>
            </div>
            <div className="sources-search">
              <Search size={17} />
              <input
                aria-label="Search sources"
                placeholder="Search by title, author, or DOI"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
              />
              <span>{sources.length} sources</span>
            </div>
            {!sources.length ? (
              <div className="sources-empty">
                <DocumentIllustration kind="thesis" />
                <div className="sources-empty-copy">
                  <h3>Add your first paper.</h3>
                  <p>
                    Add a DOI or upload a paper. Proof also finds sources from
                    your document's bibliography during an audit.
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => setDialog("source")}
                  >
                    <Plus size={16} />
                    Add your first source
                  </button>
                </div>
              </div>
            ) : (
              <div className="source-list">
                {sources
                  .filter((s) =>
                    `${s.title} ${s.authors.join(" ")} ${s.doi}`
                      .toLowerCase()
                      .includes(sourceSearch.toLowerCase()),
                  )
                  .map((source) => (
                    <article className="source-card" key={source.id}>
                      <span className="source-card-icon">
                        <DrawnIcon name="book" size={28} />
                      </span>
                      <div>
                        <span className="source-card-meta">
                          {source.journal || "Uploaded source"} · {source.year}
                        </span>
                        <h3>{source.title}</h3>
                        <p>
                          {source.authors.slice(0, 3).join(", ")}
                          {source.authors.length > 3 ? ", et al." : ""}
                        </p>
                        <div className="source-card-badges">
                          <span
                            className={`access-pill ${source.passages.length ? "available" : ""}`}
                          >
                            {source.passages.length ? (
                              <CircleCheck size={13} />
                            ) : (
                              <CircleHelp size={13} />
                            )}{" "}
                            {accessLabels[source.access]}
                          </span>
                          <span>
                            {source.passages.length} extracted passages
                          </span>
                        </div>
                        <details>
                          <summary>Source details</summary>
                          <p>{source.notice}</p>
                          <p>
                            {source.provider} · Retrieved{" "}
                            {new Date(source.retrievedAt).toLocaleString()}
                          </p>
                          {source.doi && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.doi}
                              <ArrowUpRight size={12} />
                            </a>
                          )}
                        </details>
                      </div>
                      <div className="source-card-actions">
                        <button
                          className="button secondary compact"
                          disabled={busy}
                          onClick={() => {
                            setMlaSource(source);
                            setDialog("mla");
                          }}
                        >
                          <BookOpen size={14} />
                          Cite in MLA
                        </button>
                        {source.url && (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-button"
                            aria-label="Open source"
                          >
                            <ArrowUpRight size={18} />
                          </a>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Remove ${source.title}`}
                          disabled={busy}
                          onClick={() => {
                            setSources(
                              sources.filter((s) => s.id !== source.id),
                            );
                            setAudit(null);
                            setSelected(null);
                            setNotice("Source removed from this document.");
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>
        )}
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".docx,.pdf,.txt,.md"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog === "new" && (
        <NewDocumentModal
          onClose={() => setDialog(null)}
          onCreate={replaceDraft}
          importFile={() => importRef.current?.click()}
          hasDraft={!!draft.text.trim()}
        />
      )}
      {dialog === "source" && (
        <AddSourceModal
          onClose={() => setDialog(null)}
          onAdd={(source) => {
            setSources((prev) =>
              prev.some((s) => s.id === source.id) ? prev : [...prev, source],
            );
            setDialog(null);
            setNotice(
              "Source added. Run an audit to check it against your claims.",
            );
          }}
        />
      )}
      {dialog === "mla" && (
        <Modal title="MLA citations" onClose={() => setDialog(null)} wide>
          <MlaCitations
            text={draft.text}
            sources={sources}
            saved={draft.mlaSources || []}
            initialSource={mlaSource}
            onSource={(source) =>
              setSources((prev) =>
                prev.some((s) => s.id === source.id) ? prev : [...prev, source],
              )
            }
            onChange={(text, source) => {
              if (text.length > 150000)
                throw new Error(
                  "This change would exceed the 150,000 character document limit.",
                );
              setUndo({ draft, audit, applied });
              setDraft({
                ...draft,
                text,
                example: false,
                mlaSources: source
                  ? uniqueMlaSources([...(draft.mlaSources || []), source])
                  : draft.mlaSources,
              });
              setSelected(null);
            }}
            canUndo={!!undo}
            onUndo={() => {
              if (!undo) return;
              setDraft(undo.draft);
              setAudit(undo.audit);
              setApplied(undo.applied);
              setUndo(null);
            }}
          />
        </Modal>
      )}
      {dialog === "privacy" && (
        <Modal title="What Proof checks" onClose={() => setDialog(null)}>
          <div className="privacy-content">
            <p>
              Proof compares cited claims with passages from scholarly sources.
              Each finding shows its source and the text used for the judgment.
            </p>
            <h3>Read the evidence, too.</h3>
            <p>
              Full-text access means the paper was retrieved. Jev checks
              selected passages, not every sentence. Abstract-only and uploaded
              sources are labeled. Journal metadata alone does not prove peer
              review.
            </p>
            <h3>Your document and services</h3>
            <p>
              Your working draft saves in this browser. The server holds sources
              in memory. Audits send individual claims and selected source
              passages to TypeSafe's Jev model. Bibliography searches go to
              Crossref and Europe PMC.
            </p>
            <h3>First-version limits</h3>
            <p>
              Use author-year or MLA author-page citations. Add a DOI to the
              bibliography for reliable matching. Multiple sources in one
              sentence need separate checks. Missing-citation detection is a
              heuristic. Scanned PDFs need OCR first. Files can be up to 12 MB,
              and audits up to 60 candidate claims.
            </p>
            <p>
              PDF and Word imports extract text. They do not preserve page
              layout or Word formatting. Exports contain the current plain-text
              draft or the audit report.
            </p>
            <div className="service-status">
              <span
                className={`connection-dot ${health?.jevConfigured ? "connected" : ""}`}
              />
              {health?.jevConfigured
                ? "Jev is configured on the server."
                : "Jev is not configured. Set TYPESAFE_API_KEY on the server, or use the existing macOS Keychain record."}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewDocumentModal({
  onClose,
  onCreate,
  importFile,
  hasDraft,
}: {
  onClose: () => void;
  onCreate: (draft: Draft) => void;
  importFile: () => void;
  hasDraft: boolean;
}) {
  const [title, setTitle] = useState("Untitled document");
  const [text, setText] = useState("");
  return (
    <Modal title="New document" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            title: title.trim() || "Untitled document",
            text: text.trim(),
            example: false,
          });
        }}
        className="dialog-form"
      >
        <div className="document-intro">
          <DocumentIllustration />
          <p>Paste your writing and bibliography, or import a document.</p>
        </div>
        {hasDraft && (
          <p className="replace-note">
            This replaces the current draft. Export it first if you want to keep
            a copy.
          </p>
        )}
        <label>
          Document name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Your writing
          <textarea
            placeholder="Paste your document here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={150000}
            rows={9}
          />
        </label>
        <div className="modal-bottom">
          <button
            type="button"
            className="button secondary"
            onClick={importFile}
          >
            <DrawnIcon name="upload" size={20} />
            Import a file
          </button>
          <button className="button primary" disabled={text.trim().length < 20}>
            Open document
            <ArrowRight size={16} />
          </button>
        </div>
        <button
          type="button"
          className="text-button example-link"
          onClick={() =>
            onCreate({ title: demoTitle, text: demoText, example: true })
          }
        >
          Try the example document
        </button>
      </form>
    </Modal>
  );
}
function AddSourceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (source: Source) => void;
}) {
  const [tab, setTab] = useState<"doi" | "upload">("doi");
  const [doi, setDoi] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "doi")
        onAdd(await api<Source>("/api/sources/resolve", { doi }));
      else {
        const data = new FormData();
        data.append("title", title);
        data.append("author", author);
        data.append("year", year);
        data.append("text", text);
        if (file) data.append("file", file);
        onAdd(await api<Source>("/api/sources/upload", data));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add a source"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="dialog-form">
        <div className="source-tabs">
          <button
            type="button"
            className={tab === "doi" ? "active" : ""}
            disabled={busy}
            onClick={() => setTab("doi")}
          >
            <Link2 size={15} />
            DOI or link
          </button>
          <button
            type="button"
            className={tab === "upload" ? "active" : ""}
            disabled={busy}
            onClick={() => setTab("upload")}
          >
            <FileUp size={15} />
            Upload or paste
          </button>
        </div>
        {tab === "doi" ? (
          <>
            <p className="modal-intro">
              Proof resolves the paper and retrieves available scholarly text.
            </p>
            <label>
              DOI or doi.org URL
              <input
                autoFocus
                placeholder="10.1136/bmj-2023-075847"
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
                required
                maxLength={250}
              />
            </label>
            <p className="field-hint">
              If full text is unavailable, the audit will say exactly what it
              could check.
            </p>
          </>
        ) : (
          <>
            <p className="modal-intro">
              Use this for a paper you already have. Match its author and year
              to the citation in your draft.
            </p>
            <label>
              Paper title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
              />
            </label>
            <div className="field-row">
              <label>
                Author
                <input
                  required
                  placeholder="Michael Noetel"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  maxLength={200}
                />
              </label>
              <label>
                Year
                <input
                  required
                  placeholder="2024"
                  pattern="(?:19|20)[0-9]{2}"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  maxLength={4}
                />
              </label>
            </div>
            <label className="file-picker">
              <DrawnIcon name="upload" size={26} />
              <span>
                {file ? file.name : "Choose a PDF, Word, or text file"}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            {!file && (
              <label>
                Or paste source text
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  maxLength={100000}
                  placeholder="Paste the abstract or relevant source text…"
                />
              </label>
            )}
            <p className="field-hint">
              Uploaded text is labeled as user-supplied. Proof cannot
              independently confirm its identity or peer-review status.
            </p>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-bottom">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || (tab === "upload" && !file && text.length < 40)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{" "}
            {busy ? "Retrieving source…" : "Add source"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
