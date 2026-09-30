import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCheck,
  FileText,
  LoaderCircle,
  Plus,
  ArrowUpRight,
  Upload,
  Copy,
  Trash2,
  RefreshCw,
  Download,
  LockKeyhole,
  LogOut,
  X,
} from "lucide-react";
import {
  classMla,
  classReferences,
  type Check,
  type ClassPaper,
  type ClassReport,
} from "../shared/classroom";
import { formatMla } from "../shared/mla";
import { labels } from "../shared/types";
import { CitationText } from "./MlaCitations";
import { classStore } from "./class-store";
import FindSources from "./FindSources";
import EvidenceCheck, {
  emptyEvidence,
  type EvidenceWorkspace,
} from "./EvidenceCheck";
import ClassTour from "./ClassTour";
import "./styles.css";
import "./classroom.css";

type Workspace = {
  policyVersion?: string;
  text: string;
  docUrl: string;
  assignment: "draft" | "bibliography";
  papers: ClassPaper[];
  report?: ClassReport;
  job?: string;
  reviewInput?: string;
  importedAt?: string;
  evidence?: EvidenceWorkspace;
};
const initial: Workspace = {
  policyVersion: "scholarly-v1",
  text: "",
  docUrl: "",
  assignment: "draft",
  papers: [],
};
const fingerprint = (w: Workspace) =>
  JSON.stringify([
    w.text,
    w.assignment,
    w.papers.map((p) => [p.id, p.mla, p.firstPage, p.accessed, p.url]),
  ]);
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
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
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Request failed: ${r.status}`);
  return data;
}
function Checks({ items }: { items: Check[] }) {
  return (
    <ul className="class-checks">
      {items.map((c, i) => (
        <li key={i} className={`class-check ${c.status}`}>
          <span className="class-status">
            {c.status === "pass"
              ? "Checked"
              : c.status === "issue"
                ? "Review"
                : "Manual check"}
          </span>
          <div>
            <strong>{c.label}</strong>
            <p>{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
export default function Classroom() {
  const [session, setSession] = useState<{
    authenticated: boolean;
    hosted: boolean;
    user?: { id: string; name: string; jevUsd: number; inputTokens: number };
  } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(initial);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState("Loading saved work");
  const [tab, setTab] = useState<"draft" | "find" | "sources" | "review">(
    "draft",
  );
  const [sourceSearchBusy, setSourceSearchBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [researchClaim, setResearchClaim] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [doi, setDoi] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [accessed, setAccessed] = useState("");
  const [firstPage, setFirstPage] = useState("");
  const [file, setFile] = useState<File>();
  const [locator, setLocator] = useState("");
  const [paperFileKey, setPaperFileKey] = useState(0);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    request<{ authenticated: boolean; hosted: boolean }>("/api/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    setReady(false);
    classStore<Workspace>(undefined, session.user?.id || "local")
      .then((saved) => {
        setWorkspace(
          saved
            ? saved.policyVersion === "scholarly-v1"
              ? saved
              : {
                  ...saved,
                  policyVersion: "scholarly-v1",
                  report: undefined,
                  job: undefined,
                  evidence: {
                    ...(saved.evidence || emptyEvidence),
                    report: undefined,
                    job: undefined,
                    input: undefined,
                  },
                }
            : initial,
        );
        setReady(true);
      })
      .catch(() => {
        setSaveState("Browser storage unavailable");
        setReady(true);
      });
  }, [session?.user?.id, session?.authenticated]);
  useEffect(() => {
    if (!ready) return;
    setSaveState("Saving");
    const timer = setTimeout(() => {
      classStore(workspace, session?.user?.id || "local")
        .then(() => setSaveState("Saved in this browser"))
        .catch(() => setSaveState("Not saved. Download a review backup."));
    }, 300);
    return () => clearTimeout(timer);
  }, [workspace, ready, session?.user?.id]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => {
      void request<typeof session>("/api/session")
        .then(setSession)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [session?.authenticated]);
  useEffect(() => {
    if (!workspace.job || !session?.authenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await request<{
          status: string;
          progress: string;
          report?: ClassReport;
          error?: string;
        }>(`/api/class/reviews/${workspace.job}`);
        if (cancelled) return;
        setProgress(job.progress);
        if (job.status === "complete") {
          setWorkspace((w) => ({ ...w, report: job.report, job: undefined }));
          setTab("review");
          setMessage(
            job.report &&
              job.report.coverage.completed < job.report.coverage.total
              ? "Review finished with incomplete checks. See the coverage notice and retry."
              : "Review complete. Open each sentence to inspect the evidence.",
          );
        } else if (job.status === "failed") {
          setError(job.error || "Review failed.");
          setWorkspace((w) => ({ ...w, job: undefined }));
        } else timer = setTimeout(poll, 1800);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setWorkspace((w) => ({ ...w, job: undefined }));
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace.job, session?.authenticated]);
  const update = (change: Partial<Workspace>) =>
    setWorkspace((w) => ({ ...w, ...change }));
  const evidence = workspace.evidence || emptyEvidence;
  const updateEvidence = (change: Partial<EvidenceWorkspace>) =>
    setWorkspace((w) => ({
      ...w,
      evidence: { ...(w.evidence || emptyEvidence), ...change },
    }));
  const stale =
    !!workspace.report && workspace.reviewInput !== fingerprint(workspace);
  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function importGoogle() {
    await act("Importing Google Doc", async () => {
      const data = await request<{
        text: string;
        url: string;
        importedAt: string;
        empty: boolean;
      }>("/api/class/google-doc", { url: workspace.docUrl });
      update({
        text: data.text,
        docUrl: data.url,
        importedAt: data.importedAt,
      });
      setMessage(
        data.empty
          ? "Your IRR writing area is empty. Write in the assigned Google Doc, then refresh this snapshot."
          : "Read-only snapshot imported. Your Google Doc was not changed.",
      );
    });
  }
  async function addPaper() {
    await act("Reading article", async () => {
      const data = new FormData();
      data.set("doi", doi);
      data.set("url", pdfUrl);
      data.set("accessed", accessed);
      data.set("firstPage", firstPage);
      if (file) data.set("file", file);
      const paper = await request<ClassPaper>("/api/class/paper", data);
      setWorkspace((w) => ({
        ...w,
        papers: [
          ...w.papers.filter((p) => p.metadata.doi !== paper.metadata.doi),
          paper,
        ],
      }));
      setExpanded(paper.id);
      setDoi("");
      setPdfUrl("");
      setFile(undefined);
      setFirstPage("");
      setPaperFileKey((v) => v + 1);
      setMessage(
        "Article loaded. Inspect its details and confirm the printed page mapping.",
      );
    });
  }
  async function startReview() {
    await act("Starting review", async () => {
      const job = await request<{ id: string }>("/api/class/reviews", {
        text: workspace.text,
        assignment: workspace.assignment,
        papers: workspace.papers,
      });
      update({ job: job.id, reviewInput: fingerprint(workspace) });
      setTab("review");
    });
  }
  async function retryIncomplete() {
    if (!workspace.report?.reviewId) return;
    await act("Retrying incomplete checks", async () => {
      const job = await request<{ id: string }>(
        `/api/class/reviews/${workspace.report!.reviewId}/retry`,
        {},
      );
      update({ job: job.id });
    });
  }
  async function copy(text: string) {
    try {
      const plain = text.replace(/\*([^*]+)\*/g, "$1");
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const html = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\*([^*]+)\*/g, "<i>$1</i>");
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "text/html": new Blob(
              [
                `<p style="font-family:'Times New Roman',serif;line-height:2;padding-left:0.5in;text-indent:-0.5in">${html}</p>`,
              ],
              { type: "text/html" },
            ),
          }),
        ]);
      } else await navigator.clipboard.writeText(plain);
      setMessage(
        "Citation copied with journal italics. Check its details against the PDF before using it.",
      );
    } catch {
      setMessage("Select the citation text to copy it.");
    }
  }
  function download() {
    const report = { ...workspace, job: undefined };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proof-class-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!session?.authenticated)
    return (
      <main className="class-login">
        <section
          className="proof-login-intro"
          aria-labelledby="proof-intro-title"
        >
          <a className="class-brand" href="/">
            <img src="/images/proof-logo-drawn-v1.png" width="42" alt="" />
            proof<span>.</span>
          </a>
          <h1 id="proof-intro-title">Does your evidence back your writing?</h1>
          <p>
            Proof checks your claims against published research. Read the source
            passages, spot unsupported statements, and decide what to change.
          </p>
          <div className="proof-login-capabilities">
            <div>
              <BookOpen size={21} aria-hidden="true" />
              <p>
                <strong>Find research for a claim</strong>
                Search journal articles and inspect the evidence.
              </p>
            </div>
            <div>
              <CheckCheck size={21} aria-hidden="true" />
              <p>
                <strong>Check your writing against sources</strong>
                Review findings alongside the passages behind them.
              </p>
            </div>
          </div>
          <p className="proof-login-demo">Hackathon demo</p>
        </section>
        <section
          className="class-login-card"
          aria-labelledby="proof-login-title"
        >
          <h2 id="proof-login-title">
            {register ? "Create your account" : "Sign in to Proof"}
          </h2>
          <p>
            {register
              ? "Choose a username and password to start checking evidence."
              : "Open your workspace and continue your research."}
          </p>
          {error && (
            <p role="alert" className="class-error">
              {error}
            </p>
          )}
          {session ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  register ? "Creating account" : "Signing in",
                  async () => {
                    const signed = await request<NonNullable<typeof session>>(
                      "/api/session",
                      { name, password, register },
                    );
                    setPassword("");
                    setSession(signed);
                  },
                );
              }}
            >
              <label>
                Username
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={60}
                  required
                />
                {register && (
                  <small>2 to 60 characters. Use this to sign in.</small>
                )}
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  maxLength={128}
                  required
                />
                {register && <small>At least 10 characters.</small>}
              </label>
              <button className="button primary" disabled={!!busy}>
                <LockKeyhole size={16} />
                {busy || (register ? "Create account" : "Sign in")}
              </button>
              <button
                type="button"
                className="button"
                disabled={!!busy}
                onClick={() => {
                  setRegister(!register);
                  setName("");
                  setPassword("");
                  setError("");
                }}
              >
                {register
                  ? "Already have an account? Sign in"
                  : "New to Proof? Create an account"}
              </button>
            </form>
          ) : (
            <p role="status">Connecting to Proof…</p>
          )}
        </section>
      </main>
    );
  const report = workspace.report;
  return (
    <div className="class-shell">
      <header className="class-header">
        <a className="class-brand" href="/app/class">
          <img src="/images/proof-logo-drawn-v1.png" width="42" alt="" />
          proof<span>.</span>
        </a>
        <nav aria-label="Class workspace" data-tour="navigation">
          {(["draft", "find", "sources", "review"] as const).map((name) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name === "draft"
                ? "Check writing"
                : name === "find"
                  ? "Find sources"
                  : name === "sources"
                    ? `My sources (${workspace.papers.length})`
                    : "Class review"}
            </button>
          ))}
        </nav>
        {!session.user && (
          <small className="class-save-state" data-tour="cost">
            {saveState}
          </small>
        )}
        {session.user && (
          <div className="class-account">
            <div
              className="class-balance"
              data-tour="cost"
              title="Estimated cumulative Jev usage in USD. Hosting is excluded."
            >
              <span>
                btw you owe me:{" "}
                <strong>${session.user.jevUsd.toFixed(5)} USD est.</strong>
              </span>
            </div>
            <div className="class-identity">
              <span className="class-avatar" aria-hidden="true">
                {session.user.name.slice(0, 1)}
              </span>
              <div>
                <strong>{session.user.name}</strong>
                <small title={saveState}>
                  {saveState === "Saved in this browser"
                    ? "Saved locally"
                    : saveState}
                </small>
              </div>
            </div>
            <button
              className="class-sign-out"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await fetch("/api/session", { method: "DELETE" });
                location.reload();
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        )}
      </header>
      <main className="class-main">
        <div className="class-heading">
          <div>
            <h1>
              {tab === "draft"
                ? "Let’s check your writing."
                : tab === "find"
                  ? "Find sources."
                  : tab === "sources"
                    ? "The reading pile."
                    : "Let’s check the receipts."}
            </h1>
          </div>
          {tab === "review" && (
            <button
              className="button primary"
              data-tour="review"
              disabled={
                !!busy ||
                !!workspace.job ||
                workspace.text.trim().length < 10 ||
                !ready
              }
              onClick={startReview}
            >
              {workspace.job ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <CheckCheck size={17} />
              )}{" "}
              {workspace.job
                ? "Review in progress"
                : "Check class requirements"}
            </button>
          )}
        </div>
        {error && (
          <div className="class-error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {message && (
          <div className="class-message" role="status">
            {message}
          </div>
        )}
        {busy && (
          <p role="status">
            <LoaderCircle className="spin" size={15} /> {busy}…
          </p>
        )}
        {workspace.job && (
          <div className="class-progress" role="status">
            <LoaderCircle className="spin" size={18} />
            <div>
              <strong>{progress || "Starting review"}</strong>
              <p>
                You can keep this page open or return to it later. Results stay
                available on the server for one hour.
              </p>
            </div>
          </div>
        )}
        {(tab === "draft" || tab === "find") && (
          <div
            className="evidence-paths"
            role="group"
            aria-label="What do you want to do?"
            data-tour="modes"
          >
            <button
              aria-pressed={tab === "find"}
              onClick={() => setTab("find")}
            >
              <strong>Find sources</strong>
              <span>Find peer-reviewed articles for your text.</span>
            </button>
            <button
              aria-pressed={tab === "draft" && evidence.mode === "supplied"}
              disabled={evidenceBusy}
              onClick={() => {
                updateEvidence({ mode: "supplied" });
                setTab("draft");
              }}
            >
              <strong>Check with my sources</strong>
              <span>Paste your text and the sources to use.</span>
            </button>
            <button
              aria-pressed={tab === "draft" && evidence.mode === "public"}
              disabled={evidenceBusy}
              onClick={() => {
                updateEvidence({ mode: "public" });
                setTab("draft");
              }}
            >
              <strong>Check with public sources</strong>
              <span>Search peer-reviewed journal articles.</span>
            </button>
          </div>
        )}
        {ready && (
          <div hidden={tab !== "find"}>
            <FindSources
              onBusyChange={setSourceSearchBusy}
              text={workspace.text}
              onText={(text) => update({ text })}
              initialClaim={researchClaim}
              onUse={(candidate) => {
                setDoi(candidate.source.doi || "");
                setPdfUrl(candidate.pdfUrl || "");
                setTab("sources");
                setMessage(
                  "Source selected. Read the paper, enter your access date, and attach its full PDF before citing a page.",
                );
              }}
            />
          </div>
        )}
        {tab === "draft" && (
          <>
            <details className="class-card class-import">
              <summary>Use a Google Doc or file instead</summary>
              <label className="class-grow">
                Assigned IRR link
                <input
                  type="url"
                  data-tour="import"
                  value={workspace.docUrl}
                  onChange={(e) => update({ docUrl: e.target.value })}
                  placeholder="https://docs.google.com/document/d/…"
                />
              </label>
              <div className="class-actions">
                <button
                  className="button primary"
                  disabled={!!busy || !!workspace.job || !workspace.docUrl}
                  onClick={importGoogle}
                >
                  <RefreshCw size={16} />{" "}
                  {workspace.importedAt
                    ? "Refresh snapshot"
                    : "Read Google Doc"}
                </button>
                {/^https:\/\/docs\.google\.com\/document\/d\/[\w-]+/.test(
                  workspace.docUrl,
                ) && (
                  <a
                    href={workspace.docUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button secondary"
                  >
                    Open original <ArrowUpRight size={15} />
                  </a>
                )}
                <button
                  className="button secondary"
                  disabled={!!busy || !!workspace.job}
                  onClick={() => importInput.current?.click()}
                >
                  <Upload size={16} /> Import file
                </button>
                <input
                  ref={importInput}
                  type="file"
                  hidden
                  accept=".txt,.md,.docx,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void act("Importing draft", async () => {
                        const data = new FormData();
                        data.set("file", f);
                        const r = await request<{ text: string }>(
                          "/api/class/import",
                          data,
                        );
                        update({
                          text: r.text,
                          importedAt: new Date().toISOString(),
                        });
                      });
                    e.target.value = "";
                  }}
                />
              </div>
            </details>
            <section className="class-card">
              <div className="class-row">
                <h2>Paste your writing</h2>
              </div>
              <textarea
                className="class-draft"
                data-tour="draft"
                aria-label="Draft text to review"
                value={workspace.text}
                disabled={!!workspace.job}
                onChange={(e) => update({ text: e.target.value })}
                placeholder="Drop your draft here. Let’s check it."
              />
              <div className="class-row">
                <small>
                  {workspace.importedAt
                    ? `Snapshot imported ${new Date(workspace.importedAt).toLocaleString()}`
                    : `${workspace.text.trim() ? workspace.text.trim().split(/\s+/).length : 0} words`}
                </small>
                <small>Changes here do not update Google Docs.</small>
              </div>
            </section>
          </>
        )}
        {ready && (
          <div hidden={tab !== "draft"}>
            <EvidenceCheck
              text={workspace.text}
              value={evidence}
              onChange={updateEvidence}
              papers={workspace.papers}
              disabled={!!busy || !!workspace.job}
              onBusyChange={setEvidenceBusy}
            />
          </div>
        )}
        {tab === "draft" && (
          <>
            <details className="class-card class-rules">
              <summary>Check my class requirements too</summary>
              <label>
                Assignment
                <select
                  value={workspace.assignment}
                  disabled={!!workspace.job}
                  onChange={(e) =>
                    update({
                      assignment: e.target.value as Workspace["assignment"],
                    })
                  }
                >
                  <option value="draft">Exploratory draft · 600 words</option>
                  <option value="bibliography">Four-source bibliography</option>
                </select>
              </label>
              <button
                className="button secondary"
                disabled={
                  !!busy ||
                  !!workspace.job ||
                  evidenceBusy ||
                  workspace.text.trim().length < 10
                }
                onClick={startReview}
              >
                Check class requirements and page citations
              </button>
              <p>
                The exploratory draft asks for 600 words, five in-text citations
                from three academic articles of at least three pages each, and a
                Bibliography or Works Cited section. Use Times New Roman and
                double spacing. Keep the writing in your assigned Google Doc
                with evidence of four hours of editing.
              </p>
              <p>
                The earlier bibliography assignment asks for four scholarly
                articles, full PDF links, and four MLA entries. Your slides
                require an access date and show a class-specific author format.
                Proof keeps these two assignments separate.
              </p>
              <div className="class-actions">
                <a
                  href={classReferences.assignment}
                  target="_blank"
                  rel="noreferrer"
                >
                  Assignment instructions <ArrowUpRight size={14} />
                </a>
                <a
                  href={classReferences.slides}
                  target="_blank"
                  rel="noreferrer"
                >
                  Class citation slides <ArrowUpRight size={14} />
                </a>
                <a
                  href={classReferences.inText}
                  target="_blank"
                  rel="noreferrer"
                >
                  Linked in-text guide <ArrowUpRight size={14} />
                </a>
              </div>
            </details>
          </>
        )}
        {tab === "sources" && (
          <>
            <section className="class-card">
              <h2>Add a scholarly article</h2>
              <p>
                Paste an article link or upload its PDF. We’ll try to find its
                citation details.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPaper();
                }}
              >
                <div className="class-fields">
                  <label>
                    Article link or DOI, if you have it
                    <input
                      data-tour="sources"
                      value={doi}
                      onChange={(e) => setDoi(e.target.value)}
                      placeholder="Paste the article link"
                    />
                  </label>
                  <label>
                    PDF link, optional
                    <input
                      type="url"
                      value={pdfUrl}
                      onChange={(e) => setPdfUrl(e.target.value)}
                      placeholder="https://…/article.pdf"
                    />
                  </label>
                  <label>
                    Date you read the article
                    <input
                      required
                      type="date"
                      value={accessed}
                      onChange={(e) => setAccessed(e.target.value)}
                    />
                  </label>
                  <label>
                    Printed number on PDF page 1
                    <input
                      type="number"
                      min="1"
                      max="99999"
                      value={firstPage}
                      onChange={(e) => setFirstPage(e.target.value)}
                      placeholder="Check the paper itself"
                    />
                  </label>
                  <label className="class-upload">
                    Full article PDF
                    <input
                      key={paperFileKey}
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setFile(e.target.files?.[0])}
                    />
                  </label>
                </div>
                <button
                  className="button primary"
                  disabled={
                    !!busy || !!workspace.job || workspace.papers.length >= 8
                  }
                >
                  <Plus size={16} /> Add article
                </button>
              </form>
            </section>
            {!workspace.papers.length && (
              <div className="class-empty">
                <BookOpen size={34} />
                <h2>Add your first paper</h2>
                <p>The reading pile is looking a little empty.</p>
              </div>
            )}
            {workspace.papers.map((p) => (
              <section className="class-card" key={p.id}>
                <div className="class-row">
                  <div>
                    <h2>{p.mla.title}</h2>
                    <p>
                      {p.mla.journal} · {p.mla.year} ·{" "}
                      {p.pages.length
                        ? `${p.pages.length} PDF pages`
                        : "No PDF loaded"}
                    </p>
                  </div>
                  <div className="class-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        setExpanded(expanded === p.id ? undefined : p.id)
                      }
                    >
                      {expanded === p.id ? "Close details" : "Inspect source"}
                    </button>
                    <button
                      className="class-icon"
                      aria-label={`Remove ${p.mla.title}`}
                      disabled={!!workspace.job}
                      onClick={() =>
                        update({
                          papers: workspace.papers.filter((s) => s.id !== p.id),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="class-citation">
                  <CitationText text={classMla(p)} />
                </div>
                <div className="class-actions">
                  <button
                    className="button secondary"
                    onClick={() => copy(classMla(p))}
                  >
                    <Copy size={15} /> Copy citation
                  </button>
                  <a
                    href={`https://doi.org/${encodeURI(p.metadata.doi || p.mla.doi)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Publisher record <ArrowUpRight size={14} />
                  </a>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      PDF link, optional <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
                {expanded === p.id && (
                  <div className="class-source-detail">
                    <p>
                      Compare these details with the PDF. Registry metadata can
                      be incomplete. Editing a field invalidates the previous
                      review.
                    </p>
                    <div className="class-fields">
                      {(
                        [
                          "authors",
                          "title",
                          "journal",
                          "year",
                          "volume",
                          "issue",
                          "pages",
                        ] as const
                      ).map((field) => (
                        <label key={field}>
                          {field === "authors"
                            ? "Authors, one Family, Given name per line"
                            : field === "pages"
                              ? "Publication page range"
                              : field[0].toUpperCase() + field.slice(1)}
                          {field === "authors" ? (
                            <textarea
                              value={p.mla[field]}
                              disabled={!!workspace.job}
                              onChange={(e) =>
                                update({
                                  papers: workspace.papers.map((s) =>
                                    s.id === p.id
                                      ? {
                                          ...s,
                                          mla: {
                                            ...s.mla,
                                            [field]: e.target.value,
                                          },
                                        }
                                      : s,
                                  ),
                                })
                              }
                            />
                          ) : (
                            <input
                              value={p.mla[field]}
                              disabled={!!workspace.job}
                              onChange={(e) =>
                                update({
                                  papers: workspace.papers.map((s) =>
                                    s.id === p.id
                                      ? {
                                          ...s,
                                          mla: {
                                            ...s.mla,
                                            [field]: e.target.value,
                                          },
                                        }
                                      : s,
                                  ),
                                })
                              }
                            />
                          )}
                        </label>
                      ))}
                      <label>
                        Printed number on PDF page 1
                        <input
                          type="number"
                          min="1"
                          max="99999"
                          value={p.firstPage || ""}
                          disabled={!!workspace.job}
                          onChange={(e) =>
                            update({
                              papers: workspace.papers.map((s) =>
                                s.id === p.id
                                  ? {
                                      ...s,
                                      firstPage: e.target.value
                                        ? Number(e.target.value)
                                        : undefined,
                                    }
                                  : s,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Access date
                        <input
                          type="date"
                          value={p.accessed}
                          disabled={!!workspace.job}
                          onChange={(e) =>
                            update({
                              papers: workspace.papers.map((s) =>
                                s.id === p.id
                                  ? { ...s, accessed: e.target.value }
                                  : s,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        PDF link, optional
                        <input
                          type="url"
                          value={p.url}
                          disabled={!!workspace.job}
                          onChange={(e) =>
                            update({
                              papers: workspace.papers.map((s) =>
                                s.id === p.id
                                  ? { ...s, url: e.target.value }
                                  : s,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="class-intext">
                      <label>
                        Page to cite
                        <input
                          value={locator}
                          onChange={(e) => setLocator(e.target.value)}
                          placeholder="e.g. 327"
                        />
                      </label>
                      <code>{formatMla(p.mla, locator).inText}</code>
                      <button
                        className="button secondary"
                        onClick={() => copy(formatMla(p.mla, locator).inText)}
                      >
                        <Copy size={14} /> Copy in-text citation
                      </button>
                      <small>
                        Use the printed page number you actually checked.
                      </small>
                    </div>
                    <h3>Source checks</h3>
                    <Checks items={p.checks} />
                    <p className="class-note">
                      Run a new review after editing details to refresh these
                      checks.
                    </p>
                    <details>
                      <summary>
                        Read all {p.pages.length} extracted PDF pages
                      </summary>
                      {p.pages.map((page) => (
                        <section key={page.index} className="class-pdf-page">
                          <h4>
                            PDF page {page.index}
                            {p.firstPage
                              ? ` · printed page ${p.firstPage + page.index - 1}, using your mapping`
                              : page.label
                                ? ` · PDF label ${page.label}`
                                : ""}
                          </h4>
                          <pre>
                            {page.text || "No readable text extracted."}
                          </pre>
                        </section>
                      ))}
                    </details>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {tab === "review" && (
          <>
            {report && report.coverage.completed < report.coverage.total && (
              <div className="class-error" role="alert">
                {report.coverage.total - report.coverage.completed} sentences
                could not be assessed after retries. This review is incomplete.
                <button
                  className="button secondary"
                  disabled={!!workspace.job || stale || !report.reviewId}
                  onClick={retryIncomplete}
                >
                  Retry incomplete checks
                </button>
              </div>
            )}
            {!report && !workspace.job && (
              <div className="class-empty">
                <CheckCheck size={34} />
                <h2>Ready when your draft is</h2>
                <p>
                  Add your draft and full papers, then choose Review everything.
                </p>
              </div>
            )}
            {report && (
              <>
                {stale && (
                  <div className="class-error" role="status">
                    This report belongs to an earlier snapshot. Run a new review
                    before relying on it.
                  </div>
                )}
                <section className="class-card">
                  <div className="class-row">
                    <div>
                      <h2>
                        {report.checks.filter((c) => c.status === "issue")
                          .length >= 3
                          ? "You're a little cooked, buddy."
                          : report.checks.some((c) => c.status === "issue")
                            ? "A few things to fix."
                            : "Checks done. Receipts below."}
                      </h2>
                      <p>
                        {new Date(report.createdAt).toLocaleString()} ·{" "}
                        {report.words} words · {report.citationCount} recognized
                        citations
                      </p>
                    </div>
                    <button className="button secondary" onClick={download}>
                      <Download size={16} /> Download review
                    </button>
                  </div>
                  <div className="class-stats">
                    <div>
                      <strong>
                        {report.coverage.completed}/{report.coverage.total}
                      </strong>
                      <span>sentences reviewed</span>
                    </div>
                    <div>
                      <strong>{report.coverage.evidenceChecked}</strong>
                      <span>cited pages checked</span>
                    </div>
                    <div>
                      <strong>
                        {
                          report.checks.filter((c) => c.status === "issue")
                            .length
                        }
                      </strong>
                      <span>assignment fixes</span>
                    </div>
                  </div>
                  <p>
                    Language review does not establish factual correctness.
                    Evidence judgments cover the cited page text and selected
                    passages from the article. Inspect figures, tables, source
                    quality, and every item marked Manual check yourself.
                  </p>
                  {report.usage && (
                    <p>
                      Estimated cost: ${report.usage.estimatedUsd.toFixed(5)}{" "}
                      USD
                      {report.usage.unmeteredRequests > 0
                        ? " · partial estimate"
                        : ""}
                    </p>
                  )}
                  <Checks items={report.checks} />
                </section>
                {report.papers.map((p) => (
                  <details className="class-card" key={p.id}>
                    <summary>Source review · {p.mla.title}</summary>
                    <Checks items={p.checks} />
                    <div className="class-citation">
                      <CitationText text={classMla(p)} />
                    </div>
                  </details>
                ))}
                {report.sentences.length > 0 && (
                  <section className="class-card">
                    <h2>Let's check the receipts.</h2>
                    <p>
                      Open a sentence to see its evidence. Uncertain means
                      unverified.
                    </p>
                    {report.sentences.map((s, i) => (
                      <details className="class-sentence" key={s.id}>
                        <summary>
                          <span>{i + 1}</span>
                          <div>
                            {s.text}
                            <small>
                              {!s.completed
                                ? "Review unavailable"
                                : s.citations.length
                                  ? `${s.citations.length} citation check${s.citations.length === 1 ? "" : "s"}`
                                  : s.role === "claim"
                                    ? "Factual claim without a recognized citation"
                                    : s.role === "summary"
                                      ? "Review how you use this source"
                                      : s.role === "uncertain"
                                        ? "Role uncertain"
                                        : s.role}
                            </small>
                          </div>
                        </summary>
                        <div className="class-sentence-body">
                          <button
                            className="button secondary"
                            onClick={() => {
                              setResearchClaim(s.text);
                              setTab("find");
                            }}
                          >
                            Find sources for this sentence
                          </button>
                          <p>{s.language}</p>
                          <p>{s.reasoning}</p>
                          {s.citations.map((c, j) => (
                            <div className="class-evidence" key={j}>
                              <h3>({c.citation})</h3>
                              <Checks items={[c.pageCheck]} />
                              {c.finding ? (
                                <>
                                  <h4>
                                    Cited page ·{" "}
                                    {c.finding.status === "supported"
                                      ? "Evidence found · confirm quote"
                                      : labels[c.finding.status]}
                                  </h4>
                                  <p>{c.finding.explanation}</p>
                                  {c.finding.evidence && (
                                    <blockquote>
                                      {c.finding.evidence}
                                    </blockquote>
                                  )}
                                  <details>
                                    <summary>
                                      All passages checked on the cited page
                                    </summary>
                                    {c.finding.checkedPassages?.map((p, k) => (
                                      <p key={k}>{p}</p>
                                    ))}
                                  </details>
                                </>
                              ) : (
                                <p>Claim support remains unverified.</p>
                              )}
                              {c.contextFinding && (
                                <>
                                  <h4>
                                    Selected article context ·{" "}
                                    {c.contextFinding.status === "supported"
                                      ? "Evidence found · confirm quote"
                                      : labels[c.contextFinding.status]}
                                  </h4>
                                  <p>{c.contextFinding.explanation}</p>
                                  {c.contextFinding.evidence && (
                                    <blockquote>
                                      {c.contextFinding.evidence}
                                    </blockquote>
                                  )}
                                  <details>
                                    <summary>
                                      All article passages checked for context
                                    </summary>
                                    {c.contextFinding.checkedPassages?.map(
                                      (p, k) => (
                                        <p key={k}>{p}</p>
                                      ),
                                    )}
                                  </details>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        )}
        <footer className="class-footer">
          <details>
            <summary>Where does my stuff go?</summary>
            <p>
              Drafts, papers, and reports save in this browser. The server keeps
              review jobs for one hour. Jev receives the draft and source
              passages needed for review.
            </p>
          </details>
          <a href="/app/evidence">
            More evidence tools <ArrowUpRight size={13} />
          </a>
        </footer>
      </main>
      {ready && (
        <ClassTour
          key={session.user?.id || "local"}
          userId={session.user?.id || "local"}
          onTab={setTab}
          currentTab={tab}
          disabled={
            !!workspace.job || !!busy || sourceSearchBusy || evidenceBusy
          }
        />
      )}
    </div>
  );
}
