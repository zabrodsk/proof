import type { CSSProperties } from "react";
import "./drawn.css";

type Motif = "document" | "book" | "library" | "pen" | "upload";

// Original, fixed pen strokes. No generated paths or movement on interaction.
export function DrawnIcon({ name, size = 24 }: { name: Motif; size?: number }) {
  return (
    <svg
      className="drawn-icon"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "document" && (
        <>
          <path className="drawn-fill" d="M8 5 22 4l5 6-.5 17-18 1Z" />
          <path d="m8 5 13-.5 6 6-.6 17-18.7.5L8 5ZM21 5l.2 6 5.3-.5M8 9l-4 .8.8 20 17-.3" />
          <path d="m12 15 10-.3M12 19l10 .1M12 23l6-.2" />
        </>
      )}
      {name === "book" && (
        <>
          <path
            className="drawn-fill"
            d="M16 7c4-2 8-2 12-1l-.5 19c-4-1-7-.5-11.5 1Z"
          />
          <path d="M16 8C12 5 8 5 3.5 5.8L4 25c4-1 8-.5 12 2 4-2.5 8-3 12-2l.4-19c-5-1-8-.5-12.4 2ZM16 8l.2 19M7.5 11c2-.2 4 0 5.5 1M7.5 15c2 0 3.5 0 5.5 1M20 12l5-1M20 16l5-.5M7.5 20l5 .8M20 21l5-1" />
        </>
      )}
      {name === "library" && (
        <>
          <path className="drawn-fill" d="m12 5 6 .3-.3 22-5.7.2Z" />
          <path d="m4.5 7 5-.3.2 21-5 .2-.2-21ZM12.5 5l5.2.3-.2 22.5-5 .2V5Zm8 3 4.5-1 4.2 19-4.4 1.3-4.3-19.3ZM5 12h4M13 10l4 .2M13 23h4M22 12l4-.8M3 30l26-.4" />
        </>
      )}
      {name === "pen" && (
        <>
          <path className="drawn-fill" d="m9 19 12-14 5 5-13 13-6 2Z" />
          <path d="m9 19 12-14c1-1 2-1 3 0l2 2c1 1 1 2 0 3L13 23l-6 2 2-6ZM9 19l4 4M19 7l5 5M7 28c6-.5 12 .5 19-.5" />
        </>
      )}
      {name === "upload" && (
        <>
          <path
            className="drawn-fill"
            d="m5 18 7 .3L14 22h5l2-4 6-.2.2 10-22-.2Z"
          />
          <path d="M16 19 15.8 3M10.5 9l5.3-6 5.7 6M7 14l-2 4v10l22 .2-.3-10.4L25 14M5 18l7 .3 2 3.7 5-.2 2-3.8h5.5" />
        </>
      )}
    </svg>
  );
}

export function DocumentIllustration({
  kind = "paper",
  className = "",
}: {
  kind?: "paper" | "notebook" | "thesis" | "report";
  className?: string;
}) {
  const position = { paper: 0, notebook: 1, thesis: 2, report: 3 }[kind];
  return (
    <span
      className={`document-illustration ${className}`}
      style={
        {
          "--illustration-position": `${(position / 3) * 100}%`,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}

export function InkUnderline() {
  return (
    <svg
      className="ink-underline"
      viewBox="0 0 200 9"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 5C50 2 113 2 198 4M21 8c64-3 122-2 160-2" />
    </svg>
  );
}

export function InkFrame() {
  return (
    <svg
      className="ink-frame"
      viewBox="0 0 320 200"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 3C92 1 218 4 311 2Q318 2 317 9L318 189Q318 197 310 197C208 196 115 199 8 197Q2 197 3 190L2 11Q2 3 8 3Z" />
      <path d="M10 199c43-1 74 0 97-1M319 126l-1 60" />
    </svg>
  );
}
