import { randomUUID } from "node:crypto";
import { dois } from "../parse.js";
import type { Database, Sql } from "./db.js";
import { limits, notFound } from "./config.js";
import { providerFetch } from "./providers.js";
import { sourceLinks } from "../../shared/document-sources.js";
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function reconstructReferences(text: string) {
  const entries: string[] = [];
  let current = "";
  let separated = false;
  for (const line of text.split(/[\n\f]/)) {
    const clean = line.trim();
    if (!clean) {
      separated = true;
      continue;
    }
    if (/^(works cited|references|bibliography|\d+)$/i.test(clean)) continue;
    const start =
      (/^https?:\/\//i.test(clean) && /^https?:\/\//i.test(current.trim())) ||
      /^(?:\[\d+\]|\d+\.)\s+/.test(clean) ||
      /^(?:[A-ZÀ-Ž][\p{L}'’-]+,\s+[^\d]|[—-]{3}\.)/u.test(clean) ||
      /^[\p{Lu}][^.]{2,100}\.\s+["“][^"”]+["”]/u.test(clean) ||
      /^[\p{Lu}][^.]{2,100}\.\s+.{3,}\.\s+(?:.*\b)?(?:1[5-9]|20)\d{2}\b/u.test(
        clean,
      );
    const insideQuotedTitle = (current.match(/["“”]/g)?.length || 0) % 2 === 1;
    const publicationContinuation =
      /^[^,]+,\s*(?:vol\.|no\.|pp?\.|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d)/i.test(
        clean,
      );
    if (
      (start || separated) &&
      current &&
      !insideQuotedTitle &&
      !publicationContinuation
    ) {
      entries.push(current);
      current = "";
    }
    separated = false;
    current += (current ? "\n" : "") + line;
  }
  if (current) entries.push(current);
  return entries.map((original) => ({
    original,
    parsed: parseReference(original),
  }));
}
export function parseReference(original: string) {
  const text = original
    .replace(/^\s*(?:\[\d+\]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const quote = /["“]([^"”]+)["”]/.exec(text);
  // A period in an author's initial is not the end of the author field.
  const author = quote
    ? text
        .slice(0, quote.index)
        .replace(/(?<!\b[A-Z])\.\s*$/u, "")
        .trim()
    : text.split(".")[0]?.trim() || "";
  const title =
    quote?.[1] ||
    text.match(/\((?:1[5-9]|20)\d{2}[a-z]?\)\.\s+(.+?)\.\s/)?.[1] ||
    text.match(/^[^.]+\.\s+(.+?)\.\s/)?.[1];
  const authors = author
    ? author.split(/,?\s+and\s+/).map((s) => s.trim().replace(/,$/, ""))
    : [];
  const authorDetails = authors.map((name, index) => {
    if (name.includes(",")) {
      const [family, ...given] = name.split(",");
      return { family: family.trim(), given: given.join(",").trim() };
    }
    // MLA's subsequent author is in given-family order. Preserve ambiguous
    // multiword family names as literals instead of inventing a boundary.
    const pair =
      index > 0 && /^(\p{Lu}[\p{L}'’-]+)\s+(\p{Lu}[\p{L}'’-]+)$/u.exec(name);
    return pair ? { given: pair[1], family: pair[2] } : { literal: name };
  });
  const tail = quote
    ? text.slice(quote.index + quote[0].length).replace(/^\.?\s*/, "")
    : "";
  const url =
    sourceLinks(text)[0] ||
    text
      .match(/(?:https?:\/\/|(?:[\w-]+\.)+(?:com|org|edu)\/)[^\s]+/)?.[0]
      ?.replace(/[.,;]+$/, "");
  return {
    title,
    authors,
    authorDetails,
    year: (quote ? tail : text).match(/\b(?:1[5-9]|20)\d{2}\b/)?.[0],
    doi: dois(text)[0],
    isbn: text
      .match(/\b(?:97[89][ -]?)?\d[\d -]{8,15}[\dX]\b/)?.[0]
      ?.replace(/[ -]/g, ""),
    edition: text.match(/\b\d+(?:st|nd|rd|th) ed\./i)?.[0],
    type: quote ? "article-journal" : "book",
    ...(quote
      ? {
          containerTitle: tail.split(/,|\./)[0]?.trim(),
          volume: tail.match(/\bvol\.\s*(\d+)/i)?.[1],
          issue: tail.match(/\bno\.\s*(\d+)/i)?.[1],
          pages: tail.match(/\bpp?\.\s*(\d+(?:[–-]\d+)?)/i)?.[1],
        }
      : {}),
    ...(url ? { url: url.startsWith("http") ? url : `https://${url}` } : {}),
  };
}

/** A reference list identifies works; it is never source evidence. */
export function bibliographyIntake(text: string) {
  const heading = /^\s*(?:works cited|references|bibliography)\s*$/im.exec(
    text,
  );
  if (!heading || text.slice(0, heading.index).trim()) return undefined;
  const entries = reconstructReferences(text.slice(heading.index));
  if (
    !entries.length ||
    entries.some((e) => !e.parsed.title || !e.parsed.authors.length)
  )
    return undefined;
  return entries;
}
export async function uploadedBibliography(
  db: Sql,
  ws: string,
  extractionId: string,
) {
  const pages = (
    await db.query(
      "SELECT text FROM source_pages WHERE workspace_id=$1 AND extraction_id=$2 ORDER BY page_index",
      [ws, extractionId],
    )
  ).rows;
  return bibliographyIntake(pages.map((p) => p.text).join("\n"));
}

export async function importReferences(
  db: Database,
  ws: string,
  id: string,
  text: string,
  external: boolean,
) {
  const entries = reconstructReferences(text);
  if (entries.length > limits.bibliographyEntries)
    throw new Error(
      `Bibliography contains ${entries.length} entries; limit is ${limits.bibliographyEntries}. Nothing was omitted silently.`,
    );
  for (let ordinal = 0; ordinal < entries.length; ordinal++) {
    if (
      !(
        await db.query(
          "SELECT id FROM reference_imports WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        )
      ).rows.length
    )
      throw notFound();
    // Every completed entry is a checkpoint; a worker restart must not duplicate it.
    const saved = await db.query(
      "SELECT id FROM reference_entries WHERE workspace_id=$1 AND import_id=$2 AND ordinal=$3",
      [ws, id, ordinal],
    );
    if (saved.rows.length) continue;
    const { original, parsed } = entries[ordinal];
    const candidates: any[] = [];
    let status = "unidentified";
    const uploads = await db.query(
      "SELECT id,metadata FROM source_assets WHERE workspace_id=$1 AND deleted_at IS NULL AND status='ready'",
      [ws],
    );
    const matches = uploads.rows.filter(
      (a) =>
        (!parsed.isbn ||
          normalize(a.metadata.isbn || "") === normalize(parsed.isbn)) &&
        (!parsed.doi ||
          normalize(a.metadata.doi || "") === normalize(parsed.doi)) &&
        normalize(a.metadata.title || "") ===
          normalize(parsed.title || "MISSING") &&
        (!parsed.edition ||
          normalize(a.metadata.edition || "") === normalize(parsed.edition)) &&
        (!parsed.year || a.metadata.year === parsed.year) &&
        parsed.authors.some((author) =>
          (a.metadata.authors || []).some(
            (other: string) =>
              normalize(author).includes(normalize(other)) ||
              normalize(other).includes(normalize(author.split(",")[0])),
          ),
        ),
    );
    if (external && !matches.length && parsed.isbn && !parsed.doi) {
      try {
        const book = await resolveIsbn(parsed.isbn);
        if (book) {
          candidates.push(book);
          status =
            (!parsed.title ||
              normalize(book.title) === normalize(parsed.title)) &&
            (!parsed.year || book.year === parsed.year)
              ? "matched_needs_pdf"
              : "ambiguous";
        }
      } catch {
        status = "unidentified";
      }
    }
    if (
      external &&
      !matches.length &&
      !parsed.isbn &&
      (parsed.doi || parsed.title)
    )
      try {
        const url = parsed.doi
          ? `https://api.crossref.org/works/${encodeURIComponent(parsed.doi)}`
          : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(original.replace(/\s+/g, " "))}&rows=5`;
        const response = await providerFetch(url, {
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          const data = await response.json();
          const works = parsed.doi ? [data.message] : data.message?.items || [];
          for (const w of works)
            if (
              w.DOI &&
              (parsed.doi
                ? normalize(w.DOI) === normalize(parsed.doi)
                : normalize(w.title?.[0] || "") ===
                    normalize(parsed.title || "") &&
                  (!parsed.year ||
                    String(w.published?.["date-parts"]?.[0]?.[0]) ===
                      parsed.year) &&
                  w.author?.some((a: any) =>
                    normalize(parsed.authors[0] || "").includes(
                      normalize(a.family || "INVALID"),
                    ),
                  ))
            )
              candidates.push({
                doi: w.DOI,
                title: w.title?.[0],
                authors: w.author,
                year: w.published?.["date-parts"]?.[0]?.[0],
              });
          status =
            candidates.length === 1
              ? "matched_needs_pdf"
              : candidates.length > 1
                ? "ambiguous"
                : "unidentified";
        }
      } catch {
        status = "unidentified";
      }
    if (matches.length > 1) status = "ambiguous";
    else if (matches.length === 1) status = "matched_ready";
    await db.query(
      "INSERT INTO reference_entries(id,workspace_id,import_id,ordinal,original,parsed,status,candidates,asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        ws,
        id,
        ordinal,
        original,
        JSON.stringify(parsed),
        status,
        JSON.stringify(candidates),
        matches.length === 1 ? matches[0].id : null,
      ],
    );
  }
  await db.query(
    "UPDATE reference_imports SET status='complete' WHERE workspace_id=$1 AND id=$2",
    [ws, id],
  );
}

export function validIsbn(input: string) {
  const value = input.replace(/[ -]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(value))
    return (
      [...value].reduce(
        (sum, c, i) => sum + (c === "X" ? 10 : Number(c)) * (10 - i),
        0,
      ) %
        11 ===
      0
    );
  if (/^97[89]\d{10}$/.test(value))
    return (
      [...value].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) %
        10 ===
      0
    );
  return false;
}
export async function resolveIsbn(input: string) {
  const isbn = input.replace(/[ -]/g, "").toUpperCase();
  if (!validIsbn(isbn)) return;
  const key = `ISBN:${isbn}`;
  const response = await providerFetch(
    `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&jscmd=data&format=json`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) return;
  const book = (await response.json())[key];
  if (
    !book ||
    typeof book.title !== "string" ||
    ![
      ...(book.identifiers?.isbn_10 || []),
      ...(book.identifiers?.isbn_13 || []),
    ].includes(isbn)
  )
    return;
  return {
    isbn,
    title: book.title,
    authors: (book.authors || []).map((a: any) => a.name),
    publisher: (book.publishers || []).map((p: any) => p.name).join("; "),
    year: book.publish_date?.match(/\b(?:1[5-9]|20)\d{2}\b/)?.[0],
    url: book.url,
  };
}
