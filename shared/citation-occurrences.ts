import type {
  CitationReference,
  ReferenceMetadata,
} from "./citation-format.js";

export interface CitationOccurrenceItem {
  raw: string;
  author?: string;
  authors?: string[];
  title?: string;
  locator?: string;
  year?: string;
  sourceIds: string[];
  status: "matched" | "ambiguous" | "unmatched";
}
export interface CitationOccurrence {
  id: string;
  start: number;
  end: number;
  raw: string;
  form: "parenthetical" | "narrative" | "doi";
  items: CitationOccurrenceItem[];
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function authorKeys(metadata: ReferenceMetadata) {
  const authors = (metadata.authors ?? [])
    .map((author) => {
      if (typeof author !== "string")
        return author.family || author.literal || "";
      // Unstructured names remain intact. Family-name boundaries are not guessed.
      return author.includes(",")
        ? author.slice(0, author.indexOf(",")).trim()
        : author.trim();
    })
    .filter(Boolean);
  return authors.length > 2
    ? [
        `${authors[0]} et al.`,
        `${authors.slice(0, -1).join(", ")}, and ${authors.at(-1)}`,
      ]
    : [authors.join(" and ")];
}
const authorKey = (metadata: ReferenceMetadata) => authorKeys(metadata)[0];
function immediateNarrativeAuthor(
  prefix: string,
  references: CitationReference[],
) {
  // Prefer explicit bibliography names (including organizations and compound
  // surnames), but require them immediately before the year.
  const known = references
    .flatMap((reference) => authorKeys(reference.metadata))
    .map((author) =>
      new RegExp(
        `(?<![\\p{L}])(${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ and /g, " (?:and|&) ")})\\s*$`,
        "u",
      ).exec(prefix),
    )
    .filter((match): match is RegExpExecArray => !!match)
    .sort((a, b) => b[1].length - a[1].length)[0];
  return (
    known ||
    /(?<![\p{L}])((?:(?:de|van|von|der|den|da|di)\s+)*\p{Lu}[\p{L}'’-]+(?:,\s*(?:(?:and|&)\s+)?\p{Lu}[\p{L}'’-]+|\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]+)*(?:\s+et al\.)?)\s*$/u.exec(
      prefix,
    )
  );
}
function titleMatches(title: string, metadata: ReferenceMetadata) {
  const cited = normalize(title);
  return Boolean(
    cited &&
    [metadata.title, metadata.shortTitle].some((value) => {
      const known = normalize(value || "");
      return (
        known === cited || (cited.length >= 12 && known.startsWith(cited + " "))
      );
    }),
  );
}
function sameAuthor(author: string, metadata: ReferenceMetadata) {
  if (authorKeys(metadata).some((key) => normalize(author) === normalize(key)))
    return true;
  if (metadata.authors?.length !== 1) return false;
  const first = metadata.authors[0];
  if (typeof first === "string" || !first.family || !first.given) return false;
  return [
    `${first.given} ${first.family}`,
    `${first.given.slice(0, 1)} ${first.family}`,
  ].some((value) => normalize(value) === normalize(author));
}
function narrativeCandidates(prefix: string, references: CitationReference[]) {
  // Only the current sentence/paragraph can supply a narrative author. In
  // particular, an author named in an earlier sentence cannot claim a page.
  const boundary = Math.max(
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
  );
  let current = prefix.slice(boundary + 1);
  for (let i = current.length - 1; i >= 0; i--) {
    if (current[i] !== "." || /et al\.$/i.test(current.slice(0, i + 1)))
      continue;
    current = current.slice(i + 1);
    break;
  }
  const normalized = ` ${normalize(current)} `;
  const mentions = references.flatMap((reference) => {
    return authorKeys(reference.metadata).flatMap((author) => {
      const key = normalize(author);
      if (!key) return [];
      const index = normalized.lastIndexOf(` ${key} `);
      return index >= 0 ? [{ reference, index }] : [];
    });
  });
  const latest = Math.max(-1, ...mentions.map((mention) => mention.index));
  return mentions
    .filter((mention) => mention.index === latest)
    .map((mention) => mention.reference);
}

/** Every occurrence retains the exact draft span. Repetitions are not collapsed. */
export function parseCitationOccurrences(
  text: string,
  references: CitationReference[] = [],
): CitationOccurrence[] {
  const bibliography = /^\s*(?:works cited|references|bibliography)\s*$/im.exec(
    text,
  );
  const body = text.slice(0, bibliography?.index ?? text.length);
  const occurrences: CitationOccurrence[] = [];
  for (const match of body.matchAll(/\(([^()\n]{1,500})\)/g)) {
    const parenthesisStart = match.index!;
    let start = parenthesisStart;
    let form: CitationOccurrence["form"] = "parenthetical";
    const items: CitationOccurrenceItem[] = [];
    for (const part of match[1].split(";")) {
      const raw = part.trim();
      if (!raw || /^n\s*=/i.test(raw)) continue;
      const yearMatch =
        /(?:,\s*|\s|^)((?:1[5-9]|20)\d{2})(?:[a-z])?(?:,|$)/i.exec(raw);
      const quoted = /["“]([^"”]+)["”]/.exec(raw);
      const pageMatch =
        /(?:^|\s|,)(?:pp?\.\s*)?(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)$/.exec(
          raw,
        );
      let locator = pageMatch?.[1];
      if (locator === yearMatch?.[1]) locator = undefined;
      const beforePage =
        pageMatch && locator ? raw.slice(0, pageMatch.index).trim() : raw;
      let author = (quoted ? beforePage.slice(0, quoted.index) : beforePage)
        .replace(/,?\s*(?:1[5-9]|20)\d{2}[a-z]?(?:,\s*p{1,2}\.)?\s*$/i, "")
        .replace(/[,\s]+$/, "")
        .trim();
      const titleOnly =
        !quoted &&
        references.some(
          (reference) =>
            !reference.metadata.authors?.length &&
            titleMatches(author, reference.metadata),
        );
      let candidates = references.filter(
        (reference) =>
          (!author ||
            (titleOnly
              ? !reference.metadata.authors?.length &&
                titleMatches(author, reference.metadata)
              : sameAuthor(author, reference.metadata))) &&
          (!quoted || titleMatches(quoted[1], reference.metadata)) &&
          (!yearMatch || String(reference.metadata.year) === yearMatch[1]),
      );
      if (!author && !quoted && (locator || yearMatch)) {
        const immediate = yearMatch
          ? immediateNarrativeAuthor(
              body.slice(0, parenthesisStart),
              references,
            )
          : undefined;
        candidates = (
          yearMatch
            ? references.filter(
                (reference) =>
                  !!immediate && sameAuthor(immediate[1], reference.metadata),
              )
            : narrativeCandidates(body.slice(0, parenthesisStart), references)
        ).filter(
          (reference) =>
            !yearMatch || String(reference.metadata.year) === yearMatch[1],
        );
        if (!candidates.length) {
          if (!yearMatch) continue;
          author = immediate?.[1] || "";
          if (!author) continue;
        } else author = immediate?.[1] || authorKey(candidates[0].metadata);
        if (immediate) start = immediate.index;
        form = "narrative";
      } else if (
        !candidates.length &&
        (!/[\p{L}]/u.test(author) || (!locator && !yearMatch && !quoted))
      ) {
        continue;
      }
      // Unknown author-and-year forms must still look like a name, not a
      // factual aside such as "its population doubled in 2024".
      if (
        !candidates.length &&
        !quoted &&
        author &&
        !/^(?:(?:de|van|von|der|den|da|di)\s+)*[\p{Lu}][\p{L}\p{N}.'’-]*(?:,?\s+(?:&|and|of|the|de|van|von|der|den|da|di|et al\.|[\p{Lu}][\p{L}\p{N}.'’-]*))*$/u.test(
          author,
        )
      )
        continue;
      const sourceIds = [
        ...new Set(candidates.map((reference) => reference.id)),
      ];
      items.push({
        raw,
        author: author || undefined,
        authors:
          author && !titleOnly
            ? author
                .replace(/\s+et al\.$/i, "")
                .split(/,\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+/)
                .filter(Boolean)
            : undefined,
        title: quoted?.[1],
        locator,
        year: yearMatch?.[1],
        sourceIds,
        status:
          sourceIds.length === 1
            ? "matched"
            : sourceIds.length
              ? "ambiguous"
              : "unmatched",
      });
    }
    if (items.length)
      occurrences.push({
        id: `citation-${start}`,
        start,
        end: parenthesisStart + match[0].length,
        raw: body.slice(start, parenthesisStart + match[0].length),
        form,
        items,
      });
  }
  for (const match of body.matchAll(/10\.\d{4,9}\/[\w.();/:+-]+/gi)) {
    if (
      occurrences.some(
        (occurrence) =>
          match.index! >= occurrence.start && match.index! < occurrence.end,
      )
    )
      continue;
    const raw = match[0].replace(/[.,;:)]+$/, "");
    const candidates = references.filter(
      (reference) =>
        reference.metadata.doi
          ?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
          .toLowerCase() === raw.toLowerCase(),
    );
    const sourceIds = [...new Set(candidates.map((reference) => reference.id))];
    occurrences.push({
      id: `citation-${match.index}`,
      start: match.index!,
      end: match.index! + raw.length,
      raw,
      form: "doi",
      items: [
        {
          raw,
          sourceIds,
          status:
            sourceIds.length === 1
              ? "matched"
              : sourceIds.length
                ? "ambiguous"
                : "unmatched",
        },
      ],
    });
  }
  return occurrences.sort((a, b) => a.start - b.start);
}
