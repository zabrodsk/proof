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
  BookOpen,
  FileText,
  FlaskConical,
  Folder,
  GraduationCap,
  House,
  Info,
  Link2,
  Lightbulb,
  Menu,
  MoreHorizontal,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
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
  CircleX,
  X,
} from "lucide-react";
import "./studio.css";

type Section = "dashboard" | "analysis" | "citations";
const workIconOptions = [
  { name: "folder", label: "Folder", Icon: Folder },
  { name: "document", label: "Document", Icon: FileText },
  { name: "book", label: "Book", Icon: BookOpen },
  { name: "notes", label: "Notes", Icon: NotebookPen },
  { name: "research", label: "Research", Icon: FlaskConical },
  { name: "study", label: "Study", Icon: GraduationCap },
  { name: "idea", label: "Idea", Icon: Lightbulb },
] as const;
type WorkIconName = (typeof workIconOptions)[number]["name"];
type Work = {
  id: string;
  title: string;
  type: string;
  words: number;
  edited: string;
  content: string;
  icon?: WorkIconName;
};
type Issue = {
  level: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  suggestion: string;
};
type Route = { workId: string | null; section: Section };
type Menu = "profile" | "notifications" | "project" | "document" | null;

const storageKey = "proof.works.v1";
const sectionOrder: Section[] = ["dashboard", "analysis", "citations"];

const initialWorks: Work[] = [
  {
    id: "social-media",
    title: "The Impact of Social Media on Mental Health",
    type: "ESSAY",
    words: 3428,
    edited: "2 hours ago",
    content:
      "The Impact of Social Media on Mental Health\n\nSocial media has become a central part of everyday life. This essay examines how online platforms shape mental well-being, social connection, and self-perception.\n\nWhile digital communities can offer valuable support, excessive use may contribute to anxiety and comparison. Thoughtful use and credible evidence are essential to understanding the full picture.",
  },
  {
    id: "climate",
    title: "Climate Change and Global Food Security",
    type: "RESEARCH PAPER",
    words: 2840,
    edited: "Yesterday",
    content:
      "Climate Change and Global Food Security\n\nClimate change is reshaping agricultural systems around the world. This paper explores the challenges facing food production and access.",
  },
  {
    id: "ai-education",
    title: "The Role of AI in Education",
    type: "ESSAY",
    words: 1960,
    edited: "2 days ago",
    content:
      "The Role of AI in Education\n\nArtificial intelligence is changing how students learn and educators teach.",
  },
  {
    id: "renewable",
    title: "Renewable Energy Policy Analysis",
    type: "ANALYSIS",
    words: 2415,
    edited: "3 days ago",
    content:
      "Renewable Energy Policy Analysis\n\nThe transition to clean energy relies on practical and equitable policy.",
  },
  {
    id: "gender",
    title: "Gender Equality in the Workplace",
    type: "ESSAY",
    words: 1750,
    edited: "4 days ago",
    content:
      "Gender Equality in the Workplace\n\nA fair workplace requires meaningful opportunity for everyone.",
  },
  {
    id: "sleep",
    title: "Literature Review: Sleep and Cognition",
    type: "LITERATURE REVIEW",
    words: 3080,
    edited: "Last week",
    content:
      "Literature Review: Sleep and Cognition\n\nSleep plays a crucial role in memory, attention, and learning.",
  },
  {
    id: "urban",
    title: "Urban Development and Sustainable Cities",
    type: "RESEARCH PAPER",
    words: 2210,
    edited: "Last week",
    content:
      "Urban Development and Sustainable Cities\n\nCities face the challenge of growing while reducing their environmental impact.",
  },
];

const issues: Issue[] = [
  {
    level: "High",
    title: "Conclusion claim lacks a supporting citation",
    detail:
      "Add a credible source to support the claim about long-term mental health effects.",
    suggestion:
      "Find a peer-reviewed study on long-term mental health outcomes and cite it alongside the conclusion claim.",
  },
  {
    level: "Medium",
    title: "Paraphrasing too close to source",
    detail:
      "Consider rewording the sentence in paragraph 4 to better match your own voice.",
    suggestion:
      "Rewrite the idea in your own words, then check that the original source is still credited.",
  },
  {
    level: "Low",
    title: "Inconsistent citation format",
    detail: "A few in-text citations don't match APA 7th edition style.",
    suggestion:
      "Check author names, publication years, and punctuation against APA 7th edition guidelines.",
  },
];

const sources = [
  {
    title: "Digital media use and adolescent mental health",
    author: "Journal of Adolescent Health · 2023",
    type: "Journal article",
  },
  {
    title: "Social connection in the digital age",
    author: "American Psychological Association · 2022",
    type: "Research report",
  },
  {
    title: "Online communities and psychological well-being",
    author: "Computers in Human Behavior · 2021",
    type: "Journal article",
  },
];

function parseRoute(pathname: string): Route {
  const match = pathname.match(
    /^\/app\/works\/([^/]+)(?:\/(analysis|citations))?\/?$/,
  );
  if (!match) return { workId: null, section: "dashboard" };
  return {
    workId: decodeURIComponent(match[1]),
    section: (match[2] as Section) || "dashboard",
  };
}

function workPath(id: string, section: Section = "dashboard") {
  if (section === "dashboard") return `/app/works/${id}`;
  return `/app/works/${id}/${section}`;
}

function loadWorks(): Work[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (Array.isArray(saved) && saved.every((item) => item?.id && item?.title))
      return saved;
  } catch {}
  return initialWorks;
}

export default function Studio() {
  const [path, setPath] = useState(window.location.pathname);
  const route = parseRoute(path);
  const [works, setWorks] = useState(loadWorks);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"new" | "document" | "issue" | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<Issue>(issues[0]);
  const [openMenu, setOpenMenu] = useState<Menu>(null);
  const [menuWorkId, setMenuWorkId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railSearchOpen, setRailSearchOpen] = useState(false);
  const [railQuery, setRailQuery] = useState("");
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const [notificationRead, setNotificationRead] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Work | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const sidebarWorkRef = useRef<HTMLDivElement>(null);
  const railSearchRef = useRef<HTMLDivElement>(null);
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
    try {
      localStorage.setItem(storageKey, JSON.stringify(works));
    } catch {}
  }, [works]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setOpenMenu(null);
        setSidebarOpen(false);
        setRailSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!railSearchOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !railSearchRef.current?.contains(event.target)
      ) {
        setRailSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [railSearchOpen]);

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
    if (route.workId && !works.some((work) => work.id === route.workId)) {
      window.history.replaceState({}, "", "/app");
      pathRef.current = "/app";
      setPath("/app");
    }
  }, [route.workId, works]);

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

  const railMatches = works.filter((work) =>
    work.title.toLowerCase().includes(railQuery.trim().toLowerCase()),
  );

  const openWork = (id: string, section: Section = "dashboard") => {
    go(workPath(id, section));
    setSearch("");
    setRailSearchOpen(false);
    setRailQuery("");
  };

  const addWork = ({
    title,
    icon,
    content,
  }: {
    title: string;
    icon: WorkIconName;
    content?: string;
  }) => {
    const work: Work = {
      id: `work-${Date.now()}`,
      title,
      type: content ? "DOCUMENT" : "ESSAY",
      words: content ? content.trim().split(/\s+/).length : 0,
      edited: "just now",
      content: content ?? `${title}\n\nStart writing here...`,
      icon,
    };
    setWorks((current) => [work, ...current]);
    setModal(null);
    openWork(work.id);
  };

  const saveDocument = () => {
    if (!activeWork) return;
    const words = draft.trim().split(/\s+/).filter(Boolean).length;
    setWorks((current) =>
      current.map((work) =>
        work.id === activeWork.id
          ? { ...work, content: draft, words, edited: "just now" }
          : work,
      ),
    );
    setModal(null);
  };

  const deleteWork = (id: string) => {
    setWorks((current) => current.filter((work) => work.id !== id));
    setOpenMenu(null);
    setPendingDelete(null);
    if (route.workId === id) {
      setSearch("");
      go("/app");
    }
  };

  const openDocument = () => {
    if (!activeWork) return;
    setDraft(activeWork.content);
    setOpenMenu(null);
    setModal("document");
  };

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
              setSidebarCollapsed(false);
              setRailSearchOpen(false);
            }}
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
            <div className="ps-rail-search" ref={railSearchRef}>
              <button
                className={`ps-rail-button ${railSearchOpen ? "active" : ""}`}
                aria-label="Search work"
                aria-controls="ps-rail-search-panel"
                aria-expanded={railSearchOpen}
                data-sidebar-tooltip="Search work"
                onClick={() => setRailSearchOpen((open) => !open)}
              >
                <Search size={21} />
              </button>
              {railSearchOpen && (
                <div
                  className="ps-rail-search-popover"
                  id="ps-rail-search-panel"
                >
                  <div className="ps-rail-search-field">
                    <Search size={17} />
                    <input
                      autoFocus
                      aria-label="Search work"
                      placeholder="Search your work..."
                      value={railQuery}
                      onChange={(event) => setRailQuery(event.target.value)}
                    />
                  </div>
                  {railQuery.trim() && (
                    <div className="ps-rail-search-results">
                      {railMatches.length ? (
                        railMatches.map((work) => (
                          <button
                            key={work.id}
                            onClick={() => openWork(work.id)}
                          >
                            <WorkIcon name={work.icon} size={16} />
                            <span>{work.title}</span>
                          </button>
                        ))
                      ) : (
                        <p>No matching work</p>
                      )}
                    </div>
                  )}
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
                  <WorkIcon name={activeWork.icon} size={22} />
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
                  <WorkIcon name={work.icon} size={22} />
                </button>
              ))
            )}
          </nav>
          {!focused && (
            <div className="ps-rail-footer">
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
                            <WorkIcon name={work.icon} size={24} />
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
                                    <Trash2 size={16} /> Delete
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
                              Delete work
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
                {!notificationRead && <span className="ps-dot" />}
              </button>
              {openMenu === "notifications" && (
                <div className="ps-popover ps-top-popover ps-notes">
                  <div className="ps-notes-heading">Notifications</div>
                  <p>
                    {notificationRead
                      ? "You're all caught up."
                      : "Your citation health report is ready to review."}
                  </p>
                  {!notificationRead && (
                    <button
                      className="ps-popover-action"
                      onClick={() => {
                        if (activeWork) openWork(activeWork.id, "analysis");
                        else if (works[0]) openWork(works[0].id, "analysis");
                        setNotificationRead(true);
                        setOpenMenu(null);
                      }}
                    >
                      View report <ArrowRight size={15} />
                    </button>
                  )}
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
                <span className="ps-avatar">JD</span>
                <ChevronDown size={16} />
              </button>
              {openMenu === "profile" && (
                <div className="ps-popover ps-top-popover ps-profile">
                  <div className="ps-profile-name">
                    Jamie Doe<span>Personal workspace</span>
                  </div>
                  <button onClick={() => setOpenMenu(null)}>
                    <Check size={16} /> Account active
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className="ps-content"
          ref={contentRef}
          key={`${route.workId ?? "library"}:${route.section}`}
        >
          {!focused ? (
            <LibraryDashboard
              works={works}
              onOpen={openWork}
              onNew={() => setModal("new")}
              onNotifications={() => setOpenMenu("notifications")}
            />
          ) : (
            <>
              <div className="ps-page-heading">
                <div className="ps-heading-copy">
                  <div className="ps-type">{activeWork.type}</div>
                  <h1>{activeWork.title}</h1>
                  <div className="ps-meta">
                    Last edited {activeWork.edited} <span>·</span>{" "}
                    {activeWork.words.toLocaleString()} words <span>·</span> APA
                    7th edition
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

              {route.section === "dashboard" && (
                <Dashboard
                  onAnalysis={() => openWork(activeWork.id, "analysis")}
                  onIssue={(issue) => {
                    setSelectedIssue(issue);
                    setModal("issue");
                  }}
                />
              )}
              {route.section === "analysis" && (
                <Analysis
                  onIssue={(issue) => {
                    setSelectedIssue(issue);
                    setModal("issue");
                  }}
                />
              )}
              {route.section === "citations" && <Citations />}
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
        <div
          className="ps-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div
            className={`ps-modal ${modal === "document" ? "ps-document-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-modal-title"
          >
            <div className="ps-modal-header">
              <div>
                <div className="ps-type">
                  {modal === "new"
                    ? "NEW WORK"
                    : modal === "issue"
                      ? `${selectedIssue.level.toUpperCase()} PRIORITY`
                      : "DOCUMENT"}
                </div>
                <h2 id="studio-modal-title">
                  {modal === "new"
                    ? "Add new work"
                    : modal === "issue"
                      ? selectedIssue.title
                      : activeWork?.title}
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
              <NewWorkForm onCreate={addWork} />
            )}
            {modal === "document" && (
              <>
                <p className="ps-editor-hint">
                  Make changes to your draft below. Your word count will update
                  when you save.
                </p>
                <textarea
                  className="ps-editor"
                  aria-label="Document content"
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
                  <button className="ps-primary" onClick={saveDocument}>
                    Save changes
                  </button>
                </div>
              </>
            )}
            {modal === "issue" && (
              <>
                <p className="ps-issue-detail">{selectedIssue.detail}</p>
                <div className="ps-recommend">
                  <Sparkles size={20} className="ps-green" />
                  <div>
                    <strong>Suggested next step</strong>
                    <p>{selectedIssue.suggestion}</p>
                  </div>
                </div>
                <div className="ps-actions">
                  <button className="ps-outline" onClick={() => setModal(null)}>
                    Close
                  </button>
                  <button className="ps-primary" onClick={openDocument}>
                    Open document <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkIcon({ name, size }: { name?: WorkIconName; size: number }) {
  const Icon = workIconOptions.find((option) => option.name === name)?.Icon ?? FileText;
  return <Icon size={size} strokeWidth={1.6} />;
}

function NewWorkForm({
  onCreate,
}: {
  onCreate: (work: {
    title: string;
    icon: WorkIconName;
    content?: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<WorkIconName>("folder");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setError("");
    if (!file) {
      onCreate({ title: name, icon });
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/documents/import", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      const result = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !result.text)
        throw new Error(result.error || "Could not attach this work.");
      onCreate({ title: name, icon, content: result.text });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not attach this work.");
    } finally {
      request.current = null;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="ps-field-label" htmlFor="work-title">
        Project title
      </label>
      <div
        className="ps-new-work-name"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPickerOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && pickerOpen) {
            event.stopPropagation();
            setPickerOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="ps-new-work-icon-trigger"
          aria-label="Choose project icon"
          aria-expanded={pickerOpen}
          aria-controls="ps-new-work-icon-picker"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <WorkIcon name={icon} size={21} />
          <ChevronDown size={13} />
        </button>
        <input
          id="work-title"
          className="ps-field ps-new-work-title"
          placeholder="e.g. My research paper"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        {pickerOpen && (
          <div
            id="ps-new-work-icon-picker"
            className="ps-new-work-icon-picker"
            role="group"
            aria-label="Project icons"
          >
            {workIconOptions.map((option) => (
              <button
                key={option.name}
                type="button"
                title={option.label}
                aria-label={`${option.label} icon`}
                aria-pressed={icon === option.name}
                onClick={() => {
                  setIcon(option.name);
                  setPickerOpen(false);
                }}
              >
                <option.Icon size={22} strokeWidth={1.6} />
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        className="ps-new-work-file-input"
        type="file"
        accept=".pdf,.docx,.txt,.md"
        aria-label="Attach work file"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (selected && selected.size > 12 * 1024 * 1024) {
            setError("Choose a file smaller than 12 MB.");
            return;
          }
          setFile(selected);
          setError("");
        }}
      />
      {file && (
        <div className="ps-new-work-attachment">
          <FileText size={16} aria-hidden="true" />
          <span title={file.name}>{file.name}</span>
          <button
            type="button"
            aria-label="Remove attached work"
            onClick={() => setFile(null)}
            disabled={busy}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {error && <p className="ps-new-work-error" role="alert">{error}</p>}
      <div className="ps-actions ps-new-work-actions">
        <button
          type="button"
          className="ps-new-work-attach"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <Paperclip size={17} />
          Attach work
        </button>
        <button type="submit" className="ps-primary" disabled={!title.trim() || busy}>
          {busy ? "Attaching…" : "Create project"}
        </button>
      </div>
    </form>
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
      <h2 id="delete-work-title">Delete work?</h2>
      <p id="delete-work-description">
        “{work.title}” and its document will be permanently deleted.
      </p>
      <div className="ps-actions">
        <button className="ps-outline" onClick={onCancel} autoFocus>
          Keep work
        </button>
        <button className="ps-danger" onClick={onDelete}>
          <Trash2 size={16} /> Delete work
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

const attention = [
  {
    workId: "renewable",
    icon: "incorrect",
    title: "Incorrect number of participants",
    page: 4,
  },
  {
    workId: "ai-education",
    icon: "review",
    title: "Source not found",
    page: 12,
  },
  {
    workId: "social-media",
    icon: "incorrect",
    title: "Claim is overstated",
    page: 8,
  },
  {
    workId: "gender",
    icon: "review",
    title: "Citation may not support claim",
    page: 15,
  },
  { workId: "sleep", icon: "incorrect", title: "Wrong year cited", page: 7 },
] as const;

const activity = [
  { icon: "document", title: "Added 4 new sources", time: "2 hours ago" },
  { icon: "verified", title: "Checked 8 citations", time: "3 hours ago" },
  { icon: "review", title: "Found 2 misleading claims", time: "5 hours ago" },
  { icon: "document", title: "Uploaded new version", time: "1 day ago" },
  { icon: "verified", title: "Fixed 3 citations", time: "2 days ago" },
] as const;

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

function LibraryDashboard({
  works,
  onOpen,
  onNew,
  onNotifications,
}: {
  works: Work[];
  onOpen: (id: string, section?: Section) => void;
  onNew: () => void;
  onNotifications: () => void;
}) {
  const featured = works[0];
  const attentionRows = attention.flatMap((item) => {
    const work = works.find((candidate) => candidate.id === item.workId);
    return work ? [{ ...item, work }] : [];
  });
  const stats = [
    {
      kind: "document",
      value: "27",
      label: "Citations checked",
    },
    {
      kind: "verified",
      value: "19",
      label: "Verified",
    },
    {
      kind: "review",
      value: "5",
      label: "Need review",
    },
    {
      kind: "incorrect",
      value: "3",
      label: "Misleading or incorrect",
    },
  ] as const;

  return (
    <div className="ps-home">
      <div className="ps-home-heading">
        <h1>Welcome back.</h1>
        <p>Here’s what needs attention.</p>
      </div>

      {featured ? (
        <section className="ps-featured">
          <span className="ps-home-icon document" aria-hidden="true">
            <WorkIcon name={featured.icon} size={24} />
          </span>
          <div className="ps-featured-copy">
            <h2>{featured.title}</h2>
            <p>
              {featured.words.toLocaleString()} words <span>·</span> Last edited{" "}
              {featured.edited}
            </p>
            <div className="ps-featured-progress">
              <span className="ps-progress-track">
                <span />
              </span>
              <span>12 / 15 citations checked</span>
            </div>
          </div>
          <button
            className="ps-featured-action"
            onClick={() => onOpen(featured.id, "analysis")}
          >
            Continue analysis <ArrowRight size={19} />
          </button>
          <DocumentIllustration />
        </section>
      ) : (
        <section className="ps-featured ps-featured-empty">
          <DashboardIcon kind="document" />
          <div className="ps-featured-copy">
            <h2>Start your first work</h2>
            <p>Add a paper or draft to begin checking citations.</p>
          </div>
          <button className="ps-featured-action" onClick={onNew}>
            Add new work <ArrowRight size={19} />
          </button>
        </section>
      )}

      <section className="ps-home-stats" aria-label="Citation overview">
        {stats.map((stat) => (
          <div className="ps-home-stat" key={stat.label}>
            <DashboardIcon kind={stat.kind} />
            <div className="ps-home-stat-copy">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          </div>
        ))}
      </section>

      <div className="ps-home-panels">
        <section className="ps-home-panel ps-attention-panel">
          <div className="ps-home-panel-heading">
            <h2>Needs your attention</h2>
            <button onClick={() => featured && onOpen(featured.id, "analysis")}>
              View all <ArrowRight size={19} />
            </button>
          </div>
          <div className="ps-home-rows">
            {attentionRows.length ? (
              attentionRows.map((item) => (
                <button
                  className="ps-attention-row"
                  key={item.title}
                  onClick={() => onOpen(item.work.id, "analysis")}
                >
                  <DashboardIcon kind={item.icon} />
                  <span className="ps-attention-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.work.title} <b>·</b> p. {item.page}
                    </span>
                  </span>
                  <ChevronDown size={19} className="ps-row-chevron" />
                </button>
              ))
            ) : (
              <p className="ps-home-empty">No items need attention.</p>
            )}
          </div>
        </section>
        <section className="ps-home-panel ps-activity-panel">
          <div className="ps-home-panel-heading">
            <h2>Recent activity</h2>
            <button onClick={onNotifications}>
              View all <ArrowRight size={19} />
            </button>
          </div>
          <div className="ps-home-rows">
            {activity.map((item) => (
              <div className="ps-activity-row" key={item.title}>
                <DashboardIcon kind={item.icon} />
                <span>{item.title}</span>
                <time>{item.time}</time>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="ps-quick-actions">
        <h2>Quick actions</h2>
        <div className="ps-quick-grid">
          <button onClick={onNew}>
            <span>
              <Upload size={24} />
            </span>
            <span>
              <strong>Upload paper</strong>
              <small>PDF, DOCX, or text</small>
            </span>
          </button>
          <button onClick={onNew}>
            <span>
              <FileText size={24} />
            </span>
            <span>
              <strong>Paste text</strong>
              <small>Check citations in text</small>
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
              <small>Manually add a source</small>
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
              <small>Check all citations</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Dashboard({
  onAnalysis,
  onIssue,
}: {
  onAnalysis: () => void;
  onIssue: (issue: Issue) => void;
}) {
  return (
    <>
      <div className="ps-overview">
        <section className="ps-card ps-health">
          <h2>
            Citation Health Score <Info size={16} className="ps-muted-icon" />
          </h2>
          <div className="ps-health-content">
            <div className="ps-score-ring" aria-hidden="true">
              <div className="ps-score-inner">
                <strong>82</strong>
                <span>Good</span>
              </div>
            </div>
            <div className="ps-health-copy">
              <h3>Your citations look strong</h3>
              <p>
                Most claims are supported with credible sources. A few areas
                could use additional evidence.
              </p>
              <button className="ps-soft" onClick={onAnalysis}>
                <ArrowUpRight size={18} />
                See suggestions
              </button>
            </div>
          </div>
        </section>
        <section className="ps-card ps-evidence">
          <div className="ps-card-heading">
            <h2>
              Evidence Coverage <Info size={16} className="ps-muted-icon" />
            </h2>
            <button className="ps-text-link" onClick={onAnalysis}>
              View analysis <ArrowRight size={16} />
            </button>
          </div>
          <div
            className="ps-coverage"
            aria-label="Evidence coverage: 68 percent well supported, 21 percent partially supported, 11 percent needs support"
          >
            {Array.from({ length: 88 }, (_, index) => {
              const col = index % 22;
              const row = Math.floor(index / 22);
              return (
                <span
                  key={index}
                  className={
                    col < 8 + (row % 3)
                      ? "covered"
                      : col < 14 + (row % 4)
                        ? "partial"
                        : "uncovered"
                  }
                />
              );
            })}
          </div>
          <div className="ps-legend">
            <div>
              <span className="ps-legend-dot well" />
              <span>Well supported</span>
              <strong>68%</strong>
            </div>
            <div>
              <span className="ps-legend-dot partly" />
              <span>Partially supported</span>
              <strong>21%</strong>
            </div>
            <div>
              <span className="ps-legend-dot needs" />
              <span>Needs support</span>
              <strong>11%</strong>
            </div>
          </div>
        </section>
      </div>
      <section className="ps-card ps-insights">
        <h2>
          <Sparkles size={22} className="ps-green" />
          Quick Insights
        </h2>
        <div className="ps-insights-grid">
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <FileText size={22} />
            </span>
            <div>
              <h3>Strong sources</h3>
              <p>You're using 12 credible, peer-reviewed sources.</p>
            </div>
          </div>
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <BarChart3 size={22} />
            </span>
            <div>
              <h3>Consider more evidence</h3>
              <p>
                2 key claims in your conclusion could use additional support.
              </p>
            </div>
          </div>
          <div className="ps-insight">
            <span className="ps-insight-icon">
              <Link2 size={22} />
            </span>
            <div>
              <h3>Good source variety</h3>
              <p>
                You have a healthy mix of journals, books, and reputable web
                sources.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="ps-card ps-issues">
        <div className="ps-card-heading">
          <h2>
            <TriangleAlert size={20} className="ps-red" />
            Recent Issues
          </h2>
          <button className="ps-text-link" onClick={onAnalysis}>
            View all issues <ArrowRight size={16} />
          </button>
        </div>
        <div className="ps-issue-list">
          {issues.map((issue) => (
            <IssueRow
              key={issue.title}
              issue={issue}
              onClick={() => onIssue(issue)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function Analysis({ onIssue }: { onIssue: (issue: Issue) => void }) {
  return (
    <div>
      <div className="ps-detail-heading">
        <div>
          <h2>Evidence analysis</h2>
          <p>A closer look at the support behind your work.</p>
        </div>
        <span className="ps-pill">
          <Check size={16} /> 68% well supported
        </span>
      </div>
      <div className="ps-analysis-summary">
        <div className="ps-card ps-stat">
          <span>Well supported</span>
          <strong>68%</strong>
          <div className="ps-track">
            <span style={{ width: "68%" }} />
          </div>
        </div>
        <div className="ps-card ps-stat">
          <span>Partially supported</span>
          <strong>21%</strong>
          <div className="ps-track partial">
            <span style={{ width: "21%" }} />
          </div>
        </div>
        <div className="ps-card ps-stat">
          <span>Needs support</span>
          <strong>11%</strong>
          <div className="ps-track needs">
            <span style={{ width: "11%" }} />
          </div>
        </div>
      </div>
      <section className="ps-card ps-analysis-issues">
        <h2>Suggestions to improve</h2>
        <div className="ps-issue-list">
          {issues.map((issue) => (
            <IssueRow
              key={issue.title}
              issue={issue}
              onClick={() => onIssue(issue)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function Citations() {
  return (
    <div>
      <div className="ps-detail-heading">
        <div>
          <h2>Sources & citations</h2>
          <p>Keep your references organized and consistent.</p>
        </div>
        <span className="ps-pill">
          <Check size={16} /> APA 7th edition
        </span>
      </div>
      <section className="ps-card ps-citations">
        <div className="ps-citations-title">
          <h2>References</h2>
          <span>12 sources</span>
        </div>
        {sources.map((source, index) => (
          <div className="ps-source" key={source.title}>
            <span className="ps-source-icon">
              <FileText size={20} />
            </span>
            <div>
              <h3>{source.title}</h3>
              <p>{source.author}</p>
            </div>
            <span className="ps-source-type">{source.type}</span>
            <span className="ps-source-number">0{index + 1}</span>
          </div>
        ))}
        <div className="ps-citations-note">
          Showing 3 of 12 sources in this preview.
        </div>
      </section>
    </div>
  );
}

function IssueRow({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return (
    <button className="ps-issue" onClick={onClick}>
      <span className={`ps-severity ${issue.level.toLowerCase()}`}>
        <i />
        {issue.level}
      </span>
      <span className="ps-issue-copy">
        <strong>{issue.title}</strong>
        <span>{issue.detail}</span>
      </span>
      <ArrowRight size={16} className="ps-issue-arrow" />
    </button>
  );
}
