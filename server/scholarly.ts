import { clean, resolveDOI } from "./sources.js";
import { readPdfPages } from "./documents.js";
import { remoteFile } from "./remote.js";
import { dois } from "./parse.js";
import { judgeClaim } from "./judge.js";
import type { Claim, Finding, Source } from "../shared/types.js";

async function json(url: string) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Proof/0.3 scholarly-verification",
    },
  });
  if (!r.ok)
    throw new Error(
      `Scholarly verification service returned HTTP ${r.status}. Try again later.`,
    );
  return r.json();
}
export const normalizedTitle = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function matchJournalRecord(record: any, issns: string[]) {
  const b = record?.bibjson;
  const ids = [
    b?.pissn,
    b?.eissn,
    ...(b?.identifier || []).map((i: any) => i.id),
  ];
  const methods: string[] = Array.isArray(b?.editorial?.review_process)
    ? b.editorial.review_process
    : [];
  const peerReview = methods.filter(
    (s) => /peer review/i.test(s) && !/no |without|editorial/i.test(s),
  );
  if (
    !ids.some((id) => issns.includes(id)) ||
    !peerReview.length ||
    !/^https:\/\//.test(b?.editorial?.review_url || "") ||
    !record.id
  )
    return;
  return {
    journalRecord: `https://doaj.org/toc/${encodeURIComponent(issns.find((id) => ids.includes(id))!)}`,
    reviewPolicy: b.editorial.review_url,
    reviewProcess: peerReview.join(", "),
  };
}
const journalCache = new Map<
  string,
  { at: number; value: NonNullable<ReturnType<typeof matchJournalRecord>> }
>();
async function verifyJournal(issns: string[]) {
  for (const issn of issns.filter((i) => /^\d{4}-\d{3}[\dX]$/i.test(i))) {
    const cached = journalCache.get(issn);
    if (cached && Date.now() - cached.at < 3600000) return cached.value;
    const result = await json(
      `https://doaj.org/api/search/journals/${encodeURIComponent("issn:" + issn)}`,
    );
    for (const record of result.results || []) {
      const value = matchJournalRecord(record, issns);
      if (value) {
        if (journalCache.size > 100) journalCache.clear();
        journalCache.set(issn, { at: Date.now(), value });
        return value;
      }
    }
  }
  throw new Error(
    "The journal’s peer-review process could not be confirmed through DOAJ. This source is excluded.",
  );
}
export function extractScholarlyXml(xml: string, doi: string, title: string) {
  const front = /<front\b[^>]*>([\s\S]*?)<\/front>/i.exec(xml)?.[1] || "";
  const ids = [
    ...front.matchAll(
      /<article-id\b[^>]*pub-id-type=["']doi["'][^>]*>([\s\S]*?)<\/article-id>/gi,
    ),
  ].flatMap((m) => dois(clean(m[1])));
  const articleType = /<article\b[^>]*article-type=["']([^"']+)["']/i.exec(
    xml,
  )?.[1];
  if (
    !ids.includes(doi.toLowerCase()) ||
    !normalizedTitle(
      clean(
        /<article-title\b[^>]*>([\s\S]*?)<\/article-title>/i.exec(front)?.[1] ||
          "",
      ),
    ).includes(normalizedTitle(title))
  )
    throw new Error(
      "The full text does not match the article identity. It is excluded.",
    );
  if (
    ![
      "research-article",
      "review-article",
      "systematic-review",
      "meta-analysis",
    ].includes(articleType || "")
  )
    throw new Error(
      "The full text is not identified as a research or review article. It is excluded.",
    );
  if (
    /<(?:related-article|article-version)\b[^>]*(?:retract|correct|preprint)/i.test(
      xml,
    ) ||
    /<article-title[^>]*>\s*(?:correction|retraction|editorial|erratum)/i.test(
      front,
    )
  )
    throw new Error(
      "A publication notice or unsupported article type was found. Check the publisher.",
    );
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml)?.[1];
  if (!body || !/<\/article\s*>\s*$/i.test(xml.trim()))
    throw new Error("The full article body is missing or incomplete.");
  const abstract = [
    ...front.matchAll(/<abstract\b[^>]*>([\s\S]*?)<\/abstract>/gi),
  ]
    .map((m) => m[1])
    .join("\n");
  const back =
    /<back\b[^>]*>([\s\S]*?)<\/back>/i
      .exec(xml)?.[1]
      ?.replace(/<ref-list\b[^>]*>[\s\S]*?<\/ref-list>/gi, "") || "";
  const text = (abstract + "\n" + body + "\n" + back)
    .replace(/<\/(?:p|sec|title|table-wrap|tr|caption)>/gi, "$&\n\n")
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean)
    .join("\n\n");
  if (text.length < 2000 || text.length > 150000)
    throw new Error(
      "The readable article is incomplete or too long for a complete automatic check.",
    );
  return text;
}
export function entirePassages(text: string) {
  // Preserve all content, including short table cells and headings. No 300-paragraph cap.
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += 1600)
    pieces.push(text.slice(at, at + 1600));
  return pieces;
}
const verifiedCache = new Map<string, { at: number; source: Source }>();
export async function resolveScholarly(
  doi: string,
  refresh = false,
): Promise<Source> {
  const key = dois(doi)[0];
  const cached = verifiedCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < 300000)
    return cached.source;
  const source = { ...(await resolveDOI(doi, refresh)) };
  source.scholarly = {
    eligible: false,
    reason: "Not verified yet.",
    checkedAt: new Date().toISOString(),
  };
  try {
    if (
      source.publicationWarning ||
      /^(?:correction|retraction|editorial|erratum|comment|letter|news)\b/i.test(
        source.title,
      )
    )
      throw new Error(
        "A publication notice or unsupported article type was found. This article is excluded.",
      );
    const review = await verifyJournal(source.issns || []);
    Object.assign(source.scholarly, review);
    const work = await json(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(source.doi!)}`,
    );
    if (
      dois(work.doi || "")[0] !== source.doi ||
      !["article", "review"].includes(work.type) ||
      work.is_retracted ||
      work.primary_location?.source?.type !== "journal" ||
      !work.primary_location?.source?.issn?.some((i: string) =>
        (source.issns || []).includes(i),
      )
    )
      throw new Error(
        "The article’s publication record could not be matched to the verified journal.",
      );
    let fullText = "",
      fullTextUrl = "",
      format: "XML" | "PDF" = "XML";
    let fullXml: string | undefined;
    try {
      const found = await json(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent('DOI:"' + source.doi + '"')}&format=json&resultType=core`,
      );
      const hit = found.resultList?.result?.find(
        (r: any) =>
          r.doi?.toLowerCase() === source.doi &&
          r.isOpenAccess === "Y" &&
          /^PMC\d+$/.test(r.pmcid),
      );
      if (hit) {
        fullTextUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${hit.pmcid}/fullTextXML`;
        const xml = await remoteFile(fullTextUrl);
        fullXml = xml.buffer.toString("utf8");
      }
    } catch {
      fullText = "";
    }
    if (fullXml)
      fullText = extractScholarlyXml(fullXml, source.doi!, source.title);
    if (!fullText) {
      // Only use accepted/published journal copies, never submitted preprints.
      const locations = (work.locations || []).filter(
        (l: any) =>
          l.is_oa &&
          ["acceptedVersion", "publishedVersion"].includes(l.version) &&
          /^https:\/\//.test(l.pdf_url || ""),
      );
      for (const location of locations.slice(0, 2)) {
        try {
          const file = await remoteFile(location.pdf_url);
          const pages = await readPdfPages(file.buffer);
          const front = pages
            .slice(0, 3)
            .map((p) => p.text)
            .join("\n");
          if (
            !/\b(?:research article|review article|original research|original article|systematic review|meta-analysis)\b/i.test(
              front,
            ) ||
            !dois(front).includes(source.doi!) ||
            !normalizedTitle(front).includes(normalizedTitle(source.title))
          )
            continue;
          const text = pages.map((p) => p.text).join("\n\n");
          if (
            pages.length < 3 ||
            text.length < 4000 ||
            text.length > 150000 ||
            pages.some((p) => p.text.length < 30) ||
            !/\b(?:references|bibliography|literature cited)\b/i.test(
              pages
                .slice(-3)
                .map((p) => p.text)
                .join("\n"),
            )
          )
            continue;
          fullText = text;
          fullTextUrl = file.url;
          format = "PDF";
          break;
        } catch {
          /* No fallback to an abstract or guessed content. */
        }
      }
    }
    if (!fullText)
      throw new Error(
        "A matching, readable full article could not be retrieved. Abstracts and previews do not qualify.",
      );
    source.passages = entirePassages(fullText);
    source.access = "full_text";
    source.scholarly = {
      ...source.scholarly,
      eligible: true,
      reason:
        "Journal peer-review policy confirmed through DOAJ; matching full article retrieved.",
      fullTextUrl,
      format,
    };
    source.notice =
      "Journal review policy and full-text identity checked. Figures, equations and image-only content still need a human check. Peer review does not guarantee that the article’s conclusions are correct.";
  } catch (e) {
    source.scholarly.reason =
      e instanceof Error ? e.message : "Source verification failed.";
    source.notice = source.scholarly.reason;
    source.passages = [];
    source.access = "unavailable";
  }
  if (verifiedCache.size >= 60)
    verifiedCache.delete(verifiedCache.keys().next().value!);
  verifiedCache.set(key, { at: Date.now(), source });
  return source;
}
export async function judgeScholarlyClaim(
  claim: Claim,
  source: Source,
  _suppliedPassages?: string[],
  judge = judgeClaim,
  progress: (message: string) => void = () => {},
): Promise<Finding> {
  const blocked = (reason: string): Finding => ({
    ...claim,
    sourceId: source.id,
    status: "source_unavailable",
    method: "unverified",
    explanation: reason,
  });
  if (
    !source.scholarly?.eligible ||
    source.access !== "full_text" ||
    !source.passages.length ||
    source.publicationWarning
  )
    return blocked(
      source.scholarly?.reason ||
        "Only verified peer-reviewed journal articles with readable full text can be used.",
    );
  const chunks: string[][] = [];
  for (const passage of source.passages) {
    let chunk = chunks.at(-1);
    if (!chunk || chunk.join("").length + passage.length > 14000) {
      chunk = [];
      chunks.push(chunk);
    }
    chunk.push(passage);
  }
  if (chunks.length > 14)
    return blocked(
      "The article is too long for a complete automatic check. No partial approval was made.",
    );
  const findings: Finding[] = [];
  for (const [index, chunk] of chunks.entries()) {
    progress(
      `Reading full-text section ${index + 1} of ${chunks.length}: ${source.title}`,
    );
    findings.push(await judge(claim, source, chunk));
  }
  const completed = findings.filter((f) => f.method === "Jev").length;
  const fullTextCheck = {
    chunks: chunks.length,
    completed,
    characters: source.passages.join("").length,
  };
  const useful = findings.filter((f) => f.status !== "not_addressed");
  const supported = useful.find((f) => f.status === "supported");
  const incomplete = completed < chunks.length;
  const conflict =
    new Set(useful.map((f) => f.status)).size > 1 ||
    useful.some((f) => f.status === "uncertain");
  const selected =
    useful.find((f) =>
      ["contradicted", "numeric_mismatch", "overstated", "partial"].includes(
        f.status,
      ),
    ) ||
    supported ||
    useful[0] ||
    findings[0];
  // Keep selected verbatim passages for inspection, without repeating whole articles in every sentence result.
  const checkedPassages = [
    ...new Set(findings.flatMap((f) => (f.evidence ? [f.evidence] : []))),
  ];
  if (incomplete || conflict)
    return {
      ...claim,
      sourceId: source.id,
      status: "uncertain",
      method: incomplete ? "unverified" : "Jev",
      explanation: incomplete
        ? "Some parts of the full article could not be checked. This claim remains unverified."
        : "Different parts of the article gave conflicting or uncertain results. Read the passages before using this claim.",
      checkedPassages,
      fullTextCheck,
    };
  return {
    ...selected,
    checkedPassages,
    fullTextCheck,
    fix: undefined,
    numericCorrection: undefined,
    fixKind: undefined,
  };
}
