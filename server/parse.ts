import { selectClaims } from "./claims.js";
import type { Claim, Source } from "../shared/types.js";
import { mlaAuthorKey, mlaFromSource } from "../shared/mla.js";
import { parseCitationOccurrences } from "../shared/citation-occurrences.js";
import type { CitationReference } from "../shared/citation-format.js";
export const DOI_PATTERN = /10\.\d{4,9}\/[\w.();/:+-]+/gi;
export function dois(text: string): string[] {
  return [
    ...new Set(
      (text.match(DOI_PATTERN) || []).map((d) =>
        d.replace(/[.,;:)]+$/, "").toLowerCase(),
      ),
    ),
  ];
}
export function bodyEnd(text: string) {
  return text.search(/^\s*(?:works cited|references|bibliography)\s*$/im);
}
export function referenceLines(text: string) {
  const i = bodyEnd(text);
  return i < 0
    ? []
    : text
        .slice(i)
        .split("\n")
        .map((s) => s.trim())
        .filter(
          (s) => s && !/^(works cited|references|bibliography)$/i.test(s),
        );
}
export function citations(text: string, sources: Source[] = []): string[] {
  const references: CitationReference[] = sources.map((source) => ({
    id: source.id,
    metadata: {
      title: source.title,
      year: source.year,
      doi: source.doi,
      authors: source.authorDetails?.length
        ? source.authorDetails.map((author) =>
            author.name
              ? { literal: author.name }
              : { family: author.family, given: author.given },
          )
        : source.authors,
    },
  }));
  return [
    ...new Set(
      parseCitationOccurrences(text, references).flatMap((occurrence) =>
        occurrence.items.map((item) =>
          occurrence.form === "narrative" && item.author
            ? `${item.author} ${item.raw}`
            : item.raw,
        ),
      ),
    ),
  ];
}
export function extractClaims(
  text: string,
  strict = false,
  sources: Source[] = [],
): Claim[] {
  const claims: Claim[] = [];
  for (const sentence of selectClaims(text).candidates) {
    const refs = citations(sentence.text, sources);
    if (refs.length || strict)
      claims.push({
        ...sentence,
        id: `claim-${sentence.start}`,
        citations: refs,
      });
  }
  return claims;
}
export function matchesCitation(citation: string, source: Source) {
  const doi = dois(citation)[0];
  if (doi) return doi === source.doi?.toLowerCase();
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const author = normalize(citation).match(/[a-z-]+/)?.[0];
  const year = citation.match(/\b(?:19|20)\d{2}\b/)?.[0];
  return (
    !!author &&
    source.authors.some((a) =>
      normalize(a)
        .split(/[\s,]+/)
        .includes(author),
    ) &&
    (!year || year === source.year)
  );
}
export function relevantPassages(claim: string, passages: string[], limit = 9) {
  const stop = new Set(
    "the that this with from were have been their they which paper source claim evidence into than and for but not are was its all et al".split(
      " ",
    ),
  );
  const terms = (s: string) =>
    (
      s
        .toLowerCase()
        .replace(/(?<=\d)[,\u2009\u202f](?=\d{3}\b)/g, "")
        .match(/[a-z]{3,}|\d+(?:\.\d+)?/g) || []
    )
      .filter((t) => !stop.has(t))
      .map((t) => t.replace(/(?:ing|ed|s)$/, ""));
  const query = new Set(terms(claim.replace(/\([^()]+\)/g, "")));
  const documents = passages.map((text) => terms(text));
  const avg =
    documents.reduce((n, d) => n + d.length, 0) / Math.max(documents.length, 1);
  const idf = new Map(
    [...query].map((term) => [
      term,
      Math.log(
        1 +
          (documents.length -
            documents.filter((d) => d.includes(term)).length +
            0.5) /
            (documents.filter((d) => d.includes(term)).length + 0.5),
      ),
    ]),
  );
  return passages
    .map((text, i) => {
      const tokens = documents[i];
      let score = 0;
      for (const term of query) {
        const frequency = tokens.filter((t) => t === term).length;
        if (frequency)
          score +=
            ((idf.get(term) || 0) *
              (/^\d/.test(term) && !/^(19|20)\d{2}$/.test(term) ? 4 : 1) *
              (frequency * 2.2)) /
            (frequency +
              1.2 * (0.25 + (0.75 * tokens.length) / Math.max(avg, 1)));
      }
      return { text, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((p) => p.text);
}
export function numbers(text: string) {
  return [
    ...text
      .replace(/(?<=\d)[,\u2009\u202f](?=\d{3}\b)/g, "")
      .matchAll(/(?<![\w.])-?\d+(?:\.\d+)?\s*%?/g),
  ].map((m) => ({
    raw: m[0].trim(),
    value: Number(m[0].replace("%", "").trim()),
    percent: m[0].includes("%"),
  }));
}
export function numericMismatch(claim: string, passage: string) {
  const c = numbers(claim),
    e = numbers(passage);
  return c.some(
    (a) => !e.some((b) => a.value === b.value && a.percent === b.percent),
  );
}

export function quantities(text: string) {
  return [
    ...text.matchAll(
      /(?<![\w.])(-?(?:\d{1,3}(?:[,\u2009\u202f ]\d{3})+|\d+)(?:\.\d+)?)\s*(?:unique\s+)?((?:studies|trials|participants|patients|adults|children|years|months|weeks|days|hours|minutes)\b|%)/gi,
    ),
  ].map((match) => ({
    value: Number(match[1].replace(/[,\u2009\u202f ]/g, "")),
    raw: match[1],
    unit: match[2].toLowerCase(),
    start: match.index!,
    end: match.index! + match[1].length,
  }));
}
export function quantityMismatches(claim: string, passages: string[]) {
  const claims = quantities(
    claim.replace(/\([^()]+\)/g, (part) => " ".repeat(part.length)),
  );
  const seen = new Set<string>();
  return passages
    .flatMap((passage, index) =>
      quantities(passage).flatMap((actual) =>
        claims
          .filter(
            (stated) =>
              stated.unit === actual.unit && stated.value !== actual.value,
          )
          .map((stated) => ({ stated, actual, passageIndex: index })),
      ),
    )
    .filter((pair) => {
      const key = `${pair.stated.value}:${pair.actual.value}:${pair.actual.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}
