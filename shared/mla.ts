import type { Source } from "./types";

export type MlaSource = {
  authors: string; // One author per line: Family, Given. Organizations stay intact.
  title: string;
  journal: string;
  year: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
};
export type CitationEdit = {
  start: number;
  end: number;
  original: string;
  replacement: string;
};
export type MlaIssue = {
  id: string;
  title: string;
  explanation: string;
  original: string;
  context?: string;
  edit?: CitationEdit;
};
export const blankMlaSource: MlaSource = {
  authors: "",
  title: "",
  journal: "",
  year: "",
  volume: "",
  issue: "",
  pages: "",
  doi: "",
};
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export const citationDois = (text: string) => [
  ...new Set(
    (text.match(/10\.\d{4,9}\/[\w.();/:+-]+/gi) || []).map((d) =>
      d.replace(/[.,;:)]+$/, "").toLowerCase(),
    ),
  ),
];
export function mlaTitle(title: string) {
  const minor = new Set(
    "a an the and but or nor for so yet as at by in of on per to up via with from into onto over than till upon".split(
      " ",
    ),
  );
  const words = clean(title).split(" ");
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (
        i > 0 &&
        i < words.length - 1 &&
        !/[:?!]$/.test(words[i - 1]) &&
        minor.has(lower)
      )
        return lower;
      return word.replace(/(^|[-:])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}
export function mlaFromSource(source: Source): MlaSource {
  return {
    authors: source.authorDetails?.length
      ? source.authorDetails
          .map((a) => a.name || [a.family, a.given].filter(Boolean).join(", "))
          .join("\n")
      : source.authors
          .map((a) =>
            a.includes(",") ? a : a.trim().replace(/^(.+)\s+(\S+)$/, "$2, $1"),
          )
          .join("\n"),
    title: mlaTitle(source.title),
    journal: source.journal || "",
    year: source.year,
    volume: source.volume || "",
    issue: source.issue || "",
    pages: source.pages || "",
    doi: source.doi || "",
  };
}
export function mlaAuthorKey(source: MlaSource) {
  const authors = source.authors.split("\n").map(clean).filter(Boolean);
  const surnames = authors.map((a) => a.split(",")[0]);
  return authors.length > 2 ? `${surnames[0]} et al.` : surnames.join(" and ");
}
export function formatMla(
  source: MlaSource,
  locator = "",
  distinguishTitle = false,
) {
  const authors = source.authors.split("\n").map(clean).filter(Boolean);
  const normalName = (name: string) =>
    name.includes(",")
      ? name
          .split(",")
          .map((s) => s.trim())
          .reverse()
          .join(" ")
      : name;
  const author =
    authors.length > 2
      ? `${authors[0]}, et al.`
      : authors.length === 2
        ? `${authors[0]}, and ${normalName(authors[1]).replace(/\.$/, "")}.`
        : authors.length
          ? `${authors[0].replace(/\.$/, "")}.`
          : "";
  const title = clean(source.title).replace(/^["“]|["”]$/g, "");
  const quoted = `"${title}${/[.!?]$/.test(title) ? "" : "."}"`;
  const details = [
    source.journal && `*${clean(source.journal).replace(/\*/g, "")}*`,
    source.volume && `vol. ${clean(source.volume).replace(/^vol\.\s*/i, "")}`,
    source.issue && `no. ${clean(source.issue).replace(/^no\.\s*/i, "")}`,
    clean(source.year),
  ];
  const pages = clean(source.pages).replace(/^pp?\.\s*/i, "");
  // An electronic article identifier is not a printed page range.
  if (/^\d+(?:\s*[-–]\s*\d+|\+)?$/.test(pages))
    details.push(`${/[-–+]/.test(pages) ? "pp." : "p."} ${pages}`);
  const doi = citationDois(source.doi)[0];
  if (doi) details.push(`https://doi.org/${doi}`);
  const entry = [author, quoted, details.filter(Boolean).join(", ") + "."]
    .filter(Boolean)
    .join(" ");
  const key = mlaAuthorKey(source) || `"${title.replace(/[.!?]$/, "")}"`;
  const inText = `(${key}${distinguishTitle && authors.length ? `, "${title.replace(/[.!?]$/, "")}"` : ""}${clean(locator) ? " " + clean(locator).replace(/^pp?\.\s*/i, "") : ""})`;
  return { entry, inText };
}
export function mlaWarnings(source: MlaSource) {
  return [
    !source.authors.trim() &&
      "No author entered. The citation will begin with the title.",
    !source.year.trim() &&
      "Publication year is missing. Check the paper before adding this entry.",
    !source.pages.trim() &&
      "No page range was supplied. Include it if the journal uses continuous page numbers.",
    !!source.doi.trim() &&
      !citationDois(source.doi).length &&
      "Enter a valid DOI, or leave the DOI field empty for a print source.",
  ].filter((s): s is string => !!s);
}
export function bibliography(text: string) {
  const heading =
    /^([ \t]*)(works cited|references|bibliography)[ \t]*$/im.exec(text);
  if (!heading)
    return {
      heading: undefined,
      entries: [] as { text: string; start: number; end: number }[],
    };
  const offset = heading.index + heading[0].length;
  const entries = [...text.slice(offset).matchAll(/[^\r\n]+/g)]
    .filter((m) => m[0].trim())
    .map((m) => ({
      text: m[0],
      start: offset + m.index!,
      end: offset + m.index! + m[0].length,
    }));
  return {
    heading: { start: heading.index, end: offset, text: heading[0] },
    entries,
  };
}
function matchEntry(entry: string, sources: MlaSource[]) {
  const doi = citationDois(entry)[0];
  if (doi) return sources.filter((s) => citationDois(s.doi)[0] === doi);
  const title = entry.match(/["“]([^"”]+)["”]/)?.[1];
  return title ? sources.filter((s) => norm(s.title) === norm(title)) : [];
}
export function uniqueMlaSources(sources: MlaSource[]) {
  const map = new Map<string, MlaSource>();
  for (const source of sources)
    map.set(
      citationDois(source.doi)[0] || norm(source.title + source.authors),
      source,
    );
  return [...map.values()];
}
export function applyCitationEdit(text: string, edit: CitationEdit) {
  if (text.slice(edit.start, edit.end) !== edit.original)
    throw new Error(
      "The text changed. Review the citations again before applying this change.",
    );
  return text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
}
export function addMlaEntry(text: string, source: MlaSource) {
  const entry = formatMla(source).entry;
  const { heading, entries } = bibliography(text);
  const matches = entries.filter((e) => matchEntry(e.text, [source]).length);
  if (matches.length > 1)
    throw new Error(
      "This source appears more than once. Review and remove the duplicate before updating it.",
    );
  if (matches.length === 1)
    return applyCitationEdit(text, {
      ...matches[0],
      original: matches[0].text,
      replacement: entry,
    });
  if (!heading) return text.trimEnd() + "\n\nWorks Cited\n" + entry + "\n";
  const after = entries.find(
    (e) => sortKey(e.text).localeCompare(sortKey(entry), "en") > 0,
  );
  if (after)
    return (
      text.slice(0, after.start) + entry + "\n\n" + text.slice(after.start)
    );
  return text.trimEnd() + "\n\n" + entry + "\n";
}
const sortKey = (s: string) =>
  s
    .replace(/^[*"“]+/, "")
    .replace(/^(?:A|An|The)\s+/i, "")
    .toLowerCase();
export function reviewMla(
  text: string,
  supplied: MlaSource[],
  standalone = false,
): MlaIssue[] {
  const sources = uniqueMlaSources(supplied);
  const parsed = bibliography(text);
  const entries =
    standalone && !parsed.heading
      ? [...text.matchAll(/[^\r\n]+/g)]
          .filter((m) => m[0].trim())
          .map((m) => ({
            text: m[0],
            start: m.index!,
            end: m.index! + m[0].length,
          }))
      : parsed.entries;
  const issues: MlaIssue[] = [];
  const add = (
    title: string,
    explanation: string,
    original: string,
    start: number,
    replacement?: string,
  ) =>
    issues.push({
      id: `${start}-${title}`,
      title,
      explanation,
      original,
      context:
        original.startsWith("(") &&
        start < (parsed.heading?.start ?? text.length)
          ? text.slice(
              text.lastIndexOf("\n", start) + 1,
              text.indexOf("\n", start) < 0
                ? text.length
                : text.indexOf("\n", start),
            )
          : undefined,
      edit:
        replacement === undefined
          ? undefined
          : { start, end: start + original.length, original, replacement },
    });
  if (parsed.heading && parsed.heading.text.trim() !== "Works Cited")
    add(
      "Use the MLA heading",
      "Label the bibliography Works Cited.",
      parsed.heading.text,
      parsed.heading.start,
      "Works Cited",
    );
  if (!parsed.heading && !standalone)
    add(
      "Add a Works Cited section",
      "Add the sources cited in your writing. You can create an entry in Add citation.",
      "",
      text.length,
    );
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = citationDois(entry.text)[0] || norm(entry.text);
    if (seen.has(key)) {
      add(
        "Duplicate entry",
        "This source already appears in Works Cited. Keep one entry.",
        entry.text,
        entry.start,
        "",
      );
      continue;
    }
    seen.add(key);
    const matches = matchEntry(entry.text, sources);
    if (matches.length !== 1) {
      add(
        "Check source details",
        "Add its DOI or enter its details in Add citation so Proof can compare this entry with a known source.",
        entry.text,
        entry.start,
      );
      continue;
    }
    const source = matches[0];
    if (!source.title || !source.journal || !source.year) {
      add(
        "Complete the source details",
        "Title, journal, or publication year is missing. Complete the source in Add citation before replacing this entry.",
        entry.text,
        entry.start,
      );
      continue;
    }
    const expected = formatMla(source).entry;
    // Curly quotation marks and page-range dashes are acceptable equivalents.
    const comparable = (s: string) =>
      clean(s).replace(/[“”]/g, '"').replace(/[–]/g, "-");
    if (comparable(entry.text) !== comparable(expected))
      add(
        "Review Works Cited formatting",
        "Compare author order, title, journal italics, publication details, and DOI with the source. Apply only after checking the preview.",
        entry.text,
        entry.start,
        expected,
      );
  }
  if (!standalone && entries.length > 1) {
    const sorted = [...entries].sort((a, b) =>
      sortKey(a.text).localeCompare(sortKey(b.text), "en"),
    );
    if (entries.some((e, i) => e.text !== sorted[i].text))
      add(
        "Alphabetize Works Cited",
        "Order entries by author, or title when no author is listed.",
        text.slice(entries[0].start, entries.at(-1)!.end),
        entries[0].start,
        sorted.map((e) => e.text).join("\n\n"),
      );
  }
  if (standalone) return issues;
  const body = text.slice(0, parsed.heading?.start ?? text.length);
  for (const match of body.matchAll(/\(([^()\n]{2,180})\)/g)) {
    const content = match[1];
    if (content.includes(";")) continue;
    const normalized = norm(content);
    const candidates = sources.filter((s) => {
      const key = norm(mlaAuthorKey(s));
      return (
        key &&
        normalized.startsWith(key) &&
        /^[\s,\d.p–-]*$/.test(content.slice(mlaAuthorKey(s).length))
      );
    });
    if (candidates.length > 1) {
      add(
        "Distinguish works by the same author",
        "Include a shortened title so this citation points to one Works Cited entry.",
        match[0],
        match.index!,
      );
      continue;
    }
    if (candidates.length !== 1) {
      if (
        /^[\p{L}][\p{L}\s'.,&-]+\s+(?:pp?\.\s*)?\d+(?:[-–,\s.\dp]+)?$/u.test(
          content,
        )
      )
        add(
          "Check the in-text source",
          "This citation could not be matched to one known source. Check the author names and add its source details before changing it.",
          match[0],
          match.index!,
        );
      continue;
    }
    const source = candidates[0];
    const tail = content.slice(mlaAuthorKey(source).length).trim();
    const dateStyle =
      /^,?\s*((?:19|20)\d{2})(?:,\s*(?:pp?\.\s*)?(\d+(?:[-–]\d+)?))?$/.exec(
        tail,
      );
    if (dateStyle && dateStyle[1] === source.year) {
      const locator = dateStyle[2] || "";
      add(
        "Use an MLA in-text citation",
        "MLA uses the author and a page or other locator when relevant, rather than the publication year. If the final number is a page, keep it. Add a page number yourself when citing a specific passage in a paginated source.",
        match[0],
        match.index!,
        formatMla(source, locator).inText,
      );
    } else if (/^,?\s*pp?\./.test(tail)) {
      add(
        "Remove the page label",
        "In a parenthetical MLA citation, omit p. or pp. before the page number.",
        match[0],
        match.index!,
        formatMla(source, tail.replace(/^,?\s*pp?\.\s*/, "")).inText,
      );
    }
    if (!entries.some((e) => matchEntry(e.text, [source]).length))
      add(
        "Source missing from Works Cited",
        "Add a Works Cited entry for this source using Add citation.",
        match[0],
        match.index!,
      );
  }
  return issues;
}
