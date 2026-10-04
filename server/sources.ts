import {
  providerFetch as fetch,
  openAlexUrl,
  providerContext,
} from "./backend/providers.js";
import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { Source } from "../shared/types.js";
import { dois } from "./parse.js";
const sources = new Map<string, Source>();
const publicationNotices = new Set<string>();
export function recordPublicationNotice(doi: string) {
  publicationNotices.add(doi.toLowerCase());
  for (const source of sources.values())
    if (source.doi?.toLowerCase() === doi.toLowerCase())
      source.publicationWarning = true;
}

export function saveSource(source: Omit<Source, "id" | "retrievedAt">): Source {
  const result = {
    ...source,
    id: randomUUID(),
    retrievedAt: new Date().toISOString(),
  };
  if (sources.size >= 150) sources.delete(sources.keys().next().value!);
  sources.set(result.id, result);
  return result;
}
export function getSource(id: string) {
  return sources.get(id);
}
export function clean(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/(?<=\d)[\u2009\u202f](?=\d{3}\b)/g, ",")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[\s\u2009\u202f]+/g, " ")
    .trim();
}
export function splitPassages(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(clean)
    .filter((s) => s.length > 35);
  return paragraphs
    .flatMap((p) => {
      if (p.length <= 1800) return [p];
      const sentences = p.match(/[^.!?]+(?:[.!?]+|$)/g) || [p];
      const groups: string[] = [];
      let group = "";
      for (const sentence of sentences) {
        if (group.length + sentence.length > 1500 && group) {
          groups.push(group.trim());
          group = "";
        }
        group += sentence;
      }
      if (group.trim()) groups.push(group.trim());
      return groups;
    })
    .slice(0, 300);
}
async function request(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(18000),
    headers: {
      "User-Agent": "Proof/0.1 academic-citation-auditor",
      Accept: "application/json, application/xml, text/xml",
    },
  });
  if (!response.ok)
    throw new Error(
      `Scholarly provider returned HTTP ${response.status}. Try again or upload the paper.`,
    );
  const value = await response.text();
  if (value.length > 8_000_000)
    throw new Error("The source is too large. Upload a smaller document.");
  return value;
}
export function collectParagraphs(xml: string): string[] {
  // Ordered nodes preserve mixed text such as words surrounding italic tags and citations.
  const parsed = new XMLParser({
    preserveOrder: true,
    trimValues: false,
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const flatten = (v: unknown): string =>
    typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map(flatten).join("")
        : v && typeof v === "object"
          ? Object.values(v).map(flatten).join("")
          : "";
  const result: string[] = [];
  const walk = (nodes: unknown, inBody = false) => {
    if (Array.isArray(nodes)) {
      for (const n of nodes) walk(n, inBody);
      return;
    }
    if (!nodes || typeof nodes !== "object") return;
    for (const [tag, children] of Object.entries(nodes)) {
      if (tag === "p" && inBody) {
        const text = clean(flatten(children));
        if (text.length > 35) result.push(text);
      } else walk(children, inBody || tag === "body");
    }
  };
  walk(parsed);
  return result.flatMap((p) => splitPassages(p));
}
export async function resolveDOI(
  input: string,
  refresh = false,
  options: { metadataOnly?: boolean } = {},
): Promise<Source> {
  const doi = dois(input)[0];
  if (!doi)
    throw new Error(
      "Enter a DOI or a doi.org link, such as 10.1136/bmj-2023-075847.",
    );
  const cached = [...sources.values()].find(
    (s) => s.doi === doi && s.provider !== "User upload",
  );
  if (
    cached &&
    !refresh &&
    Date.now() - Date.parse(cached.retrievedAt) < 300_000
  )
    return cached;
  const crossref = JSON.parse(
    await request(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
  ).message;
  if (crossref.DOI && crossref.DOI.toLowerCase() !== doi)
    throw new Error(
      "The registry returned a different DOI. The source identity could not be confirmed.",
    );
  if (crossref.type !== "journal-article")
    throw new Error(
      "This DOI is not registered as a journal article. The first version checks scholarly journal articles.",
    );
  const source: Omit<Source, "id" | "retrievedAt"> = {
    title: clean(crossref.title?.[0] || doi),
    authors: (crossref.author || []).map(
      (a: { family?: string; given?: string; name?: string }) =>
        a.name || `${a.given || ""} ${a.family || ""}`.trim(),
    ),
    authorDetails: (crossref.author || []).map(
      (a: { family?: string; given?: string; name?: string }) => ({
        given: a.given,
        family: a.family,
        name: a.name,
      }),
    ),
    year: String(crossref.published?.["date-parts"]?.[0]?.[0] || ""),
    doi,
    url: `https://doi.org/${doi}`,
    journal: crossref["container-title"]?.[0],
    issns: Array.isArray(crossref.ISSN)
      ? crossref.ISSN.filter((s: unknown) => typeof s === "string")
      : [],
    volume: crossref.volume,
    issue: crossref.issue,
    pages: crossref.page,
    access: crossref.abstract ? "abstract" : "metadata",
    passages: crossref.abstract ? splitPassages(clean(crossref.abstract)) : [],
    provider: "Crossref",
    publicationType: "Journal article",
    publicationWarning: !!(
      publicationNotices.has(doi) ||
      crossref["update-to"]?.length ||
      Object.keys(crossref.relation || {}).some((k) =>
        /retract|correct|update/i.test(k),
      )
    ),
    notice:
      "Journal article metadata does not independently confirm peer review." +
      (crossref["update-to"]?.length ||
      Object.keys(crossref.relation || {}).some((k) =>
        /retract|correct|update/i.test(k),
      )
        ? " Crossref lists an update, correction, or related notice. Check the publisher record before relying on this article."
        : ""),
  };
  if (options.metadataOnly)
    return {
      ...source,
      id: randomUUID(),
      retrievedAt: new Date().toISOString(),
    };
  try {
    const result = JSON.parse(
      await request(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent('DOI:"' + doi + '"')}&format=json&resultType=core`,
      ),
    ).resultList?.result?.find(
      (r: { doi?: string }) => r.doi?.toLowerCase() === doi,
    );
    if (result?.abstractText) {
      source.passages = splitPassages(
        result.abstractText.replace(/<h4>/g, "\n\n").replace(/<\/h4>/g, ": "),
      );
      source.access = "abstract";
      source.provider = "Crossref · Europe PMC";
    }
    if (result?.pmcid && result.isOpenAccess === "Y") {
      try {
        const body = collectParagraphs(
          await request(
            `https://www.ebi.ac.uk/europepmc/webservices/rest/${result.pmcid}/fullTextXML`,
          ),
        );
        if (body.length) {
          source.passages = [...source.passages, ...body];
          source.access = "full_text";
        }
      } catch {
        source.notice +=
          " Full-text retrieval failed; only the available abstract was used.";
      }
    }
  } catch {
    source.notice +=
      " Europe PMC could not be reached. Only Crossref content is available.";
  }
  if (source.access !== "full_text") {
    try {
      const work = JSON.parse(
        await request(
          openAlexUrl(
            `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
          ),
        ),
      );
      if (dois(work.doi || "")[0] !== doi)
        throw new Error("Source identity mismatch.");
      if (!source.passages.length && work.abstract_inverted_index) {
        const words: string[] = [];
        for (const [word, positions] of Object.entries(
          work.abstract_inverted_index,
        ))
          if (Array.isArray(positions))
            for (const position of positions)
              if (
                Number.isInteger(position) &&
                position >= 0 &&
                position < 20000
              )
                words[position] = word;
        const passages = splitPassages(words.join(" "));
        if (passages.length) {
          source.passages = passages;
          source.access = "abstract";
          source.provider += " · OpenAlex";
        }
      }
      const locations = [
        work.best_oa_location,
        ...(work.locations || []),
        work.primary_location,
      ].filter(Boolean);
      const urls = [
        ...new Set<string>(
          [
            ...locations
              .filter((location: any) => location.is_oa)
              .map((location: any) => location.pdf_url),
            ...locations.map((location: any) => location.landing_page_url),
          ].filter((url): url is string => typeof url === "string"),
        ),
      ];
      if (urls.length) {
        const { retrieveNamedReference } =
          await import("./backend/reference-retrieval.js");
        const retrieved = await retrieveNamedReference(
          {
            ...source,
            containerTitle: source.journal,
            url: undefined,
          },
          undefined,
          { urls },
        );
        if (
          retrieved.source.access === "full_text" ||
          retrieved.source.access === "partial_text" ||
          !source.passages.length
        ) {
          source.passages = retrieved.source.passages;
          source.access = retrieved.source.access;
          source.url = retrieved.source.url;
          source.provider += " · Publisher or repository";
        }
      }
    } catch (error) {
      // Preserve successful abstract retrieval when a later PDF or provider fails.
      if (providerContext.getStore()?.signal.aborted) throw error;
    }
  }
  if (source.access === "abstract")
    source.notice +=
      " Could not access the full article. Abstract available for verification.";
  return saveSource(source);
}
export async function resolveReference(
  reference: string,
): Promise<Source | undefined> {
  const doi = dois(reference)[0];
  if (doi) return resolveDOI(doi);
  // Only resolve a bibliographic entry with an explicit title, never an author-only guess.
  const title = reference.match(/["“]([^"”]{15,})["”]/)?.[1];
  const year = reference.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const surname = reference.split(",")[0].trim().toLowerCase();
  if (!title || !year) return;
  const list =
    JSON.parse(
      await request(
        `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=3&filter=type:journal-article`,
      ),
    ).message?.items || [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = list.filter(
    (w: any) =>
      norm(w.title?.[0] || "") === norm(title) &&
      String(w.published?.["date-parts"]?.[0]?.[0]) === year &&
      w.author?.some((a: any) => a.family?.toLowerCase() === surname),
  );
  if (exact.length === 1) return resolveDOI(exact[0].DOI);
}
