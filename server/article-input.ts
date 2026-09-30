import { directDoi } from "./source-input.js";
import { remoteFile } from "./remote.js";
import { readPdfPages } from "./documents.js";
import { resolveScholarly } from "./scholarly.js";
import { clean } from "./sources.js";
import { dois } from "./parse.js";
import type { PaperPage } from "../shared/classroom.js";

export function articleMetaDoi(html: string) {
  const candidates = new Set<string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    ))
      attrs[match[1].toLowerCase()] = match[2] ?? match[3];
    if (
      /^(citation_doi|dc\.identifier|prism\.doi)$/i.test(
        attrs.name || attrs.property || "",
      )
    )
      for (const doi of dois(clean(attrs.content || ""))) candidates.add(doi);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}
export async function readArticleInput(
  input: string,
  pdfUrl: string,
  buffer?: Buffer,
) {
  let pages: PaperPage[] = buffer ? await readPdfPages(buffer) : [];
  let doi = directDoi(input);
  const url = /^https:\/\//i.test(input) ? input : "";
  if (!pages.length && pdfUrl)
    pages = await readPdfPages((await remoteFile(pdfUrl)).buffer);
  if (!doi && url) {
    const file = await remoteFile(url);
    if (file.buffer.subarray(0, 1024).toString().includes("%PDF-")) {
      if (!pages.length) pages = await readPdfPages(file.buffer);
    } else doi = articleMetaDoi(file.buffer.toString("utf8"));
  }
  let inferredFromPdf = false;
  if (!doi && pages.length) {
    const front = pages[0].text.split(
      /\b(?:references|bibliography|works cited)\b/i,
    )[0];
    const candidates = dois(front);
    if (candidates.length === 1) {
      doi = candidates[0];
      inferredFromPdf = true;
    }
  }
  if (!doi)
    throw new Error(
      "I could not identify this article reliably. Try its publisher link, or paste the DOI shown on its first page. You can still use the file under Check with my sources.",
    );
  const metadata = await resolveScholarly(doi);
  if (inferredFromPdf) {
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
    if (
      !metadata.title ||
      !norm(
        pages
          .slice(0, 3)
          .map((p) => p.text)
          .join(" "),
      ).includes(norm(metadata.title))
    )
      throw new Error(
        "The article number found in this PDF points to a different title. Paste the publisher link so we do not cite the wrong paper.",
      );
  }
  return { metadata, pages };
}
