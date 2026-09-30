import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  FileText,
  House,
  Info,
  LayoutGrid,
  Link2,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Play,
  Search,
  Settings,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  CircleHelp,
  Plug,
  CircleX,
  X,
} from "lucide-react";
import "./studio.css";
import "./mcp-connect.css";
import StudioAnalysis from "./StudioAnalysis";
import {
  api,
  canUseLocalDrafts,
  serverWork,
  type Session,
  type StudioWork,
} from "./studio-api";

type Section = "dashboard" | "analysis" | "citations";
type Work = StudioWork;
type Route = { workId: string | null; section: Section };
type Menu = "profile" | "notifications" | "project" | "document" | null;

const sectionOrder: Section[] = ["dashboard", "analysis", "citations"];

function parseRoute(pathname: string): Route {
  const match = pathname.match(
    /^\/app\/works\/([^/]+)(?:\/(analysis|citations))?\/?$/,
  );
  if (!match) return { workId: null, section: "dashboard" };
  return {
    workId: (() => {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    })(),
    section: (match[2] as Section) || "dashboard",
  };
}

function workPath(id: string, section: Section = "dashboard") {
  if (section === "dashboard") return `/app/works/${id}`;
  return `/app/works/${id}/${section}`;
}

export default function Studio({ session }: { session: Session }) {
  const storageKey = `proof.works.v2:${session.user?.id || "local"}`;
  const [path, setPath] = useState(window.location.pathname);
  const route = parseRoute(path);
  const [works, setWorks] = useState<Work[]>([]);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refreshWorks() {
    const all: Work[] = [];
    for (let offset = 0; ; offset += 100) {
      const result = await api<{ items: Parameters<typeof serverWork>[0][] }>(
        `/api/v1/documents?limit=100&offset=${offset}`,
      );
      all.push(...result.items.map(serverWork));
      if (result.items.length < 100) break;
    }
    setWorks(all);
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let backendAvailable = false;
      try {
        await api("/api/v1/capabilities");
        backendAvailable = true;
        if (cancelled) return;
        await refreshWorks();
        setPersistent(true);
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        if (
          !backendAvailable &&
          canUseLocalDrafts(session, import.meta.env.DEV, e)
        ) {
          try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
            if (Array.isArray(saved))
              setWorks(
                saved.filter(
                  (item) =>
                    typeof item?.id === "string" &&
                    typeof item.title === "string" &&
                    typeof item.content === "string",
                ),
              );
          } catch {
            setError("Could not read this browser's saved drafts.");
          }
          setReady(true);
        } else {
          setError("We couldn't open your workspace. Please try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, session.hosted]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"new" | "document" | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [openMenu, setOpenMenu] = useState<Menu>(null);
  const [menuWorkId, setMenuWorkId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Work | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (modal) dialog?.showModal();
    return () => dialog?.close();
  }, [modal]);
  const contentRef = useRef<HTMLElement>(null);
  const sidebarWorkRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  const keyboardInput = useRef(false);
  const navigationId = useRef(0);
  const workTransition = useRef<ViewTransition | null>(null);
  const pageAnimations = useRef<Animation[]>([]);

  const navigate = (next: string) => {
    const previous = parseRoute(pathRef.current);
    const destination = parseRoute(next);
    pathRef.current = next;
    const id = ++navigationId.current;
    workTransition.current?.skipTransition();
    pageAnimations.current.forEach((animation) => animation.cancel());
    const instant =
      keyboardInput.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const changingWork = previous.workId !== destination.workId;
    const direction = destination.workId
      ? changingWork ||
        sectionOrder.indexOf(destination.section) >
          sectionOrder.indexOf(previous.section)
        ? 1
        : -1
      : -1;
    const update = () => {
      // A newer navigation may arrive while the browser captures the old view.
      if (id !== navigationId.current) return;
      flushSync(() => {
        setPath(next);
        setSidebarOpen(false);
        setOpenMenu(null);
        if (!destination.workId) {
          setSearch("");
        }
      });
    };

    if (changingWork && !instant && document.startViewTransition) {
      document.documentElement.dataset.psNavigation =
        direction === 1 ? "open" : "close";
      const transition = document.startViewTransition(update);
      workTransition.current = transition;
      // A skipped snapshot must still commit navigation without an unhandled rejection.
      void transition.ready.catch(() => {});
      void transition.finished.finally(() => {
        if (workTransition.current === transition) {
          workTransition.current = null;
          delete document.documentElement.dataset.psNavigation;
        }
      });
      return;
    }

    delete document.documentElement.dataset.psNavigation;
    update();
    if (!instant) {
      const elements = changingWork
        ? [contentRef.current, sidebarWorkRef.current]
        : [contentRef.current];
      pageAnimations.current = elements.flatMap((element) =>
        element
          ? [
              element.animate(
                [
                  {
                    opacity: 0,
                    transform: `translateX(${direction * (changingWork ? 8 : 12)}px)`,
                  },
                  { opacity: 1, transform: "translateX(0)" },
                ],
                {
                  duration: changingWork
                    ? destination.workId
                      ? 360
                      : 300
                    : 240,
                  easing: changingWork
                    ? "cubic-bezier(0.32, 0.72, 0, 1)"
                    : "cubic-bezier(0.22, 1, 0.36, 1)",
                },
              ),
            ]
          : [],
      );
    }
  };

  const go = (next: string) => {
    if (next === window.location.pathname) return;
    window.history.pushState({}, "", next);
    navigate(next);
  };

  useEffect(() => {
    const onPop = () => navigate(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      workTransition.current?.skipTransition();
      pageAnimations.current.forEach((animation) => animation.cancel());
      delete document.documentElement.dataset.psNavigation;
    };
  }, []);

  useEffect(() => {
    if (!ready || persistent) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(works));
    } catch {
      setError(
        "Draft changes could not be saved in this browser. Copy your text before closing.",
      );
    }
  }, [works, ready, persistent, storageKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setOpenMenu(null);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeWork = works.find((work) => work.id === route.workId) ?? null;
  const focused = !!activeWork;

  const showSidebarTooltip = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("[data-sidebar-tooltip]");
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setSidebarTooltip({
      text: button.dataset.sidebarTooltip || "",
      top: Math.max(
        28,
        Math.min(window.innerHeight - 28, rect.top + rect.height / 2),
      ),
      left: rect.right + 14,
    });
  };

  useEffect(() => {
    if (
      ready &&
      route.workId &&
      !works.some((work) => work.id === route.workId)
    ) {
      window.history.replaceState({}, "", "/app");
      pathRef.current = "/app";
      setPath("/app");
    }
  }, [route.workId, works, ready]);

  useEffect(() => {
    if (!focused) {
      document.title = "Proof · My work";
      return;
    }
    const page =
      route.section === "analysis"
        ? "Analysis"
        : route.section === "citations"
          ? "Citations"
          : "Dashboard";
    document.title = `Proof · ${page} · ${activeWork.title}`;
  }, [focused, route.section, activeWork?.title]);

  const filtered = useMemo(() => {
    if (activeWork) return [activeWork];
    const query = search.trim().toLowerCase();
    const list = query
      ? works.filter((work) => work.title.toLowerCase().includes(query))
      : works;
    return list;
  }, [works, search, activeWork]);

  const openWork = (id: string, section: Section = "dashboard") => {
    go(workPath(id, section));
    setSearch("");
  };

  const addWork = (event: FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || busy) return;
    void action(async () => {
      const work: Work = {
        id: crypto.randomUUID(),
        title,
        type: "DRAFT",
        words: 0,
        edited: "just now",
        content: "",
      };
      if (persistent) {
        const result = await api<{ id: string; documentVersionId: string }>(
          "/api/v1/documents",
          { title, text: " " },
        );
        work.id = result.id;
        work.documentVersionId = result.documentVersionId;
      }
      setWorks((current) => [work, ...current]);
      setNewTitle("");
      setModal(null);
      openWork(work.id);
    });
  };
  const saveDocument = () => {
    if (!activeWork || busy) return;
    void action(async () => {
      let documentVersionId = activeWork.documentVersionId;
      if (persistent) {
        const result = await api<{ id: string }>(
          `/api/v1/documents/${activeWork.id}/versions`,
          { text: draft || " ", expectedVersionId: documentVersionId },
        );
        documentVersionId = result.id;
      }
      setWorks((current) =>
        current.map((work) =>
          work.id === activeWork.id
            ? {
                ...work,
                content: draft,
                words: draft.trim().split(/\s+/).filter(Boolean).length,
                edited: "just now",
                documentVersionId,
              }
            : work,
        ),
      );
      setModal(null);
    });
  };
  const deleteWork = (id: string) => {
    if (busy) return;
    void action(async () => {
      if (persistent) await api(`/api/v1/documents/${id}/archive`, {});
      setWorks((current) => current.filter((work) => work.id !== id));
      setOpenMenu(null);
      setPendingDelete(null);
      if (route.workId === id) {
        setSearch("");
        go("/app");
      }
    });
  };
  const openDocument = () => {
    if (!activeWork) return;
    setDraft(activeWork.content);
    setOpenMenu(null);
    setModal("document");
  };

  if (!ready)
    return (
      <main className="proof-studio ps-signin">
        <section className="ps-modal">
          <h1>Opening your workspace</h1>
          <p role={error ? "alert" : "status"}>
            {error || "Loading documents..."}
          </p>
          {error && (
            <button onClick={() => window.location.reload()}>Try again</button>
          )}
        </section>
      </main>
    );
  return (
    <div
      className={`proof-studio ${!focused ? "is-library" : ""}`}
      onClick={() => openMenu && setOpenMenu(null)}
      onKeyDownCapture={() => {
        keyboardInput.current = true;
      }}
      onPointerDownCapture={() => {
        keyboardInput.current = false;
      }}
      data-motion={keyboardInput.current ? "instant" : undefined}
    >
      <aside
        id="ps-sidebar"
        className={`ps-sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}
      >
        <div
          className="ps-sidebar-rail"
          onPointerOver={(event) => {
            const button = (event.target as Element).closest<HTMLElement>(
              "[data-sidebar-tooltip]",
            );
            if (
              button &&
              event.relatedTarget instanceof Node &&
              button.contains(event.relatedTarget)
            )
              return;
            showSidebarTooltip(event.target);
          }}
          onPointerOut={(event) => {
            const button = (event.target as Element).closest<HTMLElement>(
              "[data-sidebar-tooltip]",
            );
            if (
              button &&
              event.relatedTarget instanceof Node &&
              button.contains(event.relatedTarget)
            )
              return;
            setSidebarTooltip(null);
          }}
          onFocusCapture={(event) => showSidebarTooltip(event.target)}
          onBlurCapture={() => setSidebarTooltip(null)}
          onClickCapture={() => setSidebarTooltip(null)}
          onScrollCapture={() => setSidebarTooltip(null)}
        >
          <button
            className="ps-rail-logo"
            aria-label="Expand sidebar"
            aria-controls="ps-sidebar"
            aria-expanded={false}
            data-sidebar-tooltip="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            <img
              src="/images/proof-logo-drawn-v1.png"
              alt=""
              width={40}
              height={40}
            />
            <PanelLeftOpen className="ps-rail-expand" size={23} />
          </button>
          <div className="ps-rail-actions">
            <button
              className="ps-rail-button ps-rail-add"
              aria-label="Add new work"
              data-sidebar-tooltip="Add new work"
              onClick={() => setModal("new")}
            >
              <Plus size={22} />
            </button>
            <button
              className={`ps-rail-button ${!focused ? "active" : ""}`}
              aria-label="My work"
              data-sidebar-tooltip="My work"
              aria-current={!focused ? "page" : undefined}
              onClick={() => go("/app")}
            >
              <LayoutGrid size={21} />
            </button>
          </div>
          <div className="ps-rail-divider" />
          <nav
            className="ps-rail-projects"
            aria-label={focused ? "Work pages" : "My work"}
          >
            {focused ? (
              <>
                <button
                  className="ps-rail-button"
                  aria-label={activeWork.title}
                  data-sidebar-tooltip={activeWork.title}
                  onClick={() => openWork(activeWork.id)}
                >
                  <FileText size={22} strokeWidth={1.6} />
                </button>
                <button
                  className={`ps-rail-button ${route.section === "dashboard" ? "active" : ""}`}
                  aria-label="Dashboard"
                  data-sidebar-tooltip="Dashboard"
                  aria-current={
                    route.section === "dashboard" ? "page" : undefined
                  }
                  onClick={() => openWork(activeWork.id)}
                >
                  <House size={21} />
                </button>
                <button
                  className={`ps-rail-button ${route.section === "analysis" ? "active" : ""}`}
                  aria-label="Analysis"
                  data-sidebar-tooltip="Analysis"
                  aria-current={
                    route.section === "analysis" ? "page" : undefined
                  }
                  onClick={() => openWork(activeWork.id, "analysis")}
                >
                  <BarChart3 size={21} />
                </button>
                <button
                  className={`ps-rail-button ${route.section === "citations" ? "active" : ""}`}
                  aria-label="Citations"
                  data-sidebar-tooltip="Citations"
                  aria-current={
                    route.section === "citations" ? "page" : undefined
                  }
                  onClick={() => openWork(activeWork.id, "citations")}
                >
                  <Link2 size={21} />
                </button>
              </>
            ) : (
              works.map((work) => (
                <button
                  key={work.id}
                  className="ps-rail-button"
                  aria-label={work.title}
                  data-sidebar-tooltip={work.title}
                  onClick={() => openWork(work.id)}
                >
                  <FileText size={22} strokeWidth={1.6} />
                </button>
              ))
            )}
          </nav>
          {!focused && (
            <div className="ps-rail-footer">
              <a
                className="ps-rail-button"
                href="/app/integrations#connect"
                aria-label="Connect ChatGPT or Claude"
                data-sidebar-tooltip="Connect ChatGPT or Claude"
              >
                <Plug size={21} />
              </a>
              <button
                className="ps-rail-button"
                aria-label="Settings"
                data-sidebar-tooltip="Settings"
                onClick={() => setOpenMenu("profile")}
              >
                <Settings size={21} />
              </button>
              <button
                className="ps-rail-button"
                aria-label="Help"
                data-sidebar-tooltip="Help"
                onClick={() => setOpenMenu("notifications")}
              >
                <CircleHelp size={21} />
              </button>
            </div>
          )}
        </div>
        <div className="ps-sidebar-expanded">
          <div className="ps-brand-row">
            <a
              className="ps-brand"
              href="/app"
              aria-label="Proof home"
              onClick={(event) => {
                event.preventDefault();
                go("/app");
              }}
            >
              <img
                className="ps-brand-mark"
                src="/images/proof-logo-drawn-v1.png"
                alt=""
                width={44}
                height={44}
              />
              <span className="ps-brand-name">
                proof<span>.</span>
              </span>
            </a>
            <button
              className="ps-icon-button ps-desktop-collapse"
              aria-label="Collapse sidebar"
              aria-controls="ps-sidebar"
              aria-expanded={true}
              onClick={() => {
                setSidebarCollapsed(true);
                setOpenMenu(null);
              }}
            >
              <PanelLeftClose size={20} />
            </button>
            <button
              className="ps-icon-button ps-mobile-close"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="ps-sidebar-inner">
            <button className="ps-add" onClick={() => setModal("new")}>
              <Plus size={18} />
              Add new work
            </button>
            <div className="ps-sidebar-workspace" ref={sidebarWorkRef}>
              {!focused && (
                <>
                  <div className="ps-search-field ps-library-search">
                    <Search size={18} />
                    <input
                      aria-label="Search my work"
                      placeholder="Search..."
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <div className="ps-work-label">
                    <span>My work</span>
                  </div>
                </>
              )}
              {focused && (
                <button className="ps-back" onClick={() => go("/app")}>
                  <ArrowLeft size={16} />
                  Go back
                </button>
              )}
              <div
                key={activeWork?.id ?? "library"}
                className={`ps-work-list ${focused ? "focused" : "divided"}`}
              >
                {filtered.length === 0 && (
                  <div className="ps-empty-search">No matching work</div>
                )}
                {filtered.map((work) => {
                  const open = focused && work.id === activeWork?.id;
                  const selected = !focused && work.id === works[0]?.id;
                  return (
                    <div
                      key={work.id}
                      className={`ps-work ${open ? "open" : ""} ${selected ? "selected" : ""}`}
                    >
                      <div className="ps-work-top">
                        <button
                          className="ps-work-select"
                          onClick={() => openWork(work.id)}
                        >
                          <span className="ps-work-icon">
                            <FileText size={24} strokeWidth={1.6} />
                          </span>
                          <span className="ps-work-name">{work.title}</span>
                        </button>
                        {open ? (
                          <span className="ps-small-icon" aria-hidden="true">
                            <ChevronDown size={18} />
                          </span>
                        ) : (
                          <div
                            className="ps-menu"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              className="ps-small-icon"
                              aria-label={`Options for ${work.title}`}
                              onClick={() => {
                                setMenuWorkId(work.id);
                                setOpenMenu(
                                  openMenu === "project" &&
                                    menuWorkId === work.id
                                    ? null
                                    : "project",
                                );
                              }}
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openMenu === "project" &&
                              menuWorkId === work.id && (
                                <div className="ps-popover ps-project-popover">
                                  <button onClick={() => openWork(work.id)}>
                                    <House size={16} /> Open
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setOpenMenu(null);
                                      setPendingDelete(work);
                                    }}
                                  >
                                    <Trash2 size={16} /> Archive
                                  </button>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                      {open && (
                        <>
                          <nav
                            className="ps-subnav"
                            aria-label="Work pages"
                            data-section={route.section}
                          >
                            <SubLink
                              current={route.section}
                              section="dashboard"
                              href={workPath(work.id)}
                              onClick={() => openWork(work.id)}
                              icon={<House size={18} />}
                            >
                              Dashboard
                            </SubLink>
                            <SubLink
                              current={route.section}
                              section="analysis"
                              href={workPath(work.id, "analysis")}
                              onClick={() => openWork(work.id, "analysis")}
                              icon={<BarChart3 size={18} />}
                            >
                              Analysis
                            </SubLink>
                            <SubLink
                              current={route.section}
                              section="citations"
                              href={workPath(work.id, "citations")}
                              onClick={() => openWork(work.id, "citations")}
                              icon={<Link2 size={18} />}
                            >
                              Citations
                            </SubLink>
                          </nav>
                          <div className="ps-work-actions">
                            <button
                              className="ps-delete"
                              onClick={() => setPendingDelete(work)}
                            >
                              <Trash2 size={18} />
                              Archive work
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {!focused && (
              <div className="ps-sidebar-footer">
                <a className="ps-mcp-link" href="/app/integrations#connect">
                  <Plug size={18} /> Connect your chat
                </a>
                <button onClick={() => setOpenMenu("profile")}>
                  <Settings size={21} /> Settings
                </button>
                <button onClick={() => setOpenMenu("notifications")}>
                  <CircleHelp size={21} /> Help
                </button>
              </div>
            )}
          </div>
        </div>
        {sidebarTooltip && (
          <div
            className="ps-sidebar-tooltip"
            style={{ top: sidebarTooltip.top, left: sidebarTooltip.left }}
            aria-hidden="true"
          >
            {sidebarTooltip.text}
          </div>
        )}
      </aside>
      {sidebarOpen && (
        <button
          className="ps-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="ps-main">
        <header className="ps-topbar">
          <button
            className="ps-icon-button ps-hamburger"
            aria-label="Open menu"
            aria-controls="ps-sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="ps-search-wrap">
            <Search size={18} />
            <input
              aria-label="Search your work"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your work..."
            />
            {search && (
              <button
                className="ps-search-clear"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="ps-top-actions">
            <div
              className="ps-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="ps-icon-button ps-notification"
                aria-label="Notifications"
                onClick={() =>
                  setOpenMenu(
                    openMenu === "notifications" ? null : "notifications",
                  )
                }
              >
                <Bell size={20} />
              </button>
              {openMenu === "notifications" && (
                <div className="ps-popover ps-top-popover ps-notes">
                  <div className="ps-notes-heading">Notifications</div>
                  <p>
                    Open a document to upload sources, run analysis, and inspect
                    the evidence.
                  </p>
                  <a href="/app/class">Class tools</a>
                  <br />
                  <a href="/app/evidence">Evidence editor</a>
                </div>
              )}
            </div>
            <div
              className="ps-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="ps-account"
                aria-label="Account menu"
                onClick={() =>
                  setOpenMenu(openMenu === "profile" ? null : "profile")
                }
              >
                <span className="ps-avatar">
                  {(session.user?.name || "Local").slice(0, 2).toUpperCase()}
                </span>
                <ChevronDown size={16} />
              </button>
              {openMenu === "profile" && (
                <div className="ps-popover ps-top-popover ps-profile">
                  <div className="ps-profile-name">
                    {session.user?.name || "Local workspace"}
                    <span>
                      {persistent
                        ? "Saved to your account"
                        : "Saved in this browser"}
                    </span>
                  </div>
                  {session.user && (
                    <p>Jev usage: ${session.user.jevUsd.toFixed(5)} USD est.</p>
                  )}
                  <a href="/app/class">Class tools</a>
                  <br />
                  <a href="/app/evidence">Evidence editor</a>
                  {session.hosted && (
                    <button
                      onClick={() =>
                        void action(async () => {
                          if (session.provider === "workos")
                            window.location.assign("/auth/logout");
                          else {
                            await api("/api/session", undefined, "DELETE");
                            window.location.assign("/app");
                          }
                        })
                      }
                    >
                      Sign out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className="ps-content"
          ref={contentRef}
          key={route.workId ?? "library"}
        >
          {error && (
            <p className="ps-live-error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">Saving...</p>}
          {import.meta.env.DEV && !session.hosted && !persistent && (
            <p className="ps-local-preview" role="status">
              Local preview. Drafts are saved in this browser.
            </p>
          )}
          {!focused ? (
            <LibraryDashboard
              works={filtered}
              onOpen={openWork}
              onNew={() => setModal("new")}
            />
          ) : (
            <>
              <div className="ps-page-heading">
                <div className="ps-heading-copy">
                  <div className="ps-type">{activeWork.type}</div>
                  <h1>{activeWork.title}</h1>
                  <div className="ps-meta">
                    Last edited {activeWork.edited} <span>·</span>{" "}
                    {activeWork.words.toLocaleString()} words <span>·</span> MLA
                    9
                  </div>
                </div>
                <div className="ps-heading-actions">
                  <button className="ps-outline" onClick={openDocument}>
                    <FileText size={18} />
                    Open document
                  </button>
                  <div
                    className="ps-menu"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      className="ps-outline ps-square"
                      aria-label="More document options"
                      onClick={() =>
                        setOpenMenu(openMenu === "document" ? null : "document")
                      }
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    {openMenu === "document" && (
                      <div className="ps-popover ps-document-popover">
                        <button onClick={openDocument}>
                          <Pencil size={16} /> Edit document
                        </button>
                        <button
                          onClick={() => openWork(activeWork.id, "citations")}
                        >
                          <Link2 size={16} /> View citations
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <StudioAnalysis
                key={activeWork.id}
                work={activeWork}
                section={route.section}
                onUpdated={refreshWorks}
              />
            </>
          )}
        </main>
      </div>

      {pendingDelete && (
        <DeleteWorkDialog
          work={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onDelete={() => deleteWork(pendingDelete.id)}
        />
      )}

      {modal && (
        <dialog
          ref={dialogRef}
          className={`ps-modal ps-edit-dialog ${modal === "document" ? "ps-document-modal" : ""}`}
          onCancel={() => setModal(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
          aria-labelledby="studio-modal-title"
        >
          {error && (
            <p className="ps-live-error" role="alert">
              {error}
            </p>
          )}
          <div className="ps-modal-header">
            <div>
              <div className="ps-type">
                {modal === "new" ? "NEW WORK" : "DOCUMENT"}
              </div>
              <h2 id="studio-modal-title">
                {modal === "new" ? "Add new work" : activeWork?.title}
              </h2>
            </div>
            <button
              className="ps-icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
          </div>
          {modal === "new" && (
            <form onSubmit={addWork}>
              <label className="ps-field-label" htmlFor="work-title">
                Project title
              </label>
              <input
                id="work-title"
                className="ps-field"
                placeholder="e.g. My research paper"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                maxLength={300}
                autoFocus
              />
              <div className="ps-actions">
                <button
                  type="button"
                  className="ps-outline"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ps-primary"
                  disabled={busy || !newTitle.trim()}
                >
                  Create project
                </button>
              </div>
            </form>
          )}
          {modal === "document" && (
            <>
              <p className="ps-editor-hint">
                Make changes to your draft below. Your word count will update
                when you save.
              </p>
              <label className="ps-field-label">
                Import a document
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void action(async () => {
                      const form = new FormData();
                      form.append("file", file);
                      const response = await fetch("/api/documents/import", {
                        method: "POST",
                        body: form,
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw Error(result.error || "Import failed.");
                      setDraft(result.text);
                    });
                  }}
                />
              </label>
              <textarea
                className="ps-editor"
                aria-label="Document content"
                maxLength={100000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="ps-actions">
                <span className="ps-editor-count">
                  {draft.trim().split(/\s+/).filter(Boolean).length} words
                </span>
                <button className="ps-outline" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="ps-primary"
                  disabled={busy}
                  onClick={saveDocument}
                >
                  Save changes
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
    </div>
  );
}

function DeleteWorkDialog({
  work,
  onCancel,
  onDelete,
}: {
  work: Work;
  onCancel: () => void;
  onDelete: () => void;
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
      className="ps-modal ps-delete-dialog"
      aria-labelledby="delete-work-title"
      aria-describedby="delete-work-description"
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <h2 id="delete-work-title">Archive work?</h2>
      <p id="delete-work-description">
        “{work.title}” will be removed from your library. Existing reports are
        retained.
      </p>
      <div className="ps-actions">
        <button className="ps-outline" onClick={onCancel} autoFocus>
          Keep work
        </button>
        <button className="ps-danger" onClick={onDelete}>
          <Trash2 size={16} /> Archive work
        </button>
      </div>
    </dialog>
  );
}

function SubLink({
  current,
  section,
  href,
  onClick,
  icon,
  children,
}: {
  current: Section;
  section: Section;
  href: string;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={current === section ? "active" : ""}
      aria-current={current === section ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        onClick();
      }}
    >
      {icon}
      {children}
    </a>
  );
}

function LibraryDashboard({
  works,
  onOpen,
  onNew,
}: {
  works: Work[];
  onOpen: (id: string, section?: Section) => void;
  onNew: () => void;
}) {
  return (
    <div className="ps-home">
      <div className="ps-home-heading">
        <h1>My work</h1>
        <p>Open a draft to check its claims and citations.</p>
      </div>
      {!works.length && (
        <section className="ps-featured ps-featured-empty">
          <div className="ps-featured-copy">
            <h2>Start your first work</h2>
            <p>Add a draft, upload sources, and inspect the evidence.</p>
          </div>
          <button className="ps-featured-action" onClick={onNew}>
            Add new work <Plus size={18} />
          </button>
        </section>
      )}
      <div className="ps-home-panels">
        {works.map((work) => (
          <button
            className="ps-home-panel ps-work-card"
            key={work.id}
            onClick={() => onOpen(work.id)}
          >
            <FileText size={24} />
            <h2>{work.title}</h2>
            <p>
              {work.words} words · Last edited {work.edited}
            </p>
            <span>
              Open draft <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
      <section className="ps-quick-actions">
        <h2>Tools</h2>
        <div className="ps-quick-grid">
          <button onClick={onNew}>
            <Plus />
            <span>
              <strong>New draft</strong>
              <small>Paste or upload your writing</small>
            </span>
          </button>
          <a href="/app/class">Class tools</a>
          <a href="/app/evidence">Evidence editor</a>
        </div>
      </section>
    </div>
  );
}
