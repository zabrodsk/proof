import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import manifest from "./styles/manifest.json";

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

/** Fields must come from the imported reference, confirmed metadata, or a user override. */
export interface ReferenceMetadata {
  type?: string;
  title?: string;
  authors?: (string | CslName)[];
  editors?: (string | CslName)[];
  translators?: (string | CslName)[];
  year?: string | number;
  edition?: string | number;
  publisher?: string;
  publisherPlace?: string;
  containerTitle?: string;
  volume?: string | number;
  issue?: string | number;
  pages?: string;
  doi?: string;
  isbn?: string;
  url?: string;
  language?: string;
}

export interface CitationOverrides {
  metadata?: Partial<ReferenceMetadata>;
  punctuationInQuote?: boolean;
  includeDoi?: boolean;
  includeUrl?: boolean;
}

export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  issued?: { "date-parts": number[][] };
  [key: string]: unknown;
}

const styleXml = readFileSync(
  new URL("./styles/modern-language-association.csl", import.meta.url),
  "utf8",
);
const localeXml = readFileSync(
  new URL("./styles/locales-en-US.xml", import.meta.url),
  "utf8",
);
const supportedTypes = new Set([
  "book",
  "chapter",
  "article-journal",
  "article-magazine",
  "article-newspaper",
  "paper-conference",
  "thesis",
  "report",
  "webpage",
  "manuscript",
  "document",
]);
interface Processor {
  updateItems(ids: string[]): void;
  setOutputFormat(format: "text" | "html"): void;
  makeBibliography(): [unknown, string[]] | false;
}
const CSL = createRequire(import.meta.url)("citeproc") as {
  Engine: new (
    system: {
      retrieveLocale: (language: string) => string;
      retrieveItem: (id: string) => CslItem;
    },
    style: string,
    language: string,
  ) => Processor;
};

function clean(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim() || undefined
    : undefined;
}
function name(value: string | CslName): CslName | undefined {
  if (typeof value !== "string") {
    const result = Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, val]) =>
            ["family", "given", "literal"].includes(key) && clean(val),
        )
        .map(([key, val]) => [key, clean(val)]),
    );
    return Object.keys(result).length ? result : undefined;
  }
  const text = value.trim();
  if (!text) return undefined;
  // An explicit inverted name can be split without guessing family-name boundaries.
  const comma = text.indexOf(",");
  if (
    comma > 0 &&
    text.indexOf(",", comma + 1) === -1 &&
    !/\band\b|\bet al\b/i.test(text)
  ) {
    return {
      family: text.slice(0, comma).trim(),
      given: text.slice(comma + 1).trim() || undefined,
    };
  }
  return { literal: text };
}
function names(values: (string | CslName)[] | undefined) {
  return values?.map(name).filter((value): value is CslName => Boolean(value));
}

export function toCslItem(metadata: ReferenceMetadata, id = "reference") {
  const missingMetadata: string[] = [];
  const warnings: string[] = [];
  const type = supportedTypes.has(metadata.type || "")
    ? metadata.type!
    : "document";
  if (type === "document")
    warnings.push("Source type is unknown; formatting needs review.");
  const item: CslItem = { id, type };
  const mappings = {
    title: "title",
    publisher: "publisher",
    publisherPlace: "publisher-place",
    containerTitle: "container-title",
    volume: "volume",
    issue: "issue",
    pages: "page",
    doi: "DOI",
    isbn: "ISBN",
    url: "URL",
    language: "language",
  } as const;
  for (const [input, output] of Object.entries(mappings)) {
    const value = clean(metadata[input as keyof typeof mappings]);
    if (value) item[output] = value;
  }
  for (const [input, output] of [
    ["authors", "author"],
    ["editors", "editor"],
    ["translators", "translator"],
  ] as const) {
    const value = names(metadata[input]);
    if (value?.length) item[output] = value;
  }
  const year = clean(metadata.year);
  if (year && /^\d{4}$/.test(year))
    item.issued = { "date-parts": [[Number(year)]] };
  else if (year)
    warnings.push("Publication year could not be represented as a CSL date.");
  const edition = clean(metadata.edition);
  if (edition)
    item.edition = edition.replace(/^(\d+)(?:st|nd|rd|th)?\s+ed\.?$/i, "$1");
  if (!item.title) missingMetadata.push("title");
  if (!item.author?.length) missingMetadata.push("authors");
  if (!item.issued) missingMetadata.push("year");
  if (type === "book" || type === "chapter") {
    if (!item.publisher) missingMetadata.push("publisher");
  }
  if (type === "article-journal" || type === "chapter") {
    if (!item["container-title"]) missingMetadata.push("containerTitle");
  }
  if (missingMetadata.length)
    warnings.push(
      "Citation is provisional because metadata is missing. No missing fields were invented.",
    );
  if (
    metadata.authors?.some(
      (value) =>
        typeof value === "string" &&
        (/\band\b|\bet al\b/i.test(value) || !value.includes(",")),
    )
  ) {
    warnings.push(
      "Unstructured author names were preserved literally; confirm name order and author boundaries.",
    );
  }
  return { item, missingMetadata, warnings };
}

export function formatReference(
  metadata: ReferenceMetadata,
  options: {
    id?: string;
    original?: string;
    overrides?: CitationOverrides;
  } = {},
) {
  const overrides = options.overrides || {};
  const effective = { ...metadata, ...overrides.metadata };
  const { item, missingMetadata, warnings } = toCslItem(effective, options.id);
  // Formatting choices affect output only. The complete CSL metadata remains available.
  const outputItem = { ...item };
  if (overrides.includeDoi === false) delete outputItem.DOI;
  if (overrides.includeUrl === false) delete outputItem.URL;
  const locale =
    overrides.punctuationInQuote === undefined
      ? localeXml
      : localeXml.replace(
          'punctuation-in-quote="true"',
          `punctuation-in-quote="${overrides.punctuationInQuote}"`,
        );
  const processor = new CSL.Engine(
    { retrieveLocale: () => locale, retrieveItem: () => outputItem },
    styleXml,
    "en-US",
  );
  processor.updateItems([item.id]);
  function render(format: "text" | "html") {
    processor.setOutputFormat(format);
    const bibliography = processor.makeBibliography();
    return bibliography ? bibliography[1].join("").trim() : "";
  }
  return {
    original: options.original,
    text: render("text"),
    html: render("html"),
    csl: item,
    missingMetadata,
    warnings,
    style: {
      id: "modern-language-association",
      edition: 9,
      ...manifest["modern-language-association.csl"],
    },
    overrides,
  };
}
