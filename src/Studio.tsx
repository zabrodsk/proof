import { readableDocumentTitle } from "./document-title";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { BackendFinding } from "../shared/backend";
import { findingTone, findingLabel } from "./studio-document";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
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
  FileUp,
  Plus,
  Play,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  Upload,
  CircleHelp,
  Plug,
  CircleX,
  LogOut,
  UserRound,
  X,
} from "lucide-react";
import "./studio.css";
import "./mcp-connect.css";
import StudioAnalysis from "./StudioAnalysis";
import StudioSettings from "./StudioSettings";
import { appRoutes } from "./app-navigation";
import { useStudioPreferences } from "./studio-preferences";
import NewStudioWork from "./NewStudioWork";
import StudioWorkIcon from "./StudioWorkIcon";
import {
  api,
  signOut,
  canUseLocalDrafts,
  serverWork,
  type Session,
  type StudioWork,
  type WorkIconName,
} from "./studio-api";

type Section = "dashboard" | "analysis" | "citations";
type Work = StudioWork;
type Route = { workId: string | null; section: Section };
type Menu = "profile" | "help" | "project" | "document" | null;

const sectionOrder: Section[] = ["dashboard", "analysis", "citations"];

function matchingWorks(works: Work[], query: string) {
  const normalized = query.trim().toLowerCase();
  return normalized
    ? works.filter((work) => work.title.toLowerCase().includes(normalized))
    : works;
}

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
    section: match[2] === "citations" ? "citations" : "dashboard",
  };
}

function workPath(id: string, section: Section = "dashboard") {
  if (section !== "citations") return `/app/works/${id}`;
  return `/app/works/${id}/${section}`;
}

export default function Studio({ session }: { session: Session }) {
  const storageKey = `proof.works.v2:${session.user?.id || "local"}`;
  const iconStorageKey = `proof.work-icons.v1:${session.user?.id || "local"}`;
  const iconPreferences = useRef<Record<string, WorkIconName>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(iconStorageKey) || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        iconPreferences.current = saved;
    } catch {
      iconPreferences.current = {};
    }
  }, [iconStorageKey]);
  const [path, setPath] = useState(window.location.pathname);
  const route = parseRoute(path);
  const isSettings = /^\/app\/settings(?:\/|$)/.test(path);
  const {
    preferences,
    updatePreferences,
    error: preferenceError,
  } = useStudioPreferences(session.user?.id);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  useEffect(() => {
    document.documentElement.dataset.proofMotion = preferences.motion;
    return () => {
      delete document.documentElement.dataset.proofMotion;
    };
  }, [preferences.motion]);
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
      all.push(
        ...result.items.map((row) => ({
          ...serverWork(row),
          icon: iconPreferences.current[row.id],
        })),
      );
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
                saved
                  .filter(
                    (item) =>
                      typeof item?.id === "string" &&
                      typeof item.title === "string" &&
                      typeof item.content === "string",
                  )
                  .map((item) => ({
                    ...item,
                    title: readableDocumentTitle(item.title),
                  })),
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
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const workspaceSearchRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<"new" | "document" | null>(null);
  const [newWorkMode, setNewWorkMode] = useState<"upload" | "paste">("upload");
  const [draft, setDraft] = useState("");
  const [openMenu, setOpenMenu] = useState<Menu>(null);
  const [menuWorkId, setMenuWorkId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarCollapsed = preferences.sidebarCollapsed;
  const [railSearchOpen, setRailSearchOpen] = useState(false);
  const [railQuery, setRailQuery] = useState("");
  const railSearchRef = useRef<HTMLDivElement>(null);
  const railSearchTrigger = useRef<HTMLButtonElement>(null);
  const closeRailSearch = () => {
    setRailSearchOpen(false);
    railSearchTrigger.current?.focus();
  };
  useEffect(() => {
    if (!railSearchOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !railSearchRef.current?.contains(event.target)
      )
        setRailSearchOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [railSearchOpen]);
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Work | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (modal) {
      dialog?.showModal();
      if (modal === "new")
        dialog?.querySelector<HTMLInputElement>("#new-work-title")?.focus();
    }
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
      preferencesRef.current.motion === "reduced" ||
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
        setRailSearchOpen(false);
        setWorkspaceSearchOpen(false);
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
        setRailSearchOpen(false);
        setWorkspaceSearchOpen(false);
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
    if (isSettings) {
      document.title = "Proof · Settings";
      return;
    }
    if (!focused) {
      document.title = "Proof · My work";
      return;
    }
    const page =
      route.section === "citations" ? "Sources & citations" : "Review";
    document.title = `Proof · ${page} · ${activeWork.title}`;
  }, [focused, route.section, activeWork?.title, isSettings]);

  const filtered = useMemo(
    () => (activeWork ? [activeWork] : matchingWorks(works, search)),
    [works, search, activeWork],
  );
  const searchResults = useMemo(
    () => matchingWorks(works, search),
    [works, search],
  );
  const railResults = useMemo(
    () => matchingWorks(works, railQuery),
    [works, railQuery],
  );

  const openWork = (id: string, section: Section = "dashboard") => {
    go(workPath(id, section));
    setSearch("");
    setRailSearchOpen(false);
    setWorkspaceSearchOpen(false);
    setRailQuery("");
  };

  const addWork = (title: string, text: string, icon: WorkIconName) => {
    if (!title || busy) return;
    void action(async () => {
      const work: Work = {
        id: crypto.randomUUID(),
        title,
        type: "DRAFT",
        words: text.trim().split(/\s+/).filter(Boolean).length,
        edited: "just now",
        content: text,
        icon,
      };
      if (persistent) {
        const result = await api<{ id: string; documentVersionId: string }>(
          "/api/v1/documents",
          { title, text: text || " " },
        );
        work.id = result.id;
        work.documentVersionId = result.documentVersionId;
      }
      iconPreferences.current = { ...iconPreferences.current, [work.id]: icon };
      try {
        localStorage.setItem(
          iconStorageKey,
          JSON.stringify(iconPreferences.current),
        );
      } catch {
        // Icon preferences are optional. Document saving has already succeeded.
      }
      setWorks((current) => [work, ...current]);
      setModal(null);
      openWork(work.id);
    });
  };
  const saveText = async (text: string) => {
    if (!activeWork) return undefined;
    let documentVersionId = activeWork.documentVersionId;
    let runId: string | undefined;
    if (persistent) {
      const result = await api<{ id: string; runId?: string }>(
        `/api/v1/documents/${activeWork.id}/versions`,
        { text: text || " ", expectedVersionId: documentVersionId },
      );
      documentVersionId = result.id;
      runId = result.runId;
    }
    setWorks((current) =>
      current.map((work) =>
        work.id === activeWork.id
          ? {
              ...work,
              content: text,
              words: text.trim().split(/\s+/).filter(Boolean).length,
              edited: "just now",
              documentVersionId,
            }
          : work,
      ),
    );
    return { runId };
  };
  const saveDocument = () => {
    if (!activeWork || busy) return;
    void action(async () => {
      await saveText(draft);
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
        <section className="ps-workspace-loading" aria-busy={!error}>
          <img
            src="/images/proof-logo-drawn-v1.png"
            alt=""
            width={48}
            height={48}
          />
          <h1>{error ? "Workspace unavailable" : "Opening your workspace"}</h1>
          <p role={error ? "alert" : "status"}>
            {error || "Loading your saved documents..."}
          </p>
          {error ? (
            <button
              className="ps-primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          ) : (
            <div className="ps-loading-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
            onClick={() => {
              updatePreferences({ sidebarCollapsed: false });
              setRailSearchOpen(false);
            }}
          >
            <img
              src="/images/proof-logo-drawn-v1.png"
              alt=""
              width={34}
              height={34}
            />
            <PanelLeftOpen className="ps-rail-expand" size={23} />
          </button>
          <div className="ps-rail-actions">
            <button
              className="ps-rail-button ps-rail-add"
              aria-label="Add new work"
              data-sidebar-tooltip="Add new work"
              onClick={() => {
                setNewWorkMode("upload");
                setModal("new");
              }}
            >
              <Plus size={22} />
            </button>
            <button
              className={`ps-rail-button ${!focused && !isSettings ? "active" : ""}`}
              aria-label="All work"
              data-sidebar-tooltip="All work"
              aria-current={!focused && !isSettings ? "page" : undefined}
              onClick={() => {
                go("/app");
                updatePreferences({ sidebarCollapsed: false });
                setSidebarTooltip(null);
              }}
            >
              <LayoutGrid size={21} />
            </button>
            <div
              className="ps-rail-search"
              ref={railSearchRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setRailSearchOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && railSearchOpen) {
                  event.stopPropagation();
                  closeRailSearch();
                }
              }}
            >
              <button
                ref={railSearchTrigger}
                className={`ps-rail-button ${railSearchOpen ? "active" : ""}`}
                aria-label="Search work"
                aria-controls="ps-rail-search-panel"
                aria-expanded={railSearchOpen}
                data-sidebar-tooltip="Search work"
                onClick={() => {
                  setSidebarTooltip(null);
                  setRailSearchOpen((open) => !open);
                }}
              >
                <Search size={21} />
              </button>
              {railSearchOpen && (
                <div
                  className="ps-rail-search-popover"
                  id="ps-rail-search-panel"
                  role="region"
                  aria-label="Search work"
                >
                  <div className="ps-rail-search-heading">
                    <strong>Search work</strong>
                    <button
                      className="ps-icon-button"
                      aria-label="Close search"
                      onClick={closeRailSearch}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="ps-rail-search-field">
                    <Search size={17} />
                    <input
                      autoFocus
                      aria-label="Search work"
                      placeholder="Search your work..."
                      value={railQuery}
                      onChange={(event) => setRailQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && railResults[0])
                          openWork(railResults[0].id);
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          railSearchRef.current
                            ?.querySelector<HTMLButtonElement>(
                              ".ps-rail-search-results button",
                            )
                            ?.focus();
                        }
                      }}
                    />
                    {railQuery && (
                      <button
                        className="ps-search-clear"
                        aria-label="Clear search"
                        onClick={() => {
                          setRailQuery("");
                          railSearchRef.current
                            ?.querySelector<HTMLInputElement>("input")
                            ?.focus();
                        }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <div
                    className="ps-rail-search-results"
                    aria-label="Matching work"
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                      const buttons = [
                        ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button",
                        ),
                      ];
                      const index = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      event.preventDefault();
                      if (event.key === "ArrowUp" && index === 0)
                        railSearchRef.current
                          ?.querySelector<HTMLInputElement>("input")
                          ?.focus();
                      else
                        buttons[
                          Math.max(
                            0,
                            Math.min(
                              buttons.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          )
                        ]?.focus();
                    }}
                  >
                    {railResults.map((work) => (
                      <button key={work.id} onClick={() => openWork(work.id)}>
                        <StudioWorkIcon name={work.icon} size={16} />
                        <span>{work.title}</span>
                      </button>
                    ))}
                    {!railResults.length && (
                      <p role="status">
                        {railQuery.trim()
                          ? "No matching work"
                          : "Your saved work will appear here."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
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
                  <StudioWorkIcon name={activeWork.icon} size={22} />
                </button>
                <button
                  className={`ps-rail-button ${route.section === "dashboard" ? "active" : ""}`}
                  aria-label="Review"
                  data-sidebar-tooltip="Review"
                  aria-current={
                    route.section === "dashboard" ? "page" : undefined
                  }
                  onClick={() => openWork(activeWork.id)}
                >
                  <House size={21} />
                </button>
                <button
                  className={`ps-rail-button ${route.section === "citations" ? "active" : ""}`}
                  aria-label="Sources & citations"
                  data-sidebar-tooltip="Sources & citations"
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
                  <StudioWorkIcon name={work.icon} size={22} />
                </button>
              ))
            )}
          </nav>
          {!focused && (
            <div className="ps-rail-footer">
              <a
                className="ps-rail-button"
                href={appRoutes.connections}
                aria-label="Connect ChatGPT or Claude"
                data-sidebar-tooltip="Connect ChatGPT or Claude"
              >
                <Plug size={21} />
              </a>
              <button
                className="ps-rail-button"
                aria-label="Settings"
                data-sidebar-tooltip="Settings"
                onClick={() => go(appRoutes.settings)}
              >
                <Settings size={21} />
              </button>
              <button
                className="ps-rail-button"
                aria-label="Help"
                data-sidebar-tooltip="Help"
                onClick={() => setOpenMenu("help")}
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
                width={34}
                height={34}
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
                updatePreferences({ sidebarCollapsed: true });
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
            <button
              className="ps-add"
              onClick={() => {
                setNewWorkMode("upload");
                setModal("new");
              }}
            >
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
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSearch("");
                        if (event.key === "Enter" && searchResults[0])
                          openWork(searchResults[0].id);
                      }}
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
                  <div className="ps-work-label">
                    <span>My work</span>
                    <span>{works.length}</span>
                  </div>
                </>
              )}
              {focused && (
                <button className="ps-back" onClick={() => go("/app")}>
                  <ArrowLeft size={16} />
                  All work
                </button>
              )}
              <div
                key={activeWork?.id ?? "library"}
                className={`ps-work-list ${focused ? "focused" : "divided"}`}
              >
                {filtered.length === 0 && (
                  <div className="ps-empty-search" role="status">
                    {search.trim()
                      ? "No matching work"
                      : "Your documents will appear here."}
                  </div>
                )}
                {filtered.map((work) => {
                  const open = focused && work.id === activeWork?.id;
                  return (
                    <div
                      key={work.id}
                      className={`ps-work ${open ? "open" : ""}`}
                    >
                      <div className="ps-work-top">
                        <button
                          className="ps-work-select"
                          onClick={() => openWork(work.id)}
                        >
                          <span className="ps-work-icon">
                            <StudioWorkIcon name={work.icon} size={24} />
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
                              Review
                            </SubLink>
                            <SubLink
                              current={route.section}
                              section="citations"
                              href={workPath(work.id, "citations")}
                              onClick={() => openWork(work.id, "citations")}
                              icon={<Link2 size={18} />}
                            >
                              Sources & citations
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
                <a href={appRoutes.connections}>
                  <Plug size={21} /> AI connections
                </a>
                <button onClick={() => go(appRoutes.settings)}>
                  <Settings size={21} /> Settings
                </button>
                <button onClick={() => setOpenMenu("help")}>
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
          <div
            className="ps-search-wrap"
            ref={workspaceSearchRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setWorkspaceSearchOpen(false);
            }}
          >
            <Search size={18} />
            <input
              aria-label="Search your work"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your work..."
              aria-expanded={workspaceSearchOpen}
              aria-controls="ps-workspace-search-results"
              onFocus={() => setWorkspaceSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setWorkspaceSearchOpen(false);
                }
                if (event.key === "Enter" && searchResults[0])
                  openWork(searchResults[0].id);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  workspaceSearchRef.current
                    ?.querySelector<HTMLButtonElement>(
                      ".ps-workspace-search-results button",
                    )
                    ?.focus();
                }
              }}
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
            {workspaceSearchOpen && (
              <div
                id="ps-workspace-search-results"
                className="ps-workspace-search-results ps-rail-search-results"
                aria-label="Matching work"
              >
                {searchResults.map((work) => (
                  <button key={work.id} onClick={() => openWork(work.id)}>
                    <StudioWorkIcon name={work.icon} size={18} />
                    <span>{work.title}</span>
                  </button>
                ))}
                {!searchResults.length && (
                  <p role="status">
                    {search.trim()
                      ? "No matching work"
                      : "Your saved work will appear here."}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="ps-top-actions">
            <div
              className="ps-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="ps-icon-button ps-notification"
                aria-label="Help"
                onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}
              >
                <CircleHelp size={20} />
              </button>
              {openMenu === "help" && (
                <div className="ps-popover ps-top-popover ps-notes">
                  <div className="ps-notes-heading">Help with Proof</div>
                  <p>
                    Open a document to upload sources, run analysis, and inspect
                    the evidence.
                  </p>
                  <a href={appRoutes.classroom}>Class tools</a>
                  <a href={appRoutes.evidence}>Evidence editor</a>
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
                  <a href={appRoutes.account}>
                    <UserRound size={16} /> Account settings
                  </a>
                  <a href={appRoutes.settings}>
                    <Settings size={16} /> App settings
                  </a>
                  <a href={appRoutes.connections}>
                    <Plug size={16} /> Connected tools
                  </a>
                  {session.hosted && (
                    <button
                      className="ps-profile-signout"
                      onClick={() =>
                        void action(async () => {
                          await signOut(session);
                        })
                      }
                    >
                      <LogOut size={16} /> Sign out
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
          key={isSettings ? "settings" : (route.workId ?? "library")}
        >
          {(error || preferenceError) && (
            <p className="ps-live-error" role="alert">
              {error || preferenceError}
            </p>
          )}
          {busy && <p role="status">Saving...</p>}
          {import.meta.env.DEV && !session.hosted && !persistent && (
            <p className="ps-local-preview" role="status">
              Local preview. Drafts are saved in this browser.
            </p>
          )}
          {isSettings ? (
            <StudioSettings
              session={session}
              persistent={persistent}
              onBack={() => go(appRoutes.home)}
            />
          ) : !focused ? (
            <LibraryDashboard
              works={filtered}
              allWorks={works}
              totalCount={works.length}
              searchQuery={search}
              onClearSearch={() => setSearch("")}
              onOpen={openWork}
              onNew={(mode = "upload") => {
                setNewWorkMode(mode);
                setModal("new");
              }}
            />
          ) : (
            <>
              <div className="ps-page-heading">
                <div className="ps-heading-copy">
                  <div className="ps-type">
                    {route.section === "citations"
                      ? "Sources & citations"
                      : "Review"}
                  </div>
                  <h1>{activeWork.title}</h1>
                  <div className="ps-meta">Last edited {activeWork.edited}</div>
                </div>
                <div className="ps-heading-actions">
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
                          <FileUp size={16} /> Import from a file
                        </button>
                        {route.section === "citations" ? (
                          <button onClick={() => openWork(activeWork.id)}>
                            <House size={16} /> Back to review
                          </button>
                        ) : (
                          <button
                            onClick={() => openWork(activeWork.id, "citations")}
                          >
                            <Link2 size={16} /> Sources & citations
                          </button>
                        )}
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
                onSave={saveText}
                onOpenSources={() => openWork(activeWork.id, "citations")}
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
          className={`ps-modal ps-edit-dialog ${modal === "document" ? "ps-document-modal" : "ps-new-work-dialog"}`}
          onCancel={() => setModal(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
          aria-labelledby="studio-modal-title"
        >
          {(error || preferenceError) && (
            <p className="ps-live-error" role="alert">
              {error || preferenceError}
            </p>
          )}
          <div className="ps-modal-header">
            <div>
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
            <NewStudioWork
              initialMode={newWorkMode}
              busy={busy}
              onCreate={addWork}
              onCancel={() => setModal(null)}
            />
          )}
          {modal === "document" && (
            <>
              <p className="ps-editor-hint">
                Import a file to replace the current text. Proof keeps the
                earlier version.
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
      className={
        current === section ||
        (section === "dashboard" && current === "analysis")
          ? "active"
          : ""
      }
      aria-current={
        current === section ||
        (section === "dashboard" && current === "analysis")
          ? "page"
          : undefined
      }
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

function DashboardIcon({
  kind,
}: {
  kind: "document" | "verified" | "review" | "incorrect";
}) {
  const Icon =
    kind === "document"
      ? FileText
      : kind === "verified"
        ? BadgeCheck
        : kind === "review"
          ? TriangleAlert
          : CircleX;
  return (
    <span className={`ps-home-icon ${kind}`} aria-hidden="true">
      <Icon size={24} strokeWidth={1.8} />
    </span>
  );
}

function DocumentIllustration() {
  return (
    <svg
      className="ps-document-illustration"
      viewBox="0 0 220 190"
      fill="none"
      aria-hidden="true"
    >
      <g
        stroke="#17392f"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g transform="rotate(-17 84 105)">
          <rect x="42" y="46" width="88" height="123" fill="#f7faf7" />
          <path d="M55 68h28M55 84h51M55 100h40M55 116h54M55 132h38" />
        </g>
        <g transform="rotate(-11 158 100)">
          <rect x="113" y="39" width="78" height="129" fill="#f7faf7" />
          <path d="M126 62h42M126 78h50M126 94h42M126 110h48M126 126h29M126 142h44" />
        </g>
        <g transform="rotate(-15 107 86)">
          <rect x="62" y="19" width="90" height="123" fill="#f7faf7" />
          <path d="M78 43h24M78 61h53M78 77h38M78 94h51M78 110h31M117 118h18" />
        </g>
        <path d="m180 13 5-19M193 24l18-22M202 39l20-8" />
      </g>
    </svg>
  );
}

type DashboardRun = {
  id: string;
  status: string;
  invalidated: boolean;
  document_version_id: string;
  created_at: string;
};
type WorkSummary = {
  run?: DashboardRun;
  findings: BackendFinding[];
  unavailable?: boolean;
};

function LibraryDashboard({
  works,
  allWorks,
  totalCount,
  searchQuery,
  onClearSearch,
  onOpen,
  onNew,
}: {
  works: Work[];
  allWorks: Work[];
  totalCount: number;
  searchQuery: string;
  onClearSearch: () => void;
  onOpen: (id: string, section?: Section) => void;
  onNew: (mode?: "upload" | "paste") => void;
}) {
  const [summaries, setSummaries] = useState<Record<string, WorkSummary>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setSummaries({});
    void (async () => {
      const next: Record<string, WorkSummary> = {};
      for (let start = 0; start < allWorks.length; start += 8) {
        const batch = allWorks.slice(start, start + 8);
        const results = await Promise.allSettled(
          batch.map(async (work): Promise<WorkSummary> => {
            if (!work.documentVersionId) return { findings: [] };
            const history = await api<{ items: DashboardRun[] }>(
              `/api/v1/documents/${work.id}/runs`,
            );
            const run = history.items.find(
              (item) =>
                !item.invalidated &&
                item.document_version_id === work.documentVersionId,
            );
            if (!run) return { findings: [] };
            const findings: BackendFinding[] = [];
            for (let offset = 0; ; offset += 100) {
              const page = await api<{ items: BackendFinding[] }>(
                `/api/v1/runs/${run.id}/findings?limit=100&offset=${offset}`,
              );
              findings.push(...page.items);
              if (page.items.length < 100) break;
            }
            return { run, findings };
          }),
        );
        if (disposed) return;
        results.forEach((result, index) => {
          next[batch[index].id] =
            result.status === "fulfilled"
              ? result.value
              : { findings: [], unavailable: true };
        });
      }
      if (!disposed) {
        setSummaries(next);
        setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [allWorks]);

  const searching = !!searchQuery.trim();
  const featured = works[0];
  const featuredSummary = featured ? summaries[featured.id] : undefined;
  const rows = works.flatMap((work) =>
    (summaries[work.id]?.findings || []).map((finding) => ({ work, finding })),
  );
  const attention = rows.filter(
    ({ finding }) => findingTone(finding) !== "supported",
  );
  const unavailable = works.some((work) => summaries[work.id]?.unavailable);
  const stats = [
    { kind: "document", value: rows.length, label: "Claims reviewed" },
    {
      kind: "verified",
      value: rows.filter(({ finding }) => findingTone(finding) === "supported")
        .length,
      label: "Supported",
    },
    {
      kind: "review",
      value: rows.filter(({ finding }) => findingTone(finding) !== "supported")
        .length,
      label: "Unsupported",
    },
  ] as const;
  const active =
    featuredSummary?.run &&
    ["queued", "running"].includes(featuredSummary.run.status);
  return (
    <div className="ps-home">
      <div className="ps-home-heading">
        <h1>Welcome back.</h1>
        <p>
          {searching
            ? `${works.length} results for "${searchQuery.trim()}"`
            : "Here is what needs attention."}
        </p>
      </div>
      {searching && (
        <button className="ps-dashboard-clear-search" onClick={onClearSearch}>
          Clear search <X size={15} />
        </button>
      )}
      {featured ? (
        <section className="ps-featured">
          <DashboardIcon kind="document" />
          <div className="ps-featured-copy">
            <h2>{featured.title}</h2>
            <p>
              {featured.words.toLocaleString()} words <span>·</span> Last edited{" "}
              {featured.edited}
            </p>
            <div className="ps-featured-progress">
              <span>
                {loading
                  ? "Loading analysis..."
                  : featuredSummary?.unavailable
                    ? "Analysis unavailable"
                    : active
                      ? "Analysis in progress"
                      : featuredSummary?.run
                        ? `${featuredSummary.findings.length} claims reviewed`
                        : "No analysis yet"}
              </span>
            </div>
          </div>
          <button
            className="ps-featured-action"
            onClick={() => onOpen(featured.id, "analysis")}
          >
            {featuredSummary?.run ? "Continue analysis" : "Start analysis"}{" "}
            <ArrowRight size={19} />
          </button>
          <DocumentIllustration />
        </section>
      ) : (
        <section className="ps-featured ps-featured-empty">
          <DashboardIcon kind="document" />
          <div className="ps-featured-copy">
            <h2>{searching ? "No matching work" : "Start your first work"}</h2>
            <p>
              {searching
                ? "Try a different title or clear your search."
                : "Upload a paper or paste your draft to begin."}
            </p>
          </div>
          <button
            className="ps-featured-action"
            onClick={() => (searching ? onClearSearch() : onNew())}
          >
            {searching ? "Clear search" : "Add new work"}{" "}
            <ArrowRight size={19} />
          </button>
        </section>
      )}
      <section
        className="ps-home-stats"
        aria-label="Evidence overview"
        aria-busy={loading}
      >
        {stats.map((stat) => (
          <div className="ps-home-stat" key={stat.label}>
            <DashboardIcon kind={stat.kind} />
            <div className="ps-home-stat-copy">
              <strong>{loading ? "..." : stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          </div>
        ))}
      </section>
      {unavailable && (
        <p className="ps-dashboard-status" role="status">
          Some analysis reports could not load. These totals include the
          available reports.
        </p>
      )}
      {!loading && !!works.length && !rows.length && !unavailable && (
        <p className="ps-dashboard-status">
          Run an analysis to see evidence findings for your current drafts.
        </p>
      )}
      <div className="ps-home-panels">
        <section className="ps-home-panel ps-attention-panel">
          <div className="ps-home-panel-heading">
            <h2>Needs your attention</h2>
            {attention[0] && (
              <button onClick={() => onOpen(attention[0].work.id, "analysis")}>
                View analysis <ArrowRight size={19} />
              </button>
            )}
          </div>
          <div className="ps-home-rows">
            {loading ? (
              <p className="ps-home-empty" role="status">
                Loading findings...
              </p>
            ) : attention.length ? (
              attention.slice(0, 5).map(({ work, finding }) => (
                <button
                  className="ps-attention-row"
                  key={`${work.id}:${finding.id}`}
                  onClick={() => onOpen(work.id, "analysis")}
                >
                  <DashboardIcon
                    kind={
                      finding.support === "contradicted" ||
                      finding.support === "overstated"
                        ? "incorrect"
                        : "review"
                    }
                  />
                  <span className="ps-attention-copy">
                    <strong>{finding.claim.text}</strong>
                    <span>
                      {work.title} <b>·</b> {findingLabel(finding)}
                    </span>
                  </span>
                  <ChevronDown size={19} className="ps-row-chevron" />
                </button>
              ))
            ) : (
              <p className="ps-home-empty">
                {unavailable
                  ? "Analysis reports are unavailable."
                  : rows.length
                    ? "No findings need review."
                    : "No analysis findings yet."}
              </p>
            )}
          </div>
        </section>
        <section className="ps-home-panel ps-activity-panel">
          <div className="ps-home-panel-heading">
            <h2>Recent activity</h2>
          </div>
          <div className="ps-home-rows">
            {works.length ? (
              works.slice(0, 5).map((work) => (
                <button
                  className="ps-activity-row ps-activity-button"
                  key={work.id}
                  onClick={() => onOpen(work.id)}
                >
                  <DashboardIcon kind="document" />
                  <span>{work.title}</span>
                  <time>{work.edited}</time>
                </button>
              ))
            ) : (
              <p className="ps-home-empty">
                Your saved documents will appear here.
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="ps-quick-actions">
        <h2>Quick actions</h2>
        <div className="ps-quick-grid">
          <button onClick={() => onNew("upload")}>
            <span>
              <Upload size={24} />
            </span>
            <span>
              <strong>Upload paper</strong>
              <small>PDF, DOCX, or text</small>
            </span>
          </button>
          <button onClick={() => onNew("paste")}>
            <span>
              <FileText size={24} />
            </span>
            <span>
              <strong>Paste text</strong>
              <small>Check claims and citations</small>
            </span>
          </button>
          <button
            onClick={() => featured && onOpen(featured.id, "citations")}
            disabled={!featured}
          >
            <span>
              <Link2 size={24} />
            </span>
            <span>
              <strong>Add source</strong>
              <small>Open your bibliography</small>
            </span>
          </button>
          <button
            onClick={() => featured && onOpen(featured.id, "analysis")}
            disabled={!featured}
          >
            <span>
              <Play size={24} />
            </span>
            <span>
              <strong>Start citation check</strong>
              <small>Choose sources and run</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
