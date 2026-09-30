import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  FileText,
  Highlighter,
  LoaderCircle,
  Menu,
  Plus,
  Quote,
  ShieldCheck,
  X,
} from "lucide-react";
import "./landing.css";
import { DocumentIllustration, DrawnIcon, InkFrame } from "./Drawn";

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
      aria-label="Illustration of Proof finding an exaggerated claim in a fictional paper"
    >
      <div className="lp-source-slip">
        <InkFrame />
        <div>
          <span className="lp-mini-icon">
            <DrawnIcon name="book" size={19} />
          </span>
          Original source<span className="lp-source-year">2025</span>
        </div>
        <p>
          “Tasks were completed
          <br />
          <mark>18% faster, on average.</mark>”
        </p>
        <small>Rivera et al. · Illustrative study</small>
      </div>
      <div className="lp-art-paper">
        <InkFrame />
        <div className="lp-art-paper-top">
          <span>Your draft</span>
          <DrawnIcon name="document" size={19} />
        </div>
        <h2>
          Hybrid work
          <br />
          and collaboration.
        </h2>
        <div className="lp-paper-rule" />
        <p>The study compared how six teams completed the same tasks.</p>
        <p className="lp-paper-claim">
          Teams completed their work{" "}
          <mark>
            twice
            <br />
            as fast.
          </mark>
          <sup> [1]</sup>
        </p>
        <div className="lp-paper-lines">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="lp-art-paper-bottom">
          <span>1. Rivera et al., 2025</span>
          <span>01</span>
        </div>
      </div>
      <svg
        className="lp-annotation-path"
        viewBox="0 0 540 570"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M410 125C509 148 509 263 393 279"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="4 5"
        />
        <path
          d="m402 270-10 9 12 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <div className="lp-proof-note">
        <InkFrame />
        <div className="lp-proof-note-top">
          <span>
            <CircleAlert size={15} />
            Overstated claim
          </span>
          <DrawnIcon name="pen" size={22} />
        </div>
        <p>18% faster ≠ twice as fast.</p>
        <span>Use the figure from the source.</span>
      </div>
      <span className="lp-handwritten">
        Compare the claim
        <br />
        with its source.
      </span>
      <svg
        className="lp-hand-arrow"
        viewBox="0 0 90 50"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 5C13 40 53 50 84 18M68 19l18-4-4 18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

const documentTypes = [
  "Research papers",
  "Essays",
  "Theses",
  "Reports & articles",
];

function DocumentMarquee() {
  return (
    <div className="lp-document-strip">
      <div className="lp-container lp-document-strip-inner">
        <span className="lp-document-strip-label">For your</span>
        <div
          className="lp-marquee-window"
          tabIndex={0}
          role="region"
          aria-label="Document types. Focus or hover to pause scrolling."
        >
          <div className="lp-marquee-track">
            {[0, 1, 2].map((copy) => (
              <ul
                className="lp-marquee-group"
                key={copy}
                aria-hidden={copy > 0 ? true : undefined}
              >
                {documentTypes.map((label, index) => (
                  <li key={label}>
                    <span
                      className={`lp-document-illustration lp-document-illustration-${index}`}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const examples = [
  {
    label: "The number is off",
    short: "Numbers",
    status: "Numeric mismatch",
    tone: "amber",
    claim: (
      <>
        The study included <mark>240 participants</mark> from six teams.
      </>
    ),
    source: (
      <>
        “A total of <mark>120 participants</mark> across six teams completed the
        study.”
      </>
    ),
    explanation: "The source reports 120 participants. Your draft says 240.",
    correction: "The study included 120 participants from six teams.",
  },
  {
    label: "The claim holds up",
    short: "Supported",
    status: "Supported",
    tone: "green",
    claim: (
      <>
        Participants completed the task <mark>18% faster, on average.</mark>
      </>
    ),
    source: (
      <>
        “Task completion was <mark>18% faster</mark> relative to the control
        group.”
      </>
    ),
    explanation:
      "The direction and size of the result match the source. This claim is supported by the passage.",
    correction: null,
  },
  {
    label: "The wording goes too far",
    short: "Overstated",
    status: "Overstated",
    tone: "rose",
    claim: (
      <>
        The study proves that <mark>every team is more productive</mark> with a
        hybrid schedule.
      </>
    ),
    source: (
      <>
        “Findings suggest improved task completion{" "}
        <mark>among the teams studied.</mark> Broader effects remain unclear.”
      </>
    ),
    explanation:
      "Six teams cannot speak for every team. The source also describes a possible effect, not a proven rule.",
    correction:
      "The study suggests a hybrid schedule may improve task completion among the teams studied.",
  },
];

function EvidenceDemo() {
  const [active, setActive] = useState(0);
  const [applied, setApplied] = useState(false);
  const item = examples[active];
  const choose = (index: number) => {
    setActive(index);
    setApplied(false);
  };
  return (
    <div className="lp-demo" id="demo">
      <div className="lp-demo-topbar">
        <div>
          <span className="lp-demo-file">
            <DrawnIcon name="document" size={23} />
          </span>
          <span>
            Hybrid work and collaboration
            <span className="lp-example-tag">Fictional example</span>
          </span>
        </div>
      </div>
      <div className="lp-demo-body">
        <div className="lp-demo-document">
          <div className="lp-demo-doc-meta">
            <span>Research note</span>
            <span>1 of 1</span>
          </div>
          <h3>
            Hybrid work and
            <br />
            team performance.
          </h3>
          <p>
            This study compared task completion across six teams working
            different schedules.
          </p>
          <div
            className={`lp-demo-claim lp-tone-${applied ? "green" : item.tone}`}
            aria-live="polite"
          >
            <p>
              {applied ? item.correction : item.claim}
              <sup> [1]</sup>
            </p>
            <span>
              {applied ? <Check size={15} /> : <Highlighter size={15} />}
            </span>
          </div>
          <p>
            Results varied between teams. The study measured task completion
            time, rather than overall productivity.
          </p>
          <div className="lp-demo-reference">
            <span>References</span>
            <p>
              [1] Rivera, A., et al. “Hybrid work and team collaboration.” 2025.
            </p>
          </div>
        </div>
        <div className="lp-demo-findings">
          <div className="lp-demo-findings-heading">
            <CheckCheck size={21} />
            <h3>A closer look</h3>
            <span>3 claims</span>
          </div>
          <div
            className="lp-demo-tabs"
            role="tablist"
            aria-label="Example claims"
          >
            {examples.map((example, index) => (
              <button
                key={example.short}
                id={`claim-tab-${index}`}
                role="tab"
                aria-selected={active === index}
                aria-controls="claim-panel"
                tabIndex={active === index ? 0 : -1}
                onClick={() => choose(index)}
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 2
                          : (active +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              examples.length) %
                            examples.length;
                    choose(next);
                    document.getElementById(`claim-tab-${next}`)?.focus();
                  }
                }}
              >
                {example.short}
              </button>
            ))}
          </div>
          <div
            id="claim-panel"
            role="tabpanel"
            aria-labelledby={`claim-tab-${active}`}
            tabIndex={0}
            className="lp-demo-result"
            aria-live="polite"
          >
            <span className={`lp-result-status lp-tone-${item.tone}`}>
              {item.tone === "green" ? (
                <CircleCheck size={15} />
              ) : (
                <CircleAlert size={15} />
              )}{" "}
              {item.status}
            </span>
            <h4>{item.label}.</h4>
            <p>{item.explanation}</p>
            <div className="lp-evidence-excerpt">
              <span>
                <DrawnIcon name="book" size={21} />
                What the source says
              </span>
              <blockquote>{item.source}</blockquote>
              <small>Rivera et al., 2025 · Source passage</small>
            </div>
            {item.correction ? (
              <button
                className={`lp-apply-button${applied ? " lp-applied" : ""}`}
                onClick={() => setApplied(!applied)}
              >
                {applied ? (
                  <>
                    <Check size={15} />
                    Wording applied<span>Undo</span>
                  </>
                ) : (
                  <>
                    Try the source wording
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            ) : (
              <div className="lp-supported-note">
                <ShieldCheck size={16} />
                The evidence backs your words.
              </div>
            )}
          </div>
        </div>
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
            <a href="#in-the-details">Why Proof</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className="lp-nav-actions">
            <a className="lp-text-link" href="/app">
              Sign in
            </a>
            <a className="lp-nav-cta" href="#waitlist">
              Get early access
              <ArrowUpRight size={15} />
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
            <a href="#in-the-details" onClick={() => setMobileOpen(false)}>
              Why Proof
            </a>
            <a href="#questions" onClick={() => setMobileOpen(false)}>
              Questions
            </a>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <h1>
                Check your
                <br />
                <span>
                  paper's citations.
                  <svg
                    viewBox="0 0 530 30"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 18Q230 -1 522 11M65 26Q277 10 465 22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>
              <p className="lp-hero-description">
                Upload your paper. See whether your cited sources support what
                you've written.
              </p>
              <WaitlistForm placement="hero" />
              <a href="#how-it-works" className="lp-see-how">
                See how it works
                <ArrowDown size={15} />
              </a>
            </div>
            <HeroArtwork />
          </div>
          <DocumentMarquee />
        </section>
        <section className="lp-statement lp-container lp-reveal">
          <div className="lp-statement-symbol" aria-hidden="true">
            <Quote />
          </div>
          <p>
            A citation needs to support
            <br />
            <span>the claim</span> <em>you're making.</em>
          </p>
          <div className="lp-statement-bottom">
            <p>
              Proof checks the evidence behind your sentences.
              <br />
              See what each source actually says before you submit your paper.
            </p>
          </div>
        </section>
        <section className="lp-how-section" id="how-it-works">
          <div className="lp-container">
            <div className="lp-section-heading lp-reveal">
              <div>
                <h2>
                  Check the claim.
                  <br />
                  <em>Read the evidence.</em>
                </h2>
              </div>
              <p>
                Compare a claim with its source.
                <br />
                See the issue and review a change.
                <br />
                <span className="lp-demo-invitation">
                  Select a claim below.
                  <ArrowDown size={14} />
                </span>
              </p>
            </div>
            <div className="lp-reveal">
              <EvidenceDemo />
            </div>
            <div className="lp-steps lp-reveal">
              <div>
                <DrawnIcon name="upload" size={34} />
                <div>
                  <h3>Upload your paper.</h3>
                  <p>
                    Paste your writing or upload a PDF, Word document, or text
                    file.
                  </p>
                </div>
              </div>
              <div>
                <DrawnIcon name="book" size={34} />
                <div>
                  <h3>Check each cited claim.</h3>
                  <p>
                    Proof finds cited sources and compares your claims with
                    their passages.
                  </p>
                </div>
              </div>
              <div>
                <DrawnIcon name="pen" size={34} />
                <div>
                  <h3>Review the findings.</h3>
                  <p>Read the source passage and decide what to change.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section id="in-the-details" className="lp-details-section">
          <div className="lp-container lp-details-grid">
            <div className="lp-details-copy lp-reveal">
              <h2>
                Every finding.
                <br />
                <em>With its source.</em>
              </h2>
              <p>Read the original passage before you change your draft.</p>
              <a href="#waitlist" className="lp-text-link">
                Get early access <ArrowUpRight size={18} />
              </a>
            </div>
            <div className="lp-evidence-details lp-reveal">
              <article
                className="lp-source-review"
                aria-label="Example source and suggested edit"
              >
                <InkFrame />
                <header className="lp-source-review-header">
                  <DocumentIllustration kind="paper" />
                  <div>
                    <h3>Hybrid work and team collaboration</h3>
                    <p>Rivera et al., 2025 · Fictional example</p>
                  </div>
                </header>
                <div className="lp-source-review-passage">
                  <div className="lp-source-review-label">
                    <h4>Source passage</h4>
                    <span>
                      <Check size={14} aria-hidden="true" />
                      Full text
                    </span>
                  </div>
                  <blockquote>
                    "A total of <mark>120 participants</mark> across six teams
                    completed the study."
                  </blockquote>
                </div>
                <div className="lp-source-review-edit">
                  <h4>Suggested edit</h4>
                  <p>
                    The study included <del aria-label="replace 240">240</del>{" "}
                    <ins aria-label="with 120">120</ins> participants from six
                    teams.
                  </p>
                </div>
                <footer className="lp-source-review-footer">
                  <div>
                    <h4>Source access</h4>
                    <p>Full text, abstract, or unavailable.</p>
                  </div>
                  <div>
                    <h4>You approve edits</h4>
                    <p>Apply a suggestion or keep your wording.</p>
                  </div>
                </footer>
              </article>
            </div>
          </div>
        </section>
        <section
          className="lp-faq-section lp-container lp-reveal"
          id="questions"
        >
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
        <section className="lp-final-section" id="waitlist">
          <div className="lp-container lp-final-content">
            <h2>
              Check your citations
              <br />
              <em>before you submit.</em>
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
