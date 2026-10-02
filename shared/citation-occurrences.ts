import type {
  CitationReference,
  ReferenceMetadata,
} from "./citation-format.js";

export interface CitationOccurrenceItem {
  raw: string;
  author?: string;
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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function authorKey(metadata: ReferenceMetadata) {
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
  return authors.length > 2 ? `${authors[0]} et al.` : authors.join(" and ");
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
  if (normalize(author) === normalize(authorKey(metadata))) return true;
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
    const key = normalize(authorKey(reference.metadata));
    if (!key) return [];
    const index = normalized.lastIndexOf(` ${key} `);
    return index >= 0 ? [{ reference, index }] : [];
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
    const start = match.index!;
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
        candidates = narrativeCandidates(
          body.slice(0, start),
          references,
        ).filter(
          (reference) =>
            !yearMatch || String(reference.metadata.year) === yearMatch[1],
        );
        if (!candidates.length) {
          if (!yearMatch) continue;
          author =
            /([\p{Lu}][\p{L}'’-]+(?:\s+et al\.)?)\s*$/u.exec(
              body.slice(0, start),
            )?.[1] || "";
          if (!author) continue;
        } else author = authorKey(candidates[0].metadata);
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
        !/^(?:(?:de|van|von|der|den|da|di)\s+)*[\p{Lu}][\p{L}\p{N}.'’-]*(?:\s+(?:and|of|the|de|van|von|der|den|da|di|et al\.|[\p{Lu}][\p{L}\p{N}.'’-]*))*$/u.test(
          author,
        )
      )
        continue;
      items.push({
        raw,
        author: author || undefined,
        title: quoted?.[1],
        locator,
        year: yearMatch?.[1],
        sourceIds: candidates.map((reference) => reference.id),
        status:
          candidates.length === 1
            ? "matched"
            : candidates.length
              ? "ambiguous"
              : "unmatched",
      });
    }
    if (items.length)
      occurrences.push({
        id: `citation-${start}`,
        start,
        end: start + match[0].length,
        raw: match[0],
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
    occurrences.push({
      id: `citation-${match.index}`,
      start: match.index!,
      end: match.index! + raw.length,
      raw,
      form: "doi",
      items: [
        {
          raw,
          sourceIds: candidates.map((reference) => reference.id),
          status:
            candidates.length === 1
              ? "matched"
              : candidates.length
                ? "ambiguous"
                : "unmatched",
        },
      ],
    });
  }
  return occurrences.sort((a, b) => a.start - b.start);
}
