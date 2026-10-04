import type { BackendFinding, CitationCheck } from "../shared/backend";
import type { CitationPlan } from "../shared/citation-plan";
import {
  citationExempt,
  findingAssessment,
  findingDetail,
  findingTone,
} from "./studio-document";

export function citationProvenance(
  check: Pick<CitationCheck, "sourceAccess" | "support" | "checkedPassageIds">,
) {
  const checked = check.checkedPassageIds.length > 0;
  const verified = checked && check.support === "supported";
  switch (check.sourceAccess) {
    case "abstract":
      return verified
        ? "Verified from abstract"
        : checked
          ? "Checked against abstract"
          : "Abstract available";
    case "full_text":
      return verified
        ? "Verified from full text"
        : checked
          ? "Checked against full text"
          : "Full text available";
    case "partial_text":
      return "Partial source text available";
    case "uploaded":
      return checked
        ? "Checked against uploaded text"
        : "Uploaded text available";
    case "metadata":
      return "Metadata only";
    case "unavailable":
      return "Source unavailable";
    default:
      return checked ? "Source passage checked" : "Source unavailable";
  }
}

export type CitationIssue = {
  id: string;
  group: "citations" | "bibliography";
  title: string;
  text: string;
  reason: string;
  next?: string;
  start?: number;
  end?: number;
  sourceIds: string[];
  occurrenceId?: string;
  entryIndex?: number;
  finding?: BackendFinding;
  operationIds: string[];
  advisory?: boolean;
};

export function bibliographyIssueEntryIndex(
  plan: CitationPlan,
  issueIndex: number,
) {
  const issue = plan.audit?.bibliographyIssues[issueIndex];
  if (!issue) return -1;
  const entries = plan.bibliography.entries;
  let candidates = entries.flatMap((entry, index) =>
    entry.original.trim() === issue.text.trim() ? [index] : [],
  );
  if (!candidates.length)
    candidates = entries.flatMap((entry, index) =>
      entry.referenceId && issue.referenceIds.includes(entry.referenceId)
        ? [index]
        : [],
    );
  if (issue.kind === "duplicate")
    candidates = candidates.filter((index) =>
      entries
        .slice(0, index)
        .some(
          (entry) =>
            entry.referenceId &&
            entry.referenceId === entries[index].referenceId,
        ),
    );
  const previous = (
    plan.audit?.bibliographyIssues.slice(0, issueIndex) || []
  ).filter(
    (row) => row.kind === issue.kind && row.text.trim() === issue.text.trim(),
  ).length;
  return candidates[previous] ?? candidates[0] ?? -1;
}

export function citationIssues(
  plan: CitationPlan,
  findings: BackendFinding[],
  citedOnly = false,
): CitationIssue[] {
  const issues: CitationIssue[] = [];
  const mode = plan.profile === "classroom" ? "source_check" : undefined;
  for (const finding of findings) {
    if (
      citedOnly &&
      !(plan.audit?.occurrences || []).some(
        (o) => o.start >= finding.claim.start && o.end <= finding.claim.end,
      )
    )
      continue;
    if (citationExempt(finding, mode) || findingTone(finding) === "supported")
      continue;
    const assessment = findingAssessment(finding, mode);
    const occurrences =
      plan.audit?.occurrences.filter(
        (o) => o.start >= finding.claim.start && o.end <= finding.claim.end,
      ) || [];
    issues.push({
      id: `finding:${finding.id}`,
      group: "citations",
      title: findingDetail(finding, mode),
      text: occurrences.map((o) => o.text).join(" · ") || finding.claim.text,
      reason: assessment.meaning,
      next: assessment.next,
      start: finding.claim.start,
      end: finding.claim.end,
      sourceIds: [
        ...new Set(
          occurrences
            .flatMap((o) => o.sourceIds)
            .concat(finding.evidence.map((e) => e.assetId)),
        ),
      ],
      occurrenceId: occurrences[0]?.id,
      finding,
      operationIds: plan.operations
        .filter((op) => op.findingId === finding.id)
        .map((op) => op.id),
    });
  }
  for (const occurrence of plan.audit?.occurrences || []) {
    if (
      occurrence.citation === "not_required" ||
      (occurrence.status === "matched" && occurrence.citation === "correct")
    )
      continue;
    if (
      issues.some(
        (issue) =>
          issue.group === "citations" &&
          issue.start !== undefined &&
          issue.end !== undefined &&
          occurrence.start >= issue.start &&
          occurrence.end <= issue.end,
      )
    )
      continue;
    const title =
      occurrence.status === "unmatched"
        ? "Source not matched"
        : occurrence.status === "ambiguous"
          ? "Source ambiguous"
          : occurrence.citation === "wrong_locator"
            ? "Confirm the page number"
            : occurrence.citation === "wrong_source"
              ? "Wrong source cited"
              : occurrence.citation === "ambiguous"
                ? "Citation unclear"
                : "Evidence not checked";
    issues.push({
      id: `occurrence:${occurrence.id}`,
      group: "citations",
      title,
      text: occurrence.text,
      reason:
        occurrence.status === "unmatched"
          ? "This citation could not be matched to a source in this check."
          : occurrence.status === "ambiguous"
            ? "More than one source could match this citation. Confirm the intended work."
            : occurrence.citation === "wrong_locator"
              ? "The source is matched, but the citation's page reference needs review."
              : "Source identification, evidence support, and locator checks are separate. Review the linked source and checking details.",
      start: occurrence.start,
      end: occurrence.end,
      sourceIds: occurrence.sourceIds,
      occurrenceId: occurrence.id,
      operationIds: plan.operations
        .filter(
          (op) =>
            op.kind === "citation" &&
            op.start <= occurrence.start &&
            op.end >= occurrence.end,
        )
        .map((op) => op.id),
    });
  }
  for (const gap of plan.gaps) {
    if (issues.some((issue) => issue.finding?.id === gap.findingId)) continue;
    const finding = findings.find((f) => f.id === gap.findingId);
    if (
      citedOnly &&
      (!finding ||
        !(plan.audit?.occurrences || []).some(
          (o) => o.start >= finding.claim.start && o.end <= finding.claim.end,
        ))
    )
      continue;
    issues.push({
      id: `gap:${gap.findingId}`,
      group: "citations",
      title: "Citation needs review",
      text: gap.claim,
      reason: gap.reason,
      start: finding?.claim.start,
      end: finding?.claim.end,
      sourceIds: [],
      operationIds: [],
    });
  }
  const labels: Record<string, string> = {
    metadata: "Bibliography details incomplete",
    identity: "Confirm source identity",
    source_access: "Source text unavailable",
    unused: "Entry not cited in draft",
    duplicate: "Duplicate bibliography entry",
    format: "Bibliography formatting",
    missing: "Works Cited entry missing",
    unmatched: "Bibliography source not matched",
    ambiguous: "Bibliography source ambiguous",
    unnecessary_citation: "Citation may not be needed",
  };
  for (const [index, issue] of (
    plan.audit?.bibliographyIssues || []
  ).entries()) {
    const sourceIds = issue.referenceIds.map(
      (id) => plan.references.find((r) => r.id === id)?.assetId || id,
    );
    // Source-access gaps already attached to a claim have one review entry.
    if (
      issue.kind === "source_access" &&
      issues.some(
        (row) =>
          row.title === "Source text unavailable" &&
          row.sourceIds.some((id) => sourceIds.includes(id)),
      )
    )
      continue;
    const entryIndex = bibliographyIssueEntryIndex(plan, index);
    const entry = plan.bibliography.entries[entryIndex];
    issues.push({
      id: `bibliography:${index}`,
      group: "bibliography",
      title: labels[issue.kind] || "Bibliography needs review",
      text: issue.text,
      reason: issue.detail,
      sourceIds,
      entryIndex: entryIndex >= 0 ? entryIndex : undefined,
      start: entry?.start,
      end: entry?.end,
      advisory: ["unused", "unnecessary_citation"].includes(issue.kind),
      operationIds: plan.operations
        .filter(
          (op) =>
            op.kind === "bibliography" &&
            (op.original === issue.text ||
              op.referenceIds.some((id) => issue.referenceIds.includes(id))),
        )
        .map((op) => op.id),
    });
  }
  return issues.sort(
    (a, b) =>
      Number(!!a.advisory) - Number(!!b.advisory) ||
      (a.start ?? Infinity) - (b.start ?? Infinity),
  );
}

export function citationParagraph(content: string, start: number) {
  return (
    content
      .slice(0, start)
      .split(/\n\s*\n/)
      .filter((part) => part.trim()).length || 1
  );
}

type CitationOccurrence = NonNullable<
  CitationPlan["audit"]
>["occurrences"][number];

export function occurrenceEvidenceUnchecked(occurrence: CitationOccurrence) {
  if (occurrence.citation === "not_required") return false;
  if (occurrence.items?.length)
    return occurrence.items.some(
      (item) =>
        item.citation !== "not_required" &&
        (item.citation === "not_checked" || item.support === "not_verified"),
    );
  return !occurrence.citation || occurrence.citation === "not_checked";
}

export function occurrenceNeedsReview(occurrence: CitationOccurrence) {
  if (occurrence.citation === "not_required") return false;
  return (
    occurrence.status !== "matched" ||
    occurrenceEvidenceUnchecked(occurrence) ||
    ["wrong_source", "wrong_locator", "missing", "ambiguous"].includes(
      occurrence.citation || "",
    ) ||
    Boolean(
      occurrence.items?.some(
        (item) =>
          item.citation !== "not_required" &&
          (item.support !== "supported" ||
            ["wrong_source", "wrong_locator", "missing", "ambiguous"].includes(
              item.citation,
            )),
      ),
    )
  );
}
