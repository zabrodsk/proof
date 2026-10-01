import { useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Plus,
  X,
} from "lucide-react";
import "@fontsource/newsreader/700.css";
import "./landing.css";
import "./landing-hero.css";
import "./landing-motion.css";
import { useLandingMotion } from "./landing-motion";
import LandingConnections from "./LandingConnections";
import LandingHeader, { Wordmark } from "./LandingHeader";
import LandingHero from "./LandingHero";
import { InkFrame } from "./Drawn";

const appHref =
  import.meta.env.VITE_PROOF_APP_URL || "https://app-proof.up.railway.app/app";

const documentTypes = [
  { kind: "papers", label: "Research papers" },
  { kind: "essays", label: "Essays" },
  { kind: "theses", label: "Theses" },
  { kind: "reports", label: "Reports & articles" },
  { kind: "other", label: "Other projects" },
] as const;

type UseKind = (typeof documentTypes)[number]["kind"];
function UseForIcon({ kind }: { kind: UseKind }) {
  return (
    <span className={`lp-use-icon lp-use-icon-${kind}`} aria-hidden="true" />
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
          <span
            className="lp-compare-brands"
            role="img"
            aria-label="OpenAI, Anthropic, and Google"
          >
            {["openai", "anthropic", "google"].map((brand) => (
              <span className="lp-compare-brand" key={brand}>
                <img
                  src={`/images/ai/${brand}.svg`}
                  alt=""
                  width="24"
                  height="24"
                />
              </span>
            ))}
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
            {["Missing source", "Reference needs evidence"].map((citation) => (
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
            <img
              src="/images/proof-logo-drawn-v1.png"
              alt=""
              width="40"
              height="40"
            />
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
            {["Original source passage", "Evidence access details"].map(
              (citation) => (
                <li key={citation}>
                  <FileText size={21} aria-hidden="true" />
                  {citation}
                </li>
              ),
            )}
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
                Shows available sources
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

const processImages = [
  "upload",
  "find-sources",
  "check-claims",
  "review-findings",
];
function ProcessDrawing({ step }: { step: number }) {
  return (
    <img
      className="lp-process-drawing lp-process-image"
      src={`/images/process/${processImages[step]}-v1.png`}
      alt=""
      width="180"
      height="140"
      loading="lazy"
      decoding="async"
    />
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
          Check your citations
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
      "Proof tells you what it could access. If it can only read an abstract, that limit appears in the findings. If it cannot access enough evidence, it marks the claim as needing evidence. You can upload a source you have access to.",
  },
  {
    question: "Can I trust every finding?",
    answer:
      "Treat Proof as a second reader. Automated checks can make mistakes, so each finding gives you the evidence to review. Proof does not guarantee factual accuracy, and you choose whether to make a change.",
  },
  {
    question: "When can I try it?",
    answer:
      "Proof is invite only. Sign in or create an account, then enter your four-digit invite code to open the workspace.",
  },
];

export default function Landing() {
  const motionRoot = useLandingMotion();
  useEffect(() => {
    document.title = "Proof · Check your paper's citations";
  }, []);
  return (
    <div className="landing" ref={motionRoot}>
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <LandingHeader appHref={appHref} />
      <main id="main">
        <LandingHero appHref={appHref} />
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
            <p>Illustrative example</p>
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
            <CitationProcess href={appHref} />
          </div>
        </section>
        <section id="connect" className="lp-mcp-section lp-container">
          <LandingConnections
            settingsHref={`${appHref.replace(/\/$/, "")}/integrations#connect`}
          />
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
        <section className="lp-final-section lp-container" id="invite">
          <div className="lp-ink-panel lp-final-content">
            <h2>Invite Only</h2>
            <p>
              Sign in, then enter your four-digit invite code to open Proof.
            </p>
            <a className="lp-invite-cta" href={appHref}>
              Log in to Proof <ArrowUpRight size={18} aria-hidden="true" />
            </a>
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
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
          <a href="#main" className="lp-back-top">
            Back to top
            <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
