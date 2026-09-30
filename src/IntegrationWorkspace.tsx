import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileCheck2,
  Link2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { api, type Session } from "./studio-api";
import { evidenceLocator, integrationFindingState } from "./integration-report";
import { useStudioSession } from "./studio-session";
import {
  citationLabel,
  eligibilityLabel,
  processingLabel,
  runStatusLabel,
} from "./studio-status";
import { appRoutes } from "./app-navigation";
import { mcpPlatforms, type McpConfiguration } from "./mcp-connection";
import type {
  ResultFinding,
  Evidence,
  Selection,
} from "../shared/integrations/contracts";
import "./integrations.css";
import McpConnectionGuide from "./McpConnectionGuide";

type LibraryItem = {
  id: string;
  version: string;
  title: string;
  origin: string;
  access: string;
  notices: string[];
  pdf?: boolean;
  chapterMappings?: { chapter: number; from: number; to: number }[];
};
type Grant = {
  id: string;
  platform: string;
  scopes: string[];
  sourceIds: string[];
  active: boolean;
};
type Report = {
  kind?: string;
  budgetUsd?: number;
  reservedUsd?: number;
  id: string;
  status: string;
  progress?: string;
  textChecked?: string;
  error?: string;
  findings?: ResultFinding[];
  nextOffset?: number;
  coverage?: { total: number; checked: number; notVerified: number };
  notices?: string[];
  sources?: { id: string; title: string; access: string }[];
  result?: { notices?: string[] };
};
const prefix = "/api/integrations";
export default function IntegrationWorkspace() {
  const reportId = /^\/app\/checks\/([a-f0-9-]+)$/.exec(
    window.location.pathname,
  )?.[1];
  const { session, setSession, error: sessionError } = useStudioSession();
  const [tab, setTab] = useState<"connections" | "library" | "check">(
    window.location.hash === "#library"
      ? "library"
      : window.location.hash === "#check"
        ? "check"
        : "connections",
  );
  const [configurationError, setConfigurationError] = useState("");
  const [grantsError, setGrantsError] = useState("");
  const [refreshingConnections, setRefreshingConnections] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report>();
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [config, setConfig] = useState<McpConfiguration>();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("check_facts");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [importJob, setImportJob] = useState<Report>();
  const [importKind, setImportKind] = useState("file");
  const [importText, setImportText] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File>();
  const [edition, setEdition] = useState("");
  const [libraryOffset, setLibraryOffset] = useState<number>();
  const refreshLibrary = async (offset = 0) => {
    const result = await api<{ sources: LibraryItem[]; nextOffset?: number }>(
      `${prefix}/library?limit=50&offset=${offset}`,
    );
    setLibrary((old) =>
      offset ? [...old, ...result.sources] : result.sources,
    );
    setLibraryOffset(result.nextOffset);
  };
  const refreshGrants = async () => {
    const result = await api<{ grants: Grant[] }>(`${prefix}/grants`);
    setGrants(result.grants);
    setGrantsError("");
  };
  const refreshConfig = async () => {
    try {
      setConfig(await api<McpConfiguration>(`${prefix}/configuration`));
      setConfigurationError("");
    } catch (e) {
      setConfig(undefined);
      setConfigurationError((e as Error).message);
    }
  };
  const refreshConnections = async () => {
    setRefreshingConnections(true);
    await Promise.allSettled([
      refreshConfig(),
      refreshGrants().catch((e) => setGrantsError(e.message)),
    ]);
    setRefreshingConnections(false);
  };
  useEffect(() => {
    const changeTab = () =>
      setTab(
        window.location.hash === "#library"
          ? "library"
          : window.location.hash === "#check"
            ? "check"
            : "connections",
      );
    window.addEventListener("hashchange", changeTab);
    return () => window.removeEventListener("hashchange", changeTab);
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    if (reportId) {
      let stopped = false,
        timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        try {
          const r = await api<Report>(`${prefix}/checks/${reportId}`);
          if (stopped) return;
          setReport(r);
          if (["queued", "running"].includes(r.status))
            timer = setTimeout(poll, 2000);
        } catch (e) {
          if (!stopped) setError((e as Error).message);
        }
      };
      void poll();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }
    void refreshLibrary().catch((e) => setError(e.message));
    void refreshConnections();
  }, [session?.user?.id, reportId]);
  useEffect(() => {
    if (!importJob || !["queued", "running"].includes(importJob.status)) return;
    const timer = setTimeout(() => {
      api<Report>(`${prefix}/checks/${importJob.id}`)
        .then((r) => {
          setImportJob(r);
          if (r.status === "complete")
            void refreshLibrary().catch((e) => setError(e.message));
        })
        .catch((e) => setError(e.message));
    }, 2000);
    return () => clearTimeout(timer);
  }, [importJob]);
  const act = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const r = await api<{ id: string }>(`${prefix}/checks`, {
        kind,
        text,
        sources: kind === "check_sources" ? selected : [],
        budgetUsd: 0.05,
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(`/app/checks/${r.id}`);
    });
  };
  const upload = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      let r: Report;
      if (importKind === "file") {
        if (!file) throw Error("Choose a file first.");
        const form = new FormData();
        form.set("file", file);
        form.set("title", title || file.name);
        form.set("edition", edition);
        form.set("idempotencyKey", crypto.randomUUID());
        r = await api<Report>(`${prefix}/uploads`, form);
      } else
        r = await api<Report>(`${prefix}/imports`, {
          idempotencyKey: crypto.randomUUID(),
          items: [
            {
              kind: importKind,
              title,
              ...(importKind === "link"
                ? { url: importText }
                : { text: importText }),
              ...(importKind === "text" ? { edition } : {}),
            },
          ],
        });
      setImportJob(r);
    });
  };
  const toggleSource = (s: LibraryItem) =>
    setSelected((old) =>
      old.some((x) => x.id === s.id)
        ? old.filter((x) => x.id !== s.id)
        : [...old, { id: s.id, version: s.version }],
    );
  return (
    <main className="proof-integrations proof-connections-workspace">
      <header className="proof-connections-topbar">
        <a className="integration-brand" href={appRoutes.home}>
          <img
            src="/images/proof-logo-drawn-v1.png"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
            alt=""
          />
          Proof
        </a>
        <nav aria-label="Workspace">
          <a href={appRoutes.home}>
            <ArrowLeft size={15} />
            Back to workspace
          </a>
          <a href={appRoutes.settings}>Settings</a>
        </nav>
        {session?.user && (
          <a className="proof-connections-account" href={appRoutes.account}>
            <span>{session.user.name.slice(0, 2).toUpperCase()}</span>
            {session.user.name}
          </a>
        )}
      </header>
      {(error || sessionError) && (
        <p className="integration-error" role="alert">
          {error || sessionError}
        </p>
      )}
      {!session ? (
        <p role="status">Opening Proof...</p>
      ) : !session.user ? (
        <section className="integration-panel">
          <h1>Sign in to inspect your work</h1>
          <p>Reports and source files are private to your Proof account.</p>
          {session.provider === "workos" ? (
            <a className="integration-button" href="/auth/login">
              Sign in to Proof
            </a>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void act(async () => {
                  await api("/api/session", {
                    name: form.get("name"),
                    password: form.get("password"),
                    register: form.get("register") === "on",
                  });
                  setSession(await api<Session>("/api/session"));
                });
              }}
            >
              <label>
                Username
                <input name="name" required autoComplete="username" />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="current-password"
                />
              </label>
              <label className="integration-selection">
                <input type="checkbox" name="register" /> Create an account
              </label>
              <button disabled={busy}>Sign in</button>
            </form>
          )}
        </section>
      ) : reportId ? (
        <>
          <section className="integration-panel">
            <h1>Evidence report</h1>
            {report ? (
              <>
                <p role="status">
                  {runStatusLabel(report.status)}{" "}
                  {report.progress && `· ${report.progress}`}
                </p>
                {report.error && <p role="alert">{report.error}</p>}
                {report.budgetUsd !== undefined && (
                  <p className="integration-muted">
                    Reserved provider budget $
                    {(report.reservedUsd || 0).toFixed(5)} of $
                    {report.budgetUsd.toFixed(2)}. A reservation is a
                    conservative estimate, not a bill.
                  </p>
                )}
                {report.textChecked !== undefined && (
                  <>
                    <h2>Text checked</h2>
                    <pre>{report.textChecked}</pre>
                  </>
                )}
                {report.coverage && report.coverage.total > 0 && (
                  <p>
                    {report.coverage.checked} of {report.coverage.total} claims
                    checked. {report.coverage.notVerified} were not processed.
                  </p>
                )}
                {report.coverage?.total === 0 && (
                  <p>
                    {["queued", "running"].includes(report.status)
                      ? "Claims will appear when processing starts."
                      : "No claims were processed."}
                  </p>
                )}
                {["queued", "running"].includes(report.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`${prefix}/checks/${reportId}/cancel`, {});
                        setReport(
                          await api<Report>(`${prefix}/checks/${reportId}`),
                        );
                      })
                    }
                  >
                    Cancel check
                  </button>
                )}
              </>
            ) : (
              <p role="status">Reading report...</p>
            )}
          </section>
          {report?.findings?.map((f) => (
            <article className="integration-panel" key={f.id}>
              <p
                className={`integration-verdict is-${integrationFindingState(f).tone}`}
              >
                {integrationFindingState(f).label}
              </p>
              <h2>{f.text}</h2>
              <p>{f.explanation}</p>
              <p className="integration-muted">
                Claim support {f.support.replaceAll("_", " ")} · Source
                eligibility {f.sourceEligibility.replaceAll("_", " ")} ·
                Citation {f.citationCorrectness.replaceAll("_", " ")} ·
                Processing{" "}
                {f.processing?.replaceAll("_", " ") || "not reported"}
              </p>
              {f.evidenceIds.map((id) => (
                <div key={id}>
                  {evidence[id] ? (
                    <details open>
                      <summary>{evidence[id].title}</summary>
                      <blockquote>{evidence[id].text}</blockquote>
                      <p className="integration-muted">
                        {evidenceLocator(evidence[id].locator)}
                      </p>
                      {evidence[id].url && (
                        <a
                          href={evidence[id].url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source
                        </a>
                      )}
                    </details>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const value = await api<Evidence>(
                            `${prefix}/checks/${reportId}/evidence/${id}`,
                          );
                          setEvidence((old) => ({ ...old, [id]: value }));
                        })
                      }
                    >
                      Open original evidence
                    </button>
                  )}
                </div>
              ))}
            </article>
          ))}
          {report?.nextOffset !== undefined && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const next = await api<Report>(
                    `${prefix}/checks/${reportId}?offset=${report.nextOffset}`,
                  );
                  setReport((old) => ({
                    ...next,
                    findings: [
                      ...(old?.findings || []),
                      ...(next.findings || []),
                    ],
                  }));
                })
              }
            >
              More findings
            </button>
          )}
          {report?.kind === "find_sources" && !!report.sources?.length && (
            <section className="integration-panel">
              <h2>Discovered sources</h2>
              {report.sources.map((source) => (
                <div className="integration-grant" key={source.id}>
                  <h3>{source.title}</h3>
                  <p>{source.access.replaceAll("_", " ")}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const job = await api<Report>(`${prefix}/imports`, {
                          idempotencyKey: crypto.randomUUID(),
                          items: [
                            {
                              kind: "candidate",
                              title: source.title,
                              checkId: report.id,
                              sourceId: source.id,
                            },
                          ],
                        });
                        setImportJob(job);
                      })
                    }
                  >
                    Add source to my library
                  </button>
                </div>
              ))}
              {importJob && (
                <p role="status">Import {runStatusLabel(importJob.status)}</p>
              )}
            </section>
          )}
          {!!report?.notices?.length && (
            <section className="integration-panel">
              <h2>Limits of this check</h2>
              {report.notices.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </section>
          )}
        </>
      ) : (
        <>
          <div className="proof-connections-page-heading">
            <h1>
              {tab === "connections"
                ? "Connections"
                : tab === "library"
                  ? "Source library"
                  : "Check a passage"}
            </h1>
            <p>
              {tab === "connections"
                ? "Connect your chat and control what it can access."
                : tab === "library"
                  ? "Manage original sources for your connected checks."
                  : "Check exact text and keep the evidence in Proof."}
            </p>
          </div>
          <nav className="proof-connections-tabs" aria-label="Connection tools">
            <a
              href="#connect"
              className={tab === "connections" ? "active" : ""}
              aria-current={tab === "connections" ? "page" : undefined}
              onClick={() => setTab("connections")}
            >
              <MessageSquare size={17} />
              Connections
            </a>
            <a
              href="#library"
              className={tab === "library" ? "active" : ""}
              aria-current={tab === "library" ? "page" : undefined}
              onClick={() => setTab("library")}
            >
              <BookOpen size={17} />
              Source library
            </a>
            <a
              href="#check"
              className={tab === "check" ? "active" : ""}
              aria-current={tab === "check" ? "page" : undefined}
              onClick={() => setTab("check")}
            >
              <FileCheck2 size={17} />
              Passage check
            </a>
          </nav>
          <section
            className="integration-panel proof-connection-panel"
            id="connect"
            hidden={tab !== "connections"}
          >
            <McpConnectionGuide
              configuration={config}
              configurationError={configurationError}
              refreshing={refreshingConnections}
              onRefresh={() => void refreshConnections()}
              connections={grantsError ? [] : grants}
            />
            <div className="proof-connected-heading">
              <h2>Connected accounts</h2>
              <span>
                {grantsError
                  ? "Status unavailable"
                  : refreshingConnections
                    ? "Refreshing..."
                    : `${grants.filter((grant) => grant.active).length} active`}
              </span>
            </div>
            {grantsError && (
              <p className="integration-error" role="alert">
                Connections could not be refreshed. {grantsError}
              </p>
            )}
            {!grants.length && !grantsError && !refreshingConnections && (
              <div className="proof-connected-empty">
                <Link2 size={23} />
                <p>
                  No accounts connected yet. Complete sign-in in your chat
                  platform, then refresh the status above.
                </p>
              </div>
            )}
            {(!grantsError ? grants : []).map((g) => (
              <div key={g.id} className="integration-grant">
                <div className="proof-connected-account-heading">
                  <div>
                    <img
                      src={`/images/ai/${mcpPlatforms.find((platform) => platform.id === g.platform)?.logo || "openai.svg"}`}
                      alt=""
                      width="25"
                      height="25"
                    />
                    <h3>
                      {mcpPlatforms.find(
                        (platform) => platform.id === g.platform,
                      )?.name || g.platform}
                    </h3>
                  </div>
                  <span className={g.active ? "is-connected" : ""}>
                    {g.active ? <Check size={13} /> : <Unplug size={13} />}
                    {g.active ? "Connected" : "Disconnected"}
                  </span>
                </div>
                {g.active && (
                  <>
                    <fieldset>
                      <legend>Sources shared with this platform</legend>
                      {!library.length && (
                        <p className="integration-muted">
                          Add original sources in the source library before
                          sharing them.
                        </p>
                      )}
                      {library.map((s) => (
                        <label key={s.id} className="integration-selection">
                          <input
                            type="checkbox"
                            checked={g.sourceIds.includes(s.id)}
                            disabled={busy}
                            onChange={(e) =>
                              void act(async () => {
                                const sourceIds = e.target.checked
                                  ? [...g.sourceIds, s.id]
                                  : g.sourceIds.filter((id) => id !== s.id);
                                await api(
                                  `${prefix}/grants/${g.id}/sources`,
                                  { sourceIds },
                                  "PUT",
                                );
                                await refreshGrants();
                              })
                            }
                          />
                          {s.title}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="proof-connection-disconnect"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            `${prefix}/grants/${g.id}`,
                            undefined,
                            "DELETE",
                          );
                          await refreshGrants();
                        })
                      }
                    >
                      <Unplug size={15} />
                      Disconnect{" "}
                      {mcpPlatforms.find(
                        (platform) => platform.id === g.platform,
                      )?.name || g.platform}
                    </button>
                  </>
                )}
                {!g.active && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`${prefix}/grants/${g.id}/reconnect`, {});
                        await refreshGrants();
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Allow reconnection
                  </button>
                )}
              </div>
            ))}
            <p className="integration-muted proof-connection-permissions-note">
              <ShieldCheck size={15} />
              Disconnecting revokes this platform's access and cancels its
              unfinished checks. Already approved source imports may finish.
              Stored sources and finished work remain in Proof until you delete
              them.
            </p>
          </section>
          <section
            className="integration-panel"
            id="check"
            hidden={tab !== "check"}
          >
            <h2>Check a passage</h2>
            <form onSubmit={start}>
              <label>
                Workflow
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="check_facts">Check factual accuracy</option>
                  <option value="check_sources">Check with my sources</option>
                  <option value="find_sources">Find sources</option>
                </select>
              </label>
              <label>
                Exact text to check
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  minLength={10}
                  maxLength={kind === "find_sources" ? 4000 : 100000}
                  rows={7}
                />
              </label>
              {kind === "check_sources" && (
                <fieldset>
                  <legend>Selected original sources</legend>
                  {!library.length && (
                    <p>Add a source in the source library first.</p>
                  )}
                  {library.map((s) => (
                    <div key={s.id}>
                      <label className="integration-selection">
                        <input
                          type="checkbox"
                          checked={selected.some((x) => x.id === s.id)}
                          onChange={() => toggleSource(s)}
                        />{" "}
                        {s.title}
                      </label>
                      {selected.some((x) => x.id === s.id) && (
                        <label>
                          Permitted range
                          <input
                            aria-label={`PDF pages for ${s.title}`}
                            placeholder="All pages, 1-11, or chapters 1-11"
                            pattern="(chapters )?[0-9]+-[0-9]+"
                            onChange={(e) => {
                              const [from, to] = e.target.value
                                .replace(/^chapters /, "")
                                .split("-")
                                .map(Number);
                              setSelected((old) =>
                                old.map((x) =>
                                  x.id === s.id
                                    ? {
                                        ...x,
                                        range: e.target.value
                                          ? e.target.value.startsWith(
                                              "chapters ",
                                            )
                                            ? { chapters: { from, to } }
                                            : { pages: { from, to } }
                                          : undefined,
                                      }
                                    : x,
                                ),
                              );
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </fieldset>
              )}
              <p className="integration-muted">
                Provider spending reservation capped at $0.05 per run. Public
                checks process up to the configured claim limit. Results
                preserve uncertainty.
              </p>
              <button
                disabled={
                  busy ||
                  !config ||
                  (kind === "check_sources" && !selected.length)
                }
              >
                Start check
              </button>
            </form>
          </section>
          <section
            className="integration-panel"
            id="library"
            hidden={tab !== "library"}
          >
            <h2>Your source library</h2>
            <form onSubmit={upload}>
              <label>
                Import
                <select
                  value={importKind}
                  onChange={(e) => setImportKind(e.target.value)}
                >
                  <option value="file">Original file</option>
                  <option value="text">Source text</option>
                  <option value="link">Public link</option>
                  <option value="bibliography">Bibliography</option>
                </select>
              </label>
              <label>
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required={importKind !== "file"}
                  maxLength={300}
                />
              </label>
              {["file", "text"].includes(importKind) && (
                <label>
                  Edition or translation, if known
                  <input
                    value={edition}
                    onChange={(e) => setEdition(e.target.value)}
                    maxLength={300}
                  />
                </label>
              )}
              {importKind === "file" ? (
                <label>
                  Source file
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(e) => setFile(e.target.files?.[0])}
                    required
                  />
                </label>
              ) : (
                <label>
                  {importKind === "link"
                    ? "Public HTTPS URL"
                    : importKind === "bibliography"
                      ? "One reference per line"
                      : "Original source text"}
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    required
                    rows={4}
                  />
                </label>
              )}
              <button disabled={busy || !config}>Import selected source</button>
            </form>
            {importJob && (
              <div role="status">
                <p>Import {runStatusLabel(importJob.status)}</p>
                {importJob.error && <p>{importJob.error}</p>}
                {importJob.result?.notices?.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            )}
            <ul className="integration-library">
              {library.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.title}</strong>
                    <p>
                      {s.origin} · {s.access.replaceAll("_", " ")}
                    </p>
                    {s.notices.map((n, i) => (
                      <p key={i} className="integration-muted">
                        {n}
                      </p>
                    ))}
                  </div>
                  {s.pdf && (
                    <details>
                      <summary>Confirm chapter pages</summary>
                      <p>
                        Use physical PDF page numbers for this edition. Existing
                        checks keep their original mapping.
                      </p>
                      {(s.chapterMappings || []).map((m) => (
                        <p key={m.chapter}>
                          Chapter {m.chapter}: PDF pages {m.from}–{m.to}
                        </p>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void act(async () => {
                            const mapping = {
                              chapter: Number(data.get("chapter")),
                              from: Number(data.get("from")),
                              to: Number(data.get("to")),
                            };
                            await api(
                              `${prefix}/library/${s.id}/chapters`,
                              {
                                version: s.version,
                                mappings: [
                                  ...(s.chapterMappings || []).filter(
                                    (m) => m.chapter !== mapping.chapter,
                                  ),
                                  mapping,
                                ],
                              },
                              "PUT",
                            );
                            await refreshLibrary();
                          });
                        }}
                      >
                        <label>
                          Chapter number
                          <input
                            name="chapter"
                            type="number"
                            min="1"
                            required
                          />
                        </label>
                        <label>
                          First PDF page
                          <input name="from" type="number" min="1" required />
                        </label>
                        <label>
                          Last PDF page
                          <input name="to" type="number" min="1" required />
                        </label>
                        <button disabled={busy}>Confirm this chapter</button>
                      </form>
                    </details>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this source and reports that use it? Access is revoked immediately.",
                        )
                      )
                        void act(async () => {
                          await api(
                            `${prefix}/library/${s.id}`,
                            undefined,
                            "DELETE",
                          );
                          await refreshLibrary();
                          setSelected((old) =>
                            old.filter((x) => x.id !== s.id),
                          );
                        });
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            {libraryOffset !== undefined && (
              <button
                disabled={busy}
                onClick={() => void act(() => refreshLibrary(libraryOffset))}
              >
                More sources
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
