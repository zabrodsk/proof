import { HttpError } from "./config.js";
import { randomUUID } from "node:crypto";
import type { Source } from "../../shared/types.js";
import { normalize } from "./references.js";
import { exaSearch } from "./providers.js";
import { remoteFile } from "../remote.js";
import { extractFile } from "./extraction.js";
import { pageText } from "../evidence.js";
import { entirePassages } from "../scholarly.js";

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
  },
  deps = { search: exaSearch, download: remoteFile, extract: extractFile },
) {
  if (!parsed.title)
    throw new Error(
      "This reference has no title to identify the original work.",
    );
  const hits = await deps.search(`"${parsed.title}"`, 6, { scope: "public" });
  const urls = [
    ...new Set([
      ...(parsed.url && originalReferenceUrl(parsed.url) ? [parsed.url] : []),
      ...hits.map((h: { url: string }) => h.url).filter(originalReferenceUrl),
    ]),
  ].slice(0, 3);
  const failures: string[] = [];
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
        const pdfUrl = field("citation_pdf_url");
        repositoryPage =
          !!pdfUrl || /scholarship\.|\/vol\d+\/iss\d+\//.test(file.url);
        articleHtml = /<article\b|itemprop=["\']articleBody["\']/i.test(raw);
        const text = pageText(raw);
        if (!referenceTextIdentity(text, parsed, declaredTitle))
          throw new Error(
            "The retrieved page does not identify the selected reference.",
          );
        if (pdfUrl) {
          const target = new URL(pdfUrl.replace(/&amp;/g, "&"), file.url).href;
          if (originalReferenceUrl(target)) {
            file = await deps.download(target);
            if (!originalReferenceUrl(file.url))
              throw new Error(
                "The original PDF redirected outside its publisher or repository.",
              );
            isPdf = file.buffer.subarray(0, 1024).toString().includes("%PDF-");
            raw = file.buffer.toString("utf8");
          }
        }
      }
      const extracted = isPdf
        ? await deps.extract(file.buffer, "reference.pdf")
        : undefined;
      if (
        extracted &&
        (extracted.coverage.unreadablePages.length ||
          extracted.coverage.omittedPages.length)
      )
        throw new Error("The original PDF has unreadable or omitted pages.");
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
      // A repository abstract identifies the work but cannot establish evidence.
      if (!isPdf && (repositoryPage || !articleHtml))
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
        url: file.url,
        access: "full_text",
        evidencePolicy: "public",
        passages: entirePassages(text),
        provider: "Selected reference publisher or repository",
        retrievedAt: new Date().toISOString(),
        notice:
          "The exact selected title was found at its publisher or institutional repository. Bibliography metadata and printed page numbers still need comparison with the original.",
      };
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
  throw new Error(
    failures.at(-1) ||
      "No readable original was found at the publisher or an institutional repository. Upload the article PDF to check its evidence.",
  );
}
