import type { CSSProperties } from "react";
import {
  BookOpen,
  FileText,
  Library,
  PencilLine,
  Upload,
  type LucideIcon,
} from "lucide-react";
import "./drawn.css";

type Motif = "document" | "book" | "library" | "pen" | "upload";
const motifIcons: Record<Motif, LucideIcon> = {
  document: FileText,
  book: BookOpen,
  library: Library,
  pen: PencilLine,
  upload: Upload,
};

export function MotifIcon({ name, size = 24 }: { name: Motif; size?: number }) {
  const Icon = motifIcons[name];
  return (
    <Icon
      className="lucide-icon"
      size={size}
      strokeWidth={1.65}
      aria-hidden="true"
      focusable="false"
    />
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
