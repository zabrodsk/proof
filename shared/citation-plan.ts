import type { EvidenceLink } from "./backend.js";

export interface CitationOperation {
  id: string;
  findingId?: string;
  kind: "citation" | "bibliography";
  start: number;
  end: number;
  original: string;
  replacement: string;
  referenceIds: string[];
  evidence: EvidenceLink[];
  explanation: string[];
}
export interface PlanReference {
  id: string;
  assetId: string;
  identity: string;
  text: string;
  html: string;
}
export interface CitationPlan {
  id: string;
  runId: string;
  documentId: string;
  documentVersionId: string;
  profile: "mla9" | "classroom";
  profileVersion: string;
  status: "ready" | "applied";
  operations: CitationOperation[];
  references: PlanReference[];
  bibliography: {
    start: number;
    end: number;
    heading: string;
    entries: {
      original: string;
      start?: number;
      end?: number;
      referenceId?: string;
    }[];
  };
  gaps: { findingId: string; claim: string; reason: string }[];
  exemptions?: { findingId: string; claim: string; reason: string }[];
  warnings: string[];
  coverage: {
    totalClaims: number;
    citableClaims: number;
    citationExemptClaims?: number;
  };
  previewText: string;
  resultVersionId?: string;
  appliedOperationIds?: string[];
  deferredOperationIds?: string[];
  audit?: {
    occurrences: {
      id: string;
      text: string;
      start: number;
      end: number;
      form: string;
      status: "matched" | "ambiguous" | "unmatched";
      sourceIds: string[];
      locator?: string;
      citation?: string;
    }[];
    bibliographyIssues: {
      kind: string;
      text: string;
      detail: string;
      referenceIds: string[];
    }[];
    counts: {
      occurrences: number;
      distinctCitedWorks: number;
      bibliographyEntries: number;
    };
    assignmentChecks?: {
      label: string;
      status: "pass" | "issue" | "manual";
      detail: string;
    }[];
    wordCounts?: {
      body: number;
      title: number;
      bibliography: number;
      combined: number;
      convention: string;
    };
  };
}

/** Pure preview shared by review and server apply. Only the stored plan is trusted. */
export function renderCitationPlan(
  text: string,
  plan: CitationPlan,
  operationIds: string[],
) {
  if (new Set(operationIds).size !== operationIds.length)
    throw new Error("Select each proposed change only once.");
  const selected = operationIds.map((id) => {
    const op = plan.operations.find((o) => o.id === id);
    if (!op) throw new Error("A selected citation change is unavailable.");
    return op;
  });
  const bodyOps = selected.filter((o) => o.kind === "citation");
  const ascending = [...bodyOps].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  for (let i = 0; i < ascending.length; i++) {
    const op = ascending[i];
    if (
      !Number.isInteger(op.start) ||
      !Number.isInteger(op.end) ||
      op.start < 0 ||
      op.end < op.start ||
      op.end > plan.bibliography.start ||
      text.slice(op.start, op.end) !== op.original
    )
      throw new Error("The proposed citation no longer matches the draft.");
    const previous = ascending[i - 1];
    if (previous && (previous.end > op.start || previous.start === op.start))
      throw new Error("The selected citation changes overlap.");
  }
  let body = text.slice(0, plan.bibliography.start);
  for (const op of [...ascending].reverse())
    body = body.slice(0, op.start) + op.replacement + body.slice(op.end);
  const needed = new Set(selected.flatMap((o) => o.referenceIds));
  const entries = plan.bibliography.entries.map((entry) => {
    const operation = selected.find(
      (o) =>
        o.kind === "bibliography" &&
        o.original === entry.original &&
        o.start === entry.start &&
        o.end === entry.end,
    );
    if (operation) {
      if (text.slice(operation.start, operation.end) !== operation.original)
        throw new Error("The bibliography changed. Review it again.");
      return operation.replacement;
    }
    return entry.original;
  });
  const included = new Set(
    plan.bibliography.entries.flatMap((entry) => {
      const reference = plan.references.find((r) => r.id === entry.referenceId);
      return reference ? [reference.identity] : [];
    }),
  );
  for (const id of needed) {
    const reference = plan.references.find((r) => r.id === id);
    if (!reference)
      throw new Error("The citation's bibliography entry is unavailable.");
    if (included.has(reference.identity)) continue;
    const existing = plan.bibliography.entries.findIndex(
      (e) => e.referenceId === id,
    );
    if (existing < 0 && !entries.includes(reference.text))
      entries.push(reference.text);
    included.add(reference.identity);
  }
  if (!selected.length) return text;
  // Retain unselected and unused entries verbatim. Sort without changing their text.
  const key = (value: string) => value.replace(/^[\s"'“”*]+/, "");
  entries.sort((a, b) =>
    key(a).localeCompare(key(b), "en", { sensitivity: "base" }),
  );
  if (!entries.length) return body + text.slice(plan.bibliography.start);
  return `${body.trimEnd()}\n\n${plan.bibliography.heading}\n\n${entries.join("\n\n")}`;
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function referenceHtml(value: string) {
  // Formatter output may retain emphasis; no attributes, links or active content.
  return value.replace(/<[^>]*>/g, (tag) => {
    const match = /^<(\/)?(i|em|b|strong)(?:\s[^>]*)?>$/i.exec(tag);
    return match ? `<${match[1] || ""}${match[2].toLowerCase()}>` : "";
  });
}
