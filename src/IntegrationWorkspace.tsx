import { useEffect, useState, type FormEvent } from "react";
import type {
  ResultFinding,
  Evidence,
  Selection,
} from "../shared/integrations/contracts";
import "./integrations.css";
import McpConnectionGuide from "./McpConnectionGuide";

type Session = {
  authenticated: boolean;
  user?: { id: string; name: string };
  provider?: string;
};
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
async function api<T>(
  url: string,
  data?: unknown,
  method = data ? "POST" : "GET",
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers:
      data instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.message || result.error || "The request failed.");
  return result;
}
const prefix = "/api/integrations";
export default function IntegrationWorkspace() {
  const reportId = /^\/app\/checks\/([a-f0-9-]+)$/.exec(
    window.location.pathname,
  )?.[1];
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report>();
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [config, setConfig] = useState<{
    mcpEnabled: boolean;
    mcpUrl?: string;
    platforms?: string[];
  }>();
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
  const refreshGrants = async () =>
    setGrants((await api<{ grants: Grant[] }>(`${prefix}/grants`)).grants);
  useEffect(() => {
    api<Session>("/api/session")
      .then(setSession)
      .catch((e) => setError(e.message));
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
    void Promise.all([
      refreshLibrary(),
      refreshGrants(),
      api<{ mcpEnabled: boolean; mcpUrl?: string; platforms?: string[] }>(
        `${prefix}/configuration`,
      ).then(setConfig),
    ]).catch((e) => setError(e.message));
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
    <main className="proof-integrations">
      <header>
        <a className="integration-brand" href="/app">
          Proof
        </a>
        <nav>
          <a href="/app">Writing</a>
          <a href="/app/integrations">Checks & connections</a>
        </nav>
        {session?.user && <span>{session.user.name}</span>}
      </header>
      {error && (
        <p className="integration-error" role="alert">
          {error}
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
                  {report.status} {report.progress && `· ${report.progress}`}
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
              <p className="integration-verdict">
                {f.support.replaceAll("_", " ")} ·{" "}
                {f.coverage.replaceAll("_", " ")}
              </p>
              <h2>{f.text}</h2>
              <p>{f.explanation}</p>
              <p className="integration-muted">
                Source eligibility: {f.sourceEligibility.replaceAll("_", " ")} ·
                Citation correctness not checked
              </p>
              {f.evidenceIds.map((id) => (
                <div key={id}>
                  {evidence[id] ? (
                    <details open>
                      <summary>{evidence[id].title}</summary>
                      <blockquote>{evidence[id].text}</blockquote>
                      <p className="integration-muted">
                        {evidence[id].locator.page !== undefined
                          ? `PDF page ${evidence[id].locator.page}${evidence[id].locator.pageLabel ? `, printed label ${evidence[id].locator.pageLabel}` : ""}`
                          : `Character offset ${evidence[id].locator.start}`}
                        {evidence[id].locator.chapter &&
                          `, supplied chapter ${evidence[id].locator.chapter}`}
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
              {importJob && <p role="status">Import {importJob.status}</p>}
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
          <section className="integration-panel">
            <h1>Check a passage</h1>
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
                  {!library.length && <p>Import a source below first.</p>}
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
          <section className="integration-panel">
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
                <p>Import {importJob.status}</p>
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
          <section className="integration-panel" id="connect">
            <McpConnectionGuide configuration={config} />
            <h3>Connected accounts</h3>
            {!grants.length && <p>No platforms are connected yet.</p>}
            {grants.map((g) => (
              <div key={g.id} className="integration-grant">
                <h3>{g.platform === "chatgpt" ? "ChatGPT" : "Claude"}</h3>
                <p>{g.active ? "Connected" : "Disconnected"}</p>
                {g.active && (
                  <>
                    <fieldset>
                      <legend>Sources shared with this platform</legend>
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
                      Disconnect{" "}
                      {g.platform === "chatgpt" ? "ChatGPT" : "Claude"}
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
                    Allow reconnection
                  </button>
                )}
              </div>
            ))}
            <p className="integration-muted">
              Disconnecting revokes this platform's access and cancels its
              unfinished checks. Already approved source imports may finish.
              Stored sources and finished work remain in Proof until you delete
              them.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
