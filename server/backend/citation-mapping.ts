import {
  parseCitationOccurrences,
  type CitationReference,
  type ReferenceMetadata,
} from "./citations.js";
import type { CitationCheck, Citation } from "../../shared/backend.js";
import { parseReference } from "./references.js";
import { citationDois } from "../../shared/mla.js";

export function referenceMetadata(value: any): ReferenceMetadata {
  // Older DOI imports discarded registry name boundaries. An explicit inverted
  // bibliography name can recover them without guessing a surname from a string.
  const doi = citationDois(value.doi || "")[0];
  const imported =
    value.importedReference &&
    doi &&
    citationDois(value.importedReference)[0] === doi
      ? parseReference(value.importedReference).authorDetails
      : undefined;
  const authorDetails = value.authorDetails?.length
    ? value.authorDetails
    : imported?.length &&
        imported.every((author) => author.family && author.given)
      ? imported
      : undefined;
  return {
    ...value,
    type:
      value.type ||
      (value.journal || value.containerTitle
        ? "article-journal"
        : value.isbn
          ? "book"
          : value.url
            ? "webpage"
            : "document"),
    authors: authorDetails?.length
      ? authorDetails.map((author: any) =>
          author.family || author.given
            ? { family: author.family, given: author.given }
            : { literal: author.literal || author.name },
        )
      : value.authors,
    containerTitle: value.containerTitle || value.journal,
  };
}

/** Bibliography identity maps to the selected work, even when its text is unavailable. */
export function citationReferences(
  sources: CitationReference[],
  references: any[],
): CitationReference[] {
  const imported = references.map((ref) => ({
    id: ref.resolvedAssetId || ref.asset_id || ref.id,
    metadata: referenceMetadata({
      ...ref.parsed,
      importedReference: ref.original || ref.parsed?.importedReference,
    }),
  }));
  return [
    ...sources
      .filter(
        (source) =>
          !imported.some((ref) => ref.id === source.id) &&
          !references.some(
            (ref) => ref.resolvedAssetId && ref.asset_id === source.id,
          ),
      )
      .map((source) => ({
        ...source,
        metadata: referenceMetadata(source.metadata),
      })),
    ...imported,
  ];
}

export function claimCitationChecks(
  text: string,
  start: number,
  references: CitationReference[],
): CitationCheck[] {
  const occurrences = parseCitationOccurrences(text, references);
  // Split only explicit contrast clauses with citations on both sides. A
  // multi-part finding attributed to one work remains one claim.
  const boundaries = [
    ...text.matchAll(/[,;]\s*(?:although|whereas|while|but|however|yet)\s+/gi),
  ].filter(
    (match) =>
      !occurrences.some(
        (o) => match.index! >= o.start && match.index! < o.end,
      ) &&
      occurrences.some((o) => o.end <= match.index!) &&
      occurrences.some((o) => o.start >= match.index! + match[0].length),
  );
  return occurrences.flatMap((occurrence) => {
    const before = boundaries.filter((b) => b.index! < occurrence.start).at(-1);
    const after = boundaries.find((b) => b.index! >= occurrence.end);
    const from = before ? before.index! + before[0].length : 0;
    const to = after?.index ?? text.length;
    const claimText = text.slice(from, to).trim();
    const claimStart =
      start +
      from +
      text.slice(from, to).length -
      text.slice(from, to).trimStart().length;
    return occurrence.items.map((item, itemIndex) => {
      const metadata =
        item.sourceIds.length === 1
          ? references.find((ref) => ref.id === item.sourceIds[0])?.metadata
          : undefined;
      return {
        start: start + occurrence.start,
        end: start + occurrence.end,
        itemIndex,
        text:
          occurrence.form === "narrative" && item.author
            ? occurrence.raw === `(${item.raw})`
              ? `${item.author} ${item.raw}`
              : occurrence.raw
            : item.raw,
        sourceIds: item.sourceIds,
        status: item.status,
        locator: item.locator,
        support: "not_verified",
        citation: item.status !== "matched" ? "ambiguous" : "not_checked",
        checkedPassageIds: [],
        ...(metadata ? { sourceAccess: "metadata" as const } : {}),
        claimText,
        claimStart,
        claimEnd: claimStart + claimText.length,
        ...(metadata
          ? {
              source: {
                title: metadata.title,
                authors: (metadata.authors || []).map((author) =>
                  typeof author === "string"
                    ? author
                    : [author.given, author.family].filter(Boolean).join(" ") ||
                      author.literal ||
                      "",
                ),
                year: metadata.year,
                doi: metadata.doi,
                journal: metadata.containerTitle,
                bibliographyEntry: (
                  metadata as ReferenceMetadata & { importedReference?: string }
                ).importedReference,
              },
            }
          : {}),
      } as CitationCheck;
    });
  });
}

export function combinedCitation(
  checks: Pick<CitationCheck, "citation">[],
): Citation {
  // A correct citation cannot hide an unresolved or incorrect companion citation.
  for (const status of [
    "ambiguous",
    "wrong_source",
    "wrong_locator",
    "not_checked",
  ] as const)
    if (checks.some((check) => check.citation === status)) return status;
  return checks.length ? "correct" : "missing";
}
