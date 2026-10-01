import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  CircleCheck,
  PencilLine,
  Undo2,
} from "lucide-react";

function ProofMark() {
  return (
    <>
      <svg
        className="lp-intro-loop"
        viewBox="0 0 300 110"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          pathLength={1}
          d="M46 20C104 3 226 2 273 21c33 13 29 51-9 69-52 24-177 22-227 4C-5 78 3 39 45 19c31-13 89-16 141-14"
        />
      </svg>
      <svg
        className="lp-intro-tick"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path pathLength={1} d="M5 22c4 3 7 7 10 11C20 21 26 12 36 4" />
      </svg>
    </>
  );
}

function ClaimScene() {
  const [applied, setApplied] = useState(false);
  return (
    <figure
      className="lp-intro-art"
      data-applied={applied || undefined}
      aria-label="Illustrative example: a draft claim compared with its source"
    >
      <div className="lp-intro-stage">
        <div className="lp-sheet lp-sheet-draft">
          <span className="lp-sheet-label">Your draft</span>
          <p className="lp-sheet-title">Hybrid work and collaboration.</p>
          <p>The study compared how six teams completed the same tasks.</p>
          <p className="lp-sheet-claim">
            Teams completed their work{" "}
            <span className="lp-claim">
              {applied ? (
                <>
                  <del>twice as fast</del> <ins>18% faster, on average</ins>
                </>
              ) : (
                "twice as fast"
              )}
            </span>
            .<sup>[1]</sup>
          </p>
          <span className="lp-sheet-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <small>1. Rivera et al., 2025</small>
        </div>

        <div className="lp-sheet lp-sheet-source">
          <div className="lp-sheet-meta">
            <BookOpen size={16} strokeWidth={1.7} aria-hidden="true" />
            Original source
            <span>2025</span>
          </div>
          <blockquote>
            “Tasks were completed <mark>18% faster, on average.</mark>”
          </blockquote>
          <small>Rivera et al. · Illustrative study</small>
        </div>

        <svg
          className="lp-intro-thread"
          viewBox="0 0 600 560"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            className="lp-intro-thread-line"
            d="M474 168c62 26 74 110 22 146-30 20-68 34-110 36"
          />
          <path d="m398 341-13 9 14 8" />
        </svg>

        <div className="lp-sheet lp-sheet-finding">
          <div className="lp-finding-head">
            {applied ? (
              <CircleCheck size={17} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <CircleAlert size={17} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span>{applied ? "Matches the source" : "Overstated claim"}</span>
            <button type="button" onClick={() => setApplied(!applied)}>
              {applied ? (
                <>
                  <Undo2 size={15} aria-hidden="true" /> Undo
                </>
              ) : (
                <>
                  <PencilLine size={15} aria-hidden="true" /> Apply edit
                </>
              )}
            </button>
          </div>
          <div aria-live="polite">
            <p className="lp-finding-title">
              {applied
                ? "18% faster, on average."
                : "18% faster ≠ twice as fast."}
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function LandingHero({ appHref }: { appHref: string }) {
  return (
    <section className="lp-intro" aria-labelledby="hero-title">
      <div className="lp-intro-grid">
        <div className="lp-intro-copy">
          <h1 id="hero-title" className="lp-intro-title">
            Trust your
            <br />
            <span className="lp-intro-proofed">
              citations
              <ProofMark />
            </span>
          </h1>
          <p className="lp-intro-description">
            Check whether your cited sources support what you've written.
          </p>
          <div className="lp-intro-actions">
            <a className="lp-intro-cta" href={appHref}>
              Get started
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="lp-intro-secondary" href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>
        <ClaimScene />
      </div>
    </section>
  );
}
