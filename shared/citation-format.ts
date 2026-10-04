import CSL from "citeproc";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import manifest from "../server/backend/styles/manifest.json";
import assets from "./citation-style-assets.json";
import {
  citationProfiles,
  type CitationProfileId,
} from "./citation-profiles.js";

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
  /** A recorded date of access, never the current date by default. */
  accessed?: string;
  shortTitle?: string;
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

const styleXml = assets["modern-language-association.csl"];
const localeXml = assets["locales-en-US.xml"];
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

export function verifiedDate(value: string): number[] | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const parts = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() + 1 === parts[1] &&
    date.getUTCDate() === parts[2]
  )
    return parts;
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
    shortTitle: "title-short",
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
  if (metadata.accessed) {
    const date = verifiedDate(metadata.accessed);
    if (date) item.accessed = { "date-parts": [date] };
    else
      warnings.push(
        "Access date is invalid and was omitted. Confirm the recorded date.",
      );
  }
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

export interface CitationReference {
  id: string;
  metadata: ReferenceMetadata;
}
/** Call only with confirmed metadata. An upload ID alone is not a work identity. */
export function citationWorkIdentity(
  metadata: ReferenceMetadata,
): string | undefined {
  const doi = metadata.doi
    ?.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  if (doi && /^10\.\d{4,9}\/\S+$/i.test(doi)) return `doi:${doi.toLowerCase()}`;
  const normalize = (value: unknown) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  if (!metadata.title || !metadata.year) return;
  const authorKeys = (metadata.authors ?? []).map((author) => {
    const structured = name(author);
    return normalize(
      structured?.literal ??
        [structured?.given, structured?.family].filter(Boolean).join(" "),
    );
  });
  return `metadata:${[metadata.type, metadata.title, authorKeys.join("/"), metadata.year, metadata.edition, metadata.containerTitle].map(normalize).join(":")}`;
}
export interface VerifiedLocator {
  kind: "page" | "paragraph" | "section" | "line";
  value: string;
  verified: true;
}
export interface CitationFormatOptions {
  id?: string;
  original?: string;
  profile?: CitationProfileId;
  overrides?: CitationOverrides;
  distinguishTitle?: boolean;
}

function classroomStyle() {
  // Change CSL rules, not the rendered bibliography. Both output formats use
  // these same rules and the original pinned style remains unchanged.
  const document = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: false,
    parseTagValue: false,
  }).parse(styleXml);
  type XmlNode = { [key: string]: XmlNode[] | Record<string, string> };
  const style = document.find((node: XmlNode) => node.style);
  style[":@"]["@page-range-format"] = "expanded";
  function walk(nodes: XmlNode[], visit: (node: XmlNode) => void) {
    for (const node of nodes) {
      visit(node);
      for (const [key, children] of Object.entries(node)) {
        if (key !== ":@" && Array.isArray(children)) walk(children, visit);
      }
    }
  }
  const author = style.style.find(
    (node: XmlNode) =>
      node.macro &&
      (node[":@"] as Record<string, string>)["@name"] === "author",
  );
  walk(author.macro, (node) => {
    if (!node.name) return;
    const attributes = node[":@"] as Record<string, string>;
    attributes["@name-as-sort-order"] = "all";
    attributes["@delimiter-precedes-last"] = "never";
    attributes["@delimiter-precedes-et-al"] = "never";
  });
  const volume = style.style.find(
    (node: XmlNode) =>
      node.macro &&
      (node[":@"] as Record<string, string>)["@name"] === "label-volume",
  );
  walk(volume.macro, (node) => {
    if (node.label)
      (node[":@"] as Record<string, string>)["@text-case"] = "capitalize-first";
  });
  const accessed = style.style.find(
    (node: XmlNode) =>
      node.macro &&
      (node[":@"] as Record<string, string>)["@name"] ===
        "supplemental-date-access",
  );
  walk(accessed.macro, (node) => {
    if (!node.if) return;
    const attributes = node[":@"] as Record<string, string>;
    attributes["@variable"] = "accessed";
    delete attributes["@match"];
  });
  return new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    suppressBooleanAttributes: false,
  }).build(document) as string;
}
const classroomStyleXml = classroomStyle();

function withTitleDisambiguation(style: string) {
  const parserOptions = {
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: false,
    parseTagValue: false,
  };
  const document = new XMLParser(parserOptions).parse(style);
  const root = document.find((node: Record<string, unknown>) => node.style);
  const author = root.style.find(
    (node: Record<string, any>) =>
      node.macro && node[":@"]["@name"] === "author-short",
  );
  const condition = author.macro
    .find((node: Record<string, any>) => node.group)
    .group.find((node: Record<string, any>) => node.choose)
    .choose.find((node: Record<string, any>) => node.if);
  delete condition[":@"]["@disambiguate"];
  condition[":@"]["@variable"] = "title";
  return new XMLBuilder({
    ...parserOptions,
    suppressBooleanAttributes: false,
  }).build(document) as string;
}

function processorFor(
  references: CitationReference[],
  options: CitationFormatOptions,
) {
  const profile = citationProfiles[options.profile ?? "mla9"];
  const overrides = options.overrides ?? {};
  const converted = references.map(({ id, metadata }) => {
    const effective = {
      ...metadata,
      ...(id === (options.id ?? "reference") ? overrides.metadata : undefined),
    };
    const result = toCslItem(effective, id);
    const outputItem = structuredClone(result.item);
    if (overrides.includeDoi === false) delete outputItem.DOI;
    if (overrides.includeUrl === false) delete outputItem.URL;
    if (
      profile.id === "classroom" &&
      outputItem.author &&
      outputItem.author.length > 2
    ) {
      outputItem.author = outputItem.author.map(
        ({ given: _given, ...author }) => author,
      );
    }
    if (profile.id === "classroom" && !result.item.accessed)
      result.warnings.push(
        "The classroom profile requires the recorded access date. No date was invented.",
      );
    return { ...result, outputItem };
  });
  const items = new Map(
    converted.map((value) => [value.item.id, value.outputItem]),
  );
  if (items.size !== references.length)
    throw new Error("Citation reference identities must be unique.");
  const locale = localeXml.replace(
    'punctuation-in-quote="true"',
    `punctuation-in-quote="${overrides.punctuationInQuote ?? profile.punctuationInQuote}"`,
  );
  const processor = new CSL.Engine(
    {
      retrieveLocale: () => locale,
      retrieveItem: (id) => {
        const item = items.get(id);
        if (!item) throw new Error("Unknown citation reference.");
        return item;
      },
    },
    options.distinguishTitle
      ? withTitleDisambiguation(
          profile.id === "classroom" ? classroomStyleXml : styleXml,
        )
      : profile.id === "classroom"
        ? classroomStyleXml
        : styleXml,
    "en-US",
  );
  processor.updateItems(references.map((reference) => reference.id));
  return { processor, converted, profile, overrides };
}

export function formatReference(
  metadata: ReferenceMetadata,
  options: CitationFormatOptions = {},
) {
  const { processor, converted, profile, overrides } = processorFor(
    [{ id: options.id ?? "reference", metadata }],
    options,
  );
  const { item, missingMetadata, warnings } = converted[0];
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
    profile: { id: profile.id, version: profile.version },
    style: {
      id: "modern-language-association",
      edition: 9,
      ...manifest["modern-language-association.csl"],
    },
    overrides,
  };
}

/** This formats confirmed metadata. The caller must establish evidence support. */
export function formatCitation(
  metadata: ReferenceMetadata,
  options: CitationFormatOptions & {
    locator?: VerifiedLocator;
    narrative?: boolean;
    references?: CitationReference[];
    distinguishTitle?: boolean;
  } = {},
) {
  const id = options.id ?? "reference";
  const references = [
    { id, metadata },
    ...(options.references ?? []).filter((reference) => reference.id !== id),
  ];
  const { processor, profile } = processorFor(references, options);
  const result = formatReference(metadata, options);
  const warnings = [...result.warnings];
  const suppliedLocator = options.locator;
  const validLocator =
    suppliedLocator &&
    suppliedLocator.verified === true &&
    ["page", "paragraph", "section", "line"].includes(suppliedLocator.kind) &&
    suppliedLocator.value.trim().length > 0 &&
    suppliedLocator.value.length <= 180 &&
    !/[\r\n]/.test(suppliedLocator.value) &&
    (suppliedLocator.kind !== "page" ||
      /^\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*$/.test(
        suppliedLocator.value.trim(),
      ));
  if (suppliedLocator && !validLocator)
    warnings.push("An unverified or invalid locator was omitted.");
  if (
    profile.requirePageLocator &&
    (!validLocator || suppliedLocator?.kind !== "page")
  ) {
    warnings.push(
      "This profile requires a verified printed page locator. Review before applying.",
    );
  }
  const citationItem: Record<string, unknown> = { id };
  if (validLocator) {
    citationItem.locator = suppliedLocator!.value.trim();
    citationItem.label = suppliedLocator!.kind;
  }
  if (options.narrative) citationItem["suppress-author"] = true;
  function render(format: "text" | "html") {
    processor.setOutputFormat(format);
    const rendered = processor.makeCitationCluster([citationItem]);
    // citeproc uses this internal marker when a narrative author already names
    // an unpaginated source. It is never part of a document citation.
    return rendered === "[NO_PRINTED_FORM]" ? "" : rendered;
  }
  return {
    ...result,
    warnings,
    inText: render("text"),
    citationHtml: render("html"),
    locator: validLocator ? suppliedLocator : undefined,
  };
}

export function formatBibliography(
  references: CitationReference[],
  options: Omit<CitationFormatOptions, "id" | "original"> = {},
) {
  if (!references.length)
    return {
      entries: [],
      text: "",
      html: "",
      profile: { id: options.profile ?? "mla9", version: 1 },
    };
  const { processor, converted, profile } = processorFor(references, options);
  processor.setOutputFormat("text");
  const plain = processor.makeBibliography();
  processor.setOutputFormat("html");
  const rich = processor.makeBibliography();
  const entries = plain
    ? plain[0].entry_ids.map(([id], index) => {
        const source = converted.find((value) => value.item.id === id)!;
        return {
          id,
          text: plain[1][index].trim(),
          html: rich ? rich[1][index].trim() : "",
          csl: source.item,
          warnings: source.warnings,
          missingMetadata: source.missingMetadata,
        };
      })
    : [];
  return {
    entries,
    text: entries.map((entry) => entry.text).join("\n\n"),
    html: entries.map((entry) => entry.html).join("\n"),
    profile: { id: profile.id, version: profile.version },
  };
}

/** Compatibility adapters may need markdown, but all typography comes from CSL. */
export function citationHtmlToMarkdown(html: string) {
  return html
    .replace(/<i>(.*?)<\/i>/g, "*$1*")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[“”]/g, '"')
    .trim();
}
