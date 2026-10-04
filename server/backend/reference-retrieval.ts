import { HttpError } from "./config.js";
import { randomUUID } from "node:crypto";
import type { Source } from "../../shared/types.js";
import { normalize } from "./references.js";
import { exaSearch } from "./providers.js";
import { remoteFile } from "../remote.js";
import { extractFile } from "./extraction.js";
import { pageText } from "../evidence.js";
import { entirePassages } from "../scholarly.js";
import { dois } from "../parse.js";

const publishers = [
  "abajournal.com",
  "wmlawreview.org",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "tandfonline.com",
  "oup.com",
  "cambridge.org",
  "sagepub.com",
  "science.org",
  "nature.com",
  "pmc.ncbi.nlm.nih.gov",
  "arxiv.org",
  "zenodo.org",
  "hal.science",
  "osf.io",
];
export function originalReferenceUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (/(?:\.edu|\.ac\.[a-z]{2}|\.gov)$/.test(u.hostname) ||
        publishers.some(
          (d) => u.hostname === d || u.hostname.endsWith("." + d),
        ))
    );
  } catch {
    return false;
  }
}
export function referenceTextIdentity(
  text: string,
  parsed: { title?: string; year?: string; containerTitle?: string },
  declaredTitle?: string,
) {
  if (!parsed.title) return false;
  if (declaredTitle && normalize(declaredTitle) !== normalize(parsed.title))
    return false;
  const header = normalize(text.slice(0, 12000));
  return (
    header.includes(normalize(parsed.title)) &&
    (!parsed.year ||
      header.includes(parsed.year) ||
      (!!parsed.containerTitle &&
        header.includes(normalize(parsed.containerTitle))))
  );
}
export async function retrieveNamedReference(
  parsed: {
    title?: string;
    authors?: string[];
    authorDetails?: any[];
    year?: string;
    containerTitle?: string;
    url?: string;
    doi?: string;
  },
  deps = { search: exaSearch, download: remoteFile, extract: extractFile },
  options: { urls?: string[] } = {},
) {
  if (!parsed.title)
    throw new Error(
      "This reference has no title to identify the original work.",
    );
  const queries = [
    ...new Set([
      ...(parsed.doi ? [parsed.doi] : []),
      `"${parsed.title}"`,
      `"${parsed.title}" ${parsed.authorDetails?.[0]?.family || parsed.authors?.[0] || ""}`.trim(),
      [
        parsed.title,
        ...(parsed.authors || []),
        parsed.year,
        parsed.containerTitle,
      ]
        .filter(Boolean)
        .join(" "),
    ]),
  ];
  const hits: { url: string }[] = [];
  const failures: string[] = [];
  if (!options.urls)
    for (const query of queries) {
      try {
        hits.push(...(await deps.search(query, 6, { scope: "public" })));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        failures.push((error as Error).message);
      }
      if (hits.some((hit) => originalReferenceUrl(hit.url))) break;
    }
  const urls = [
    ...new Set([
      ...(parsed.url && originalReferenceUrl(parsed.url) ? [parsed.url] : []),
      ...(options.urls || []).filter(originalReferenceUrl),
      ...hits.map((h: { url: string }) => h.url).filter(originalReferenceUrl),
    ]),
  ].slice(0, 6);
  let fallback: Source | undefined;
  for (const url of urls) {
    try {
      let file = await deps.download(url);
      if (!originalReferenceUrl(file.url))
        throw new Error(
          "The work redirected outside its publisher or institutional repository.",
        );
      let repositoryPage = false;
      let articleHtml = false;
      let isPdf = file.buffer.subarray(0, 1024).toString().includes("%PDF-");
      let raw = file.buffer.toString("utf8");
      let declaredTitle: string | undefined;
      if (!isPdf) {
        const metas = [...raw.matchAll(/<meta\b[^>]*>/gi)];
        const field = (name: string) =>
          metas
            .map((m) => m[0])
            .find((m) =>
              new RegExp(`(?:name|property)=["']${name}["']`, "i").test(m),
            )
            ?.match(/content=(["'])(.*?)\1/i)?.[2];
        declaredTitle = field("citation_title");
        if (declaredTitle) declaredTitle = pageText(declaredTitle);
        const declaredDoi = dois(
          field("citation_doi") || field("dc.identifier") || "",
        )[0];
        if (parsed.doi && declaredDoi && dois(parsed.doi)[0] !== declaredDoi)
          throw new Error(
            "The retrieved page identifies a different DOI from the selected reference.",
          );
        const pdfUrl = field("citation_pdf_url");
        repositoryPage = /scholarship\.|\/vol\d+\/iss\d+\//.test(file.url);
        articleHtml = /<article\b|itemprop=["\']articleBody["\']/i.test(raw);
        const text = pageText(raw);
        if (!referenceTextIdentity(text, parsed, declaredTitle))
          throw new Error(
            "The retrieved page does not identify the selected reference.",
          );
        // Only explicitly marked article abstracts become evidence. A generic
        // description or an index page mentioning the title is metadata.
        const abstractHtml =
          /<(?:section|div)\b[^>]*(?:id|class)=["'][^"']*\babstract\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/i.exec(
            raw,
          )?.[1];
        const abstract = abstractHtml
          ? pageText(
              abstractHtml.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ""),
            )
          : field("citation_abstract") || field("dc.description");
        if (abstract && pageText(abstract).length >= 40)
          fallback = {
            id: randomUUID(),
            title: parsed.title,
            authors: parsed.authors || [],
            authorDetails: parsed.authorDetails,
            year: parsed.year || "",
            doi: parsed.doi,
            journal: parsed.containerTitle,
            url: file.url,
            access: "abstract",
            evidencePolicy: "public",
            passages: entirePassages(pageText(abstract)),
            provider: "Selected reference publisher or repository",
            retrievedAt: new Date().toISOString(),
            notice:
              "Could not access the full article. Abstract available and used for verification.",
          };
        if (pdfUrl) {
          const target = new URL(pdfUrl.replace(/&amp;/g, "&"), file.url).href;
          if (originalReferenceUrl(target)) {
            const pdf = await deps.download(target).catch((error) => {
              if (error instanceof HttpError) throw error;
              failures.push((error as Error).message);
              return undefined;
            });
            if (pdf && !originalReferenceUrl(pdf.url))
              throw new Error(
                "The original PDF redirected outside its publisher or repository.",
              );
            if (pdf?.buffer.subarray(0, 1024).toString().includes("%PDF-")) {
              file = pdf;
              isPdf = true;
              raw = file.buffer.toString("utf8");
            }
          }
        }
      }
      const extracted = isPdf
        ? await deps.extract(file.buffer, "reference.pdf")
        : undefined;
      const incomplete =
        !!extracted &&
        !!(
          extracted.coverage.unreadablePages.length ||
          extracted.coverage.omittedPages.length
        );
      const text = extracted
        ? extracted.pages.map((p) => p.text).join("\n\n")
        : pageText(raw);
      if (
        !referenceTextIdentity(text, parsed, declaredTitle) ||
        text.length < 1000
      )
        throw new Error(
          "Only a preview, login page, or a different work was available.",
        );
      // Article wrappers also occur around abstract-only pages. Require a
      // substantive body beyond an explicitly marked abstract.
      if (
        !isPdf &&
        (repositoryPage ||
          !articleHtml ||
          (fallback &&
            !/(?:id|class)=["'][^"']*(?:full[-_ ]?text|article[-_ ]?body|methods|results)[^"']*["']|itemprop=["']articleBody["']/i.test(
              raw,
            )))
      )
        throw new Error(
          "The page identifies the work, but a complete article body could not be read.",
        );
      const header = text.slice(0, 12000).replace(/\s+/g, " ");
      const actualAuthors = (parsed.authorDetails || []).map((author: any) => {
        if (!author.given || !author.family) return author;
        const escaped = author.given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const found = new RegExp(escaped + "\\s+([\\p{L}'’-]+)", "u").exec(
          header,
        );
        return found ? { ...author, family: found[1] } : author;
      });
      const identityWarnings = actualAuthors.flatMap((a: any, i: number) =>
        a.family && a.family !== parsed.authorDetails?.[i]?.family
          ? [
              `The uploaded reference names ${parsed.authorDetails?.[i]?.family}; the original source names ${a.family}. Review the author spelling.`,
            ]
          : [],
      );
      const source: Source = {
        id: randomUUID(),
        title: parsed.title,
        authors: actualAuthors.length
          ? actualAuthors.map((a: any) =>
              a.given && a.family ? `${a.given} ${a.family}` : a.literal,
            )
          : parsed.authors || [],
        authorDetails: actualAuthors,
        year: parsed.year || "",
        journal: parsed.containerTitle,
        doi: parsed.doi,
        url: file.url,
        access: incomplete ? "partial_text" : "full_text",
        evidencePolicy: "public",
        passages: entirePassages(text),
        provider: "Selected reference publisher or repository",
        retrievedAt: new Date().toISOString(),
        notice:
          "The exact selected title was found at its publisher or institutional repository. Bibliography metadata and printed page numbers still need comparison with the original.",
      };
      if (incomplete) {
        fallback = {
          ...source,
          notice:
            "Partial source text available. Some article pages could not be read.",
        };
        continue;
      }
      return {
        source,
        identityWarnings,
        file: isPdf ? file : undefined,
        warnings: failures,
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      failures.push((e as Error).message);
    }
  }
  if (fallback)
    return {
      source: fallback,
      identityWarnings: [],
      file: undefined,
      warnings: failures,
    };
  throw new Error(
    failures.at(-1) ||
      "No readable original was found at the publisher or an institutional repository. Upload the article PDF to check its evidence.",
  );
}
