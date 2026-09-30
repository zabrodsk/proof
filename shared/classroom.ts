import type { Finding, Source } from "./types";
import type { MlaSource } from "./mla";
import { formatMla } from "./mla";

export const classReferences = {
  assignment:
    "https://docs.google.com/document/d/1Vfe0zLMhFVVwSM7_AOoramuV4IbiFIn8Lr1Zh7mDp_k/edit",
  slides:
    "https://docs.google.com/presentation/d/1x2zkWkjGihCuyUmKibQGiAMwMrxN_C0Bf2a7hkLWM1o/edit",
  inText:
    "https://docs.google.com/document/d/1hqp9xx4dYbNIOnJrnWTIQ1V-qjiJSlkeCPyZ10Zo-1U/edit",
};
export type Check = {
  label: string;
  status: "pass" | "issue" | "manual";
  detail: string;
};
export type PaperPage = { index: number; label?: string; text: string };
export type ClassPaper = {
  id: string;
  metadata: Source;
  mla: MlaSource;
  url: string;
  accessed: string;
  pages: PaperPage[];
  filename?: string;
  firstPage?: number;
  checks: Check[];
};
export type SentenceReview = {
  id: string;
  text: string;
  start: number;
  end: number;
  language: string;
  reasoning: string;
  role: string;
  completed: boolean;
  citations: {
    citation: string;
    sourceId?: string;
    locator?: string;
    pageCheck: Check;
    finding?: Finding;
    contextFinding?: Finding;
  }[];
};
export type ClassReport = {
  reviewId?: string;
  usage?: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    unmeteredRequests: number;
    estimatedUsd: number;
    pricePerMillion: number;
  };
  text: string;
  assignment: "draft" | "bibliography";
  createdAt: string;
  checks: Check[];
  sentences: SentenceReview[];
  papers: ClassPaper[];
  words: number;
  citationCount: number;
  coverage: { total: number; completed: number; evidenceChecked: number };
};
export function classMla(paper: Pick<ClassPaper, "mla" | "url" | "accessed">) {
  let entry = formatMla(paper.mla).entry;
  const authors = paper.mla.authors
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // The class slides explicitly invert both names and use Vol.; keep this
  // local convention separate from the general MLA tool.
  if (authors.length === 2) {
    const titleAt = entry.indexOf('"');
    entry = `${authors[0]} and ${authors[1]}. ${entry.slice(titleAt)}`;
  }
  entry = entry.replace(/, vol\. /, ", Vol. ");
  if (!paper.mla.doi && /^https:\/\//.test(paper.url))
    entry = entry.replace(/\.$/, "") + `, ${paper.url}.`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(paper.accessed)) {
    const [y, m, d] = paper.accessed.split("-").map(Number);
    const months = [
      "Jan.",
      "Feb.",
      "Mar.",
      "Apr.",
      "May",
      "June",
      "July",
      "Aug.",
      "Sept.",
      "Oct.",
      "Nov.",
      "Dec.",
    ];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31)
      entry += ` Accessed ${d} ${months[m - 1]} ${y}.`;
  }
  return entry;
}
export function pageRange(value: string): [number, number] | undefined {
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(
    value.trim().replace(/^pp?\.\s*/i, ""),
  );
  if (!m) return;
  const first = Number(m[1]);
  let last = Number(m[2]);
  if (m[2].length < m[1].length) {
    const base = 10 ** m[2].length;
    last = Math.floor(first / base) * base + last;
    if (last < first) last += base;
  }
  return last >= first ? [first, last] : undefined;
}
export function locatorPages(locator: string): number[] {
  if (!/^\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*$/.test(locator))
    return [];
  const result: number[] = [];
  for (const part of locator.split(",")) {
    const range = pageRange(part);
    if (range) {
      if (range[1] - range[0] > 20) return [];
      for (let i = range[0]; i <= range[1]; i++) result.push(i);
    } else result.push(Number(part.trim()));
  }
  return [...new Set(result)];
}
