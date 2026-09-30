import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FilePenLine,
  FileText,
  Files,
  FolderOpen,
  GraduationCap,
  LoaderCircle,
  Menu,
  Newspaper,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import "@fontsource/newsreader/700.css";
import "./landing.css";
import { DocumentIllustration, MotifIcon, InkFrame } from "./Drawn";

const documentTypes = [
  { kind: "papers", label: "Research papers" },
  { kind: "essays", label: "Essays" },
  { kind: "theses", label: "Theses" },
  { kind: "reports", label: "Reports & articles" },
  { kind: "other", label: "Other projects" },
] as const;

type UseKind = (typeof documentTypes)[number]["kind"];
const useForIcons: Record<UseKind, LucideIcon> = {
  papers: Files,
  essays: FilePenLine,
  theses: GraduationCap,
  reports: Newspaper,
  other: FolderOpen,
};

function UseForIcon({ kind }: { kind: UseKind }) {
  const Icon = useForIcons[kind];
  return (
    <Icon
      className="lp-use-icon"
      size={76}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
}

function Wordmark() {
  return (
    <a href="/" aria-label="Proof home" className="lp-wordmark">
      <img
        className="proof-logo-mark"
        src="/images/proof-logo-drawn-v1.png"
        alt=""
        width="44"
        height="44"
      />
      <span>
        proof<span>.</span>
      </span>
    </a>
  );
}

const schoolLogos = [
  { name: "Harvard University", file: "harvard.svg" },
  { name: "Massachusetts Institute of Technology", file: "mit.svg" },
  { name: "Stanford University", file: "stanford.svg" },
  { name: "University of Oxford", file: "oxford.svg" },
  { name: "Yale University", file: "yale.svg" },
] as const;

function SchoolLogoRow() {
  return (
    <section className="lp-schools" aria-label="University logos">
      <div className="lp-schools-track">
        {[false, true].map((duplicate) => (
          <div
            className="lp-schools-group"
            key={String(duplicate)}
            aria-hidden={duplicate || undefined}
          >
            {schoolLogos.map(({ name, file }) => (
              <div className="lp-school-logo" key={file}>
                <img
                  src={`/images/schools/${file}`}
                  alt={duplicate ? "" : name}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function WaitlistForm({ placement }: { placement: "hero" | "footer" }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    const form = new FormData(event.currentTarget);
    setState("loading");
    setMessage("");
    controller.current = new AbortController();
    const timeout = window.setTimeout(() => controller.current?.abort(), 15000);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.current.signal,
        body: JSON.stringify({
          email: form.get("email"),
          website: form.get("website"),
          consent: true,
          source: placement,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "We could not save your email. Please try again.",
        );
      setState("success");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error &&
          error.name !== "AbortError" &&
          error.message !== "Failed to fetch"
          ? error.message
          : "Could not reach Proof. Please try again.",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return (
    <div className="lp-waitlist-wrap">
      {state === "success" ? (
        <div className="lp-joined" role="status">
          <span>
            <Check size={20} />
          </span>
          <div>
            You're on the list.
            <small>We'll email you when early access opens.</small>
          </div>
        </div>
      ) : (
        <form
          className="lp-waitlist"
          onSubmit={join}
          aria-label={`Join the waitlist, ${placement}`}
        >
          <label htmlFor={`${id}-email`} className="lp-sr-only">
            Email address
          </label>
          <input
            id={`${id}-email`}
            type="email"
            name="email"
            placeholder="Email address"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            aria-describedby={`${id}-note${state === "error" ? ` ${id}-error` : ""}`}
            disabled={state === "loading"}
          />
          <div className="lp-honeypot" aria-hidden="true">
            <label htmlFor={`${id}-website`}>Leave this field empty</label>
            <input
              id={`${id}-website`}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={state === "loading"}>
            {state === "loading" ? (
              <>
                Joining
                <LoaderCircle size={17} className="lp-spin" />
              </>
            ) : (
              <>
                Join the waitlist
                <ArrowUpRight size={18} />
              </>
            )}
          </button>
        </form>
      )}
      {state === "error" && (
        <p id={`${id}-error`} className="lp-form-error" role="alert">
          {message}
        </p>
      )}
      <p id={`${id}-note`} className="lp-form-note">
        Join for early-access updates.
      </p>
    </div>
  );
}

function HeroArtwork() {
  return (
    <div
      className="lp-art"
      aria-label="Illustration of Proof matching a draft citation to its source"
    >
      <img
        className="lp-art-scene"
        src="/images/hero-citations-transparent-v2.png"
        alt=""
        width="1024"
        height="1024"
      />
    </div>
  );
}

const compareQuestion =
  "What are the effects of social media on teenage sleep?";

function AnswerCompare() {
  return (
    <div
      className="lp-compare-grid"
      aria-label="Example comparison of a typical LLM answer and a Proof answer"
    >
      <article className="lp-compare-card lp-compare-llm">
        <header className="lp-compare-card-head">
          <span className="lp-compare-avatar" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <h3>Typical LLM</h3>
        </header>
        <div className="lp-compare-question">
          <FileText size={22} aria-hidden="true" />
          <p>{compareQuestion}</p>
        </div>
        <p className="lp-compare-answer">
          Social media significantly reduces sleep quality in teenagers, leading
          to shorter sleep duration, increased sleep disturbances, and greater
          daytime fatigue.
        </p>
        <div className="lp-compare-citations">
          <ul>
            {["Smith et al. (2021)", "Johnson & Lee (2022)"].map((citation) => (
              <li key={citation}>
                <FileText size={21} aria-hidden="true" />
                {citation}
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-compare-problems">
          <span className="lp-compare-verdict-icon" aria-hidden="true">
            <X size={38} strokeWidth={3} />
          </span>
          <div>
            <h4>What’s wrong</h4>
            <ul>
              <li>
                <X size={17} aria-hidden="true" />
                Made-up citations
              </li>
              <li>
                <X size={17} aria-hidden="true" />
                No source checking
              </li>
              <li>
                <X size={17} aria-hidden="true" />
                Can be misleading
              </li>
            </ul>
          </div>
        </div>
      </article>
      <article className="lp-compare-card lp-compare-proof">
        <header className="lp-compare-card-head">
          <span className="lp-compare-avatar" aria-hidden="true">
            <MotifIcon name="book" size={18} />
          </span>
          <h3>
            proof<span>.</span>
          </h3>
        </header>
        <div className="lp-compare-question">
          <FileText size={22} aria-hidden="true" />
          <p>{compareQuestion}</p>
        </div>
        <p className="lp-compare-answer">
          Higher social media use is associated with shorter sleep duration and
          poorer sleep quality in teenagers, particularly due to increased
          nighttime use and later bedtimes.
        </p>
        <div className="lp-compare-citations">
          <ul>
            {["Twenge et al. (2019)", "Kelly et al. (2022)"].map((citation) => (
              <li key={citation}>
                <FileText size={21} aria-hidden="true" />
                {citation}
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-compare-strengths">
          <span className="lp-compare-verdict-icon" aria-hidden="true">
            <Check size={38} strokeWidth={3} />
          </span>
          <div>
            <h4>What Proof does right</h4>
            <ul>
              <li>
                <Check size={17} aria-hidden="true" />
                Verified sources
              </li>
              <li>
                <Check size={17} aria-hidden="true" />
                Checks claims
              </li>
              <li>
                <Check size={17} aria-hidden="true" />
                Shows the evidence
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  );
}

function UsedForRow() {
  return (
    <ul className="lp-used-row" aria-label="Document types Proof can check">
      {documentTypes.map((item) => (
        <li key={item.kind}>
          <UseForIcon kind={item.kind} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ProcessDrawing({ step }: { step: number }) {
  return (
    <svg
      className="lp-process-drawing"
      viewBox="0 0 180 140"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {step === 0 && (
        <>
          <path className="lp-process-paper" d="m51 23 66-2 20 20-2 87-84 2Z" />
          <path d="m117 21-1 22 21-2M51 31l-10 2 1 103 84-2M65 59l49-1M65 70l46 1M65 82l51-1M65 105l30-1" />
          <path className="lp-process-highlight" d="m62 89 57-1-1 9-55 1Z" />
          <path d="M67 94l47-1M90 41l-1-27m-9 9 9-10 10 9" />
        </>
      )}
      {step === 1 && (
        <>
          <path className="lp-process-paper" d="m28 26 42 1-1 60-41-2Z" />
          <path className="lp-process-paper" d="m84 17 43-1 1 60-44 1Z" />
          <path className="lp-process-paper" d="m111 89 43-1-1 40-42 1Z" />
          <path d="m37 39 23 1M37 48l22 1M37 58l16 1M94 29l23-1M94 39h23M94 49l16-1M121 101l22-1M121 111l17-1" />
          <path d="M70 57c11 0 7-14 14-14M107 77c-1 11 15 5 17 11M44 88c0 21 24 27 43 17" />
          <circle className="lp-process-highlight" cx="69" cy="101" r="21" />
          <path d="m60 102 7 7 12-15M151 49l7-3M149 37l5-6" />
        </>
      )}
      {step === 2 && (
        <>
          <path
            className="lp-process-paper"
            d="m18 31 60-2 1 88-60 2ZM102 26l59 2-2 89-59-2Z"
          />
          <path d="m29 46 35-1M29 58h34M29 82l34-1M29 96h25M113 43l34 1M113 55l34 1M113 80l32 1M113 96l25 1" />
          <path
            className="lp-process-highlight"
            d="m25 65 45-1v10l-44 1ZM109 62l43 1-1 10-42-1Z"
          />
          <path d="M31 70h31M116 68h28M72 70c15 0 14-3 36-2m-7-6 7 6-8 6" />
          <path d="M79 19c9-5 17-5 24-2M83 129c10 3 19 3 29-1" />
        </>
      )}
      {step === 3 && (
        <>
          <path className="lp-process-paper" d="m43 18 86 2-2 110-82-1Z" />
          <path d="m57 33 45 1M78 56l36-1M78 78l34 1M78 104l28-1" />
          <path className="lp-process-highlight" d="m75 96 42 1v13l-43-1Z" />
          <path d="m55 54 5 5 9-12M55 78l5 5 9-12M55 102l5 5 9-12M80 103l28 1" />
          <path d="m139 39 12 7-36 58-16 11 4-19 36-57Zm-36 57 12 8M135 46l11 7M99 115l7-4M29 27l-9-3M30 40l-12 1" />
        </>
      )}
    </svg>
  );
}

function CitationProcess({ href }: { href: string }) {
  const steps = [
    {
      title: "Upload your paper",
      detail: "Paste your writing or add a PDF, Word document, or text file.",
    },
    {
      title: "Find the sources",
      detail: "Proof finds the academic sources behind your citations.",
    },
    {
      title: "Check each claim",
      detail: "Compare your words with the evidence in the original passages.",
    },
    {
      title: "Review the findings",
      detail: "See what holds up, what needs a change, and why.",
    },
  ];
  return (
    <div className="lp-process">
      <ol
        className="lp-process-steps"
        aria-label="How Proof checks your citations"
      >
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="lp-process-number" aria-hidden="true">
              0{index + 1}
            </span>
            <ProcessDrawing step={index} />
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
            {index < steps.length - 1 && (
              <svg
                className="lp-process-arrow"
                viewBox="0 0 80 40"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 25C21 8 44 9 73 19m-11-9 12 9-14 7" />
              </svg>
            )}
          </li>
        ))}
      </ol>
      <div className="lp-process-finish">
        <svg
          className="lp-process-return"
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M875 3c4 57-43 55-112 54L550 55c-43 0-51 6-50 37m-8-11 8 12 8-12" />
        </svg>
        <a className="lp-process-cta" href={href}>
          <InkFrame />
          <Check size={22} aria-hidden="true" />
          Fix all citations
          <ArrowRight size={21} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

const faqs = [
  {
    question: "What does Proof actually check?",
    answer:
      "Proof compares claims in your document with the passages in their cited sources. It flags mismatched numbers, exaggerated wording, contradictions, and claims the source does not address. Strict mode also looks for factual claims without citations.",
  },
  {
    question: "Is this another AI writing tool?",
    answer:
      "Proof focuses on the evidence behind your writing. It brings relevant source passages alongside your claims and can suggest source wording when appropriate. You review each finding and decide what to change.",
  },
  {
    question: "What can I upload?",
    answer:
      "The current workspace accepts PDF, Word .docx, and plain text documents. You can also paste your writing, add a source by DOI, or provide the source text yourself.",
  },
  {
    question: "What if a source is behind a paywall?",
    answer:
      "Proof tells you what it could access. If it can only read an abstract, that limit appears in the findings. If it cannot access enough evidence, it marks the claim as unverified. You can upload a source you have access to.",
  },
  {
    question: "Can I trust every finding?",
    answer:
      "Treat Proof as a second reader. Automated checks can make mistakes, so each finding gives you the evidence to review. Proof does not guarantee factual accuracy, and you choose whether to make a change.",
  },
  {
    question: "When can I try it?",
    answer:
      "Join the waitlist and we will email you when early access opens. We have not announced a launch date or pricing yet.",
  },
];

export default function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const privacy = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    document.title = "Proof · Check your paper's citations";
  }, []);
  useEffect(() => {
    const elements = document.querySelectorAll(".lp-reveal");
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    elements.forEach((element) => {
      element.classList.add("lp-will-reveal");
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (privacyOpen) privacy.current?.showModal();
    else privacy.current?.close();
  }, [privacyOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="landing">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-container lp-nav">
          <Wordmark />
          <nav className="lp-desktop-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className="lp-nav-actions">
            <a className="lp-nav-ghost" href="/app">
              Log in
            </a>
            <a className="lp-nav-cta" href="/app">
              Get started
            </a>
            <button
              className="lp-menu-toggle"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
            >
              {mobileOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <nav
            id="mobile-navigation"
            className="lp-mobile-nav"
            aria-label="Mobile navigation"
          >
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>
              How it works
            </a>
            <a href="#questions" onClick={() => setMobileOpen(false)}>
              Questions
            </a>
            <a href="/app" onClick={() => setMobileOpen(false)}>
              Log in
            </a>
            <a href="/app" onClick={() => setMobileOpen(false)}>
              Get started
            </a>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <HeroArtwork />
            <div className="lp-hero-copy">
              <h1>
                <span className="lp-hero-kicker">Trust your</span>
                <span className="lp-hero-highlight">citations</span>
              </h1>
              <p className="lp-hero-description">
                Proof checks your cited sources, verifies claims, and helps you
                build stronger, more credible academic writing.
              </p>
              <a className="lp-hero-cta" href="/app">
                Get started – it's free
                <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </section>
        <SchoolLogoRow />
        <section
          className="lp-used-for lp-container"
          aria-labelledby="used-for"
        >
          <h2 id="used-for" className="lp-used-heading">
            <span className="lp-used-title">Used for</span>
          </h2>
          <UsedForRow />
        </section>
        <section
          className="lp-compare lp-container"
          aria-labelledby="compare-heading"
        >
          <header className="lp-compare-intro">
            <h2 id="compare-heading">Same question. Different answers.</h2>
          </header>
          <AnswerCompare />
        </section>
        <section className="lp-how-section lp-container" id="how-it-works">
          <div className="lp-ink-panel lp-how-panel">
            <div className="lp-how-intro">
              <h2>
                Check the claim.
                <span> Read the evidence.</span>
              </h2>
            </div>
            <CitationProcess href="/app" />
          </div>
        </section>
        <section className="lp-faq-section lp-container" id="questions">
          <div className="lp-faq-intro">
            <h2>
              Questions about <em>Proof.</em>
            </h2>
          </div>
          <div className="lp-faq-list">
            {faqs.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <Plus size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-final-section lp-container" id="waitlist">
          <div className="lp-ink-panel lp-final-content">
            <h2>
              Check your citations
              <span> before you submit.</span>
            </h2>
            <p>Join the waitlist. We will email you when Proof is ready.</p>
            <WaitlistForm placement="footer" />
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div>
          <Wordmark />
          <span>Check your claims against their sources.</span>
        </div>
        <div>
          <span>© {new Date().getFullYear()} Proof</span>
          <button onClick={() => setPrivacyOpen(true)}>Waitlist privacy</button>
          <a href="#main" className="lp-back-top">
            Back to top
            <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
      <dialog
        ref={privacy}
        className="lp-privacy"
        onCancel={() => setPrivacyOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPrivacyOpen(false);
        }}
        aria-labelledby="privacy-title"
      >
        <div>
          <ShieldCheck size={22} />
          <button
            onClick={() => setPrivacyOpen(false)}
            aria-label="Close privacy information"
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="privacy-title">About the waitlist.</h2>
        <p>
          Joining the waitlist gives Proof permission to email you about early
          access. We save your email address, signup time, and this permission.
        </p>
        <p>
          The interactive example uses a fictional study. Trying it does not
          upload a document or send its content anywhere.
        </p>
        <button
          className="lp-privacy-close"
          onClick={() => setPrivacyOpen(false)}
        >
          Got it
          <Check size={16} />
        </button>
      </dialog>
    </div>
  );
}
