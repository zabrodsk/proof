import {
  providerFetch as fetch,
  openAlexUrl,
  providerContext,
} from "./backend/providers.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { selectClaims } from "./claims.js";
import { resolveDOI, clean, recordPublicationNotice } from "./sources.js";
import { resolveScholarly, judgeScholarlyClaim } from "./scholarly.js";
import { withUsage } from "./usage.js";
import type { SearchCandidate, SearchReport } from "../shared/discovery.js";

export async function discoverSources(
  claim: string,
  query = claim,
  progress: (s: string) => void = () => {},
): Promise<SearchReport> {
  progress("Searching peer-reviewed journals with open full text");
  const r = await fetch(
    openAlexUrl(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=type:article|review,primary_location.source.is_in_doaj:true,open_access.is_oa:true&per_page=12`,
    ),
    {
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "Proof/0.2 academic-source-discovery",
        Accept: "application/json",
      },
    },
  );
  if (!r.ok)
    throw new Error(
      `Scholarly search returned HTTP ${r.status}. Try a shorter search phrase.`,
    );
  const raw = await r.json();
  const records = (raw.results || [])
    .filter((w: any) => typeof w.doi === "string" && !w.is_retracted)
    .map((w: any) => ({
      DOI: w.doi.replace(/^https:\/\/doi.org\//, ""),
      title: [w.title],
      type: "journal-article",
    }));
  const candidates: SearchCandidate[] = [];
  const notices: string[] = [];
  const expanded: any[] = [];
  for (const record of records) {
    const noticesFor =
      record["update-to"]?.filter((u: any) =>
        /correction|retraction|withdrawal/i.test(u.type || ""),
      ) || [];
    if (noticesFor.length) {
      notices.push(
        `Search returned a ${noticesFor[0].type} notice (${record.DOI}). The original article is checked separately; read the notice before relying on its results.`,
      );
      for (const update of noticesFor)
        if (typeof update.DOI === "string")
          expanded.push({
            DOI: update.DOI,
            title: record.title,
            type: "journal-article",
            publicationWarning: true,
          });
    } else expanded.push(record);
  }
  const seen = new Set<string>();
  const unique = expanded
    .filter((w: any) => {
      const doi = w.DOI.toLowerCase();
      if (seen.has(doi)) return false;
      seen.add(doi);
      return true;
    })
    .slice(0, 6);
  for (let i = 0; i < unique.length; i += 2) {
    const results = await Promise.all(
      unique.slice(i, i + 2).map(async (w: any) => {
        progress(`Reading candidate source: ${clean(w.title?.[0] || w.DOI)}`);
        try {
          if (w.publicationWarning) recordPublicationNotice(w.DOI);
          const source = { ...(await resolveScholarly(w.DOI)) };
          if (w.publicationWarning) {
            source.publicationWarning = true;
            source.notice =
              (source.notice || "") +
              " Search found a publication notice for this article. Inspect it before citing.";
          }
          if (!source.scholarly?.eligible) {
            notices.push(
              `Excluded ${source.title}: ${source.scholarly?.reason || "Could not verify this source."}`,
            );
            return undefined;
          }
          const finding = await judgeScholarlyClaim(
            {
              id: "research-claim",
              text: claim,
              start: 0,
              end: claim.length,
              citations: [w.DOI],
            },
            source,
            undefined,
            undefined,
            progress,
          );
          // A registry PDF link is a retrieval suggestion, not a verified full text.
          const pdfUrl = w.link?.find(
            (l: any) =>
              l["content-type"] === "application/pdf" &&
              /^https:\/\//.test(l.URL),
          )?.URL;
          return {
            source,
            finding,
            pdfUrl:
              source.scholarly?.format === "PDF"
                ? source.scholarly.fullTextUrl
                : pdfUrl,
          } as SearchCandidate;
        } catch {
          notices.push(
            `Could not retrieve ${w.DOI}. It was not treated as supporting evidence.`,
          );
          return undefined;
        }
      }),
    );
    candidates.push(...results.filter((c): c is SearchCandidate => !!c));
  }
  const rank: Record<string, number> = {
    supported: 0,
    partial: 1,
    overstated: 2,
    contradicted: 3,
    numeric_mismatch: 3,
    uncertain: 4,
    source_unavailable: 5,
    not_addressed: 6,
  };
  candidates.sort(
    (a, b) => (rank[a.finding.status] ?? 9) - (rank[b.finding.status] ?? 9),
  );
  if (!candidates.length)
    notices.push(
      "No usable full-text articles passed the checks. Try a shorter topic or add an article link. Nothing has been approved.",
    );
  notices.push(
    "Only articles with a confirmed DOAJ peer-review policy and matching readable full text are included. Coverage is limited to journals we can verify. Read the quoted evidence before citing.",
  );
  return { claim, query, candidates, notices };
}
export function discoveryRouter() {
  const router = Router();
  router.post("/claims", (req, res) => {
    const { text } = z
      .object({ text: z.string().min(10).max(100000) })
      .parse(req.body);
    const { candidates: sentences, skipped } = selectClaims(text);
    if (sentences.length > 1000) throw new Error("Use up to 1,000 sentences.");
    res.json({ sentences, skipped });
  });
  type Job = {
    id: string;
    owner: string;
    status: "running" | "complete" | "failed";
    progress: string;
    report?: SearchReport;
    error?: string;
    created: number;
  };
  const jobs = new Map<string, Job>();
  router.post("/searches", (req, res) => {
    const { claim, query } = z
      .object({
        claim: z.string().min(10).max(4000),
        query: z.string().max(500).optional(),
      })
      .parse(req.body);
    const owner = String(res.locals.proofSession || "local");
    for (const [id, j] of jobs)
      if (Date.now() - j.created > 30 * 60_000) jobs.delete(id);
    if (
      [...jobs.values()].some(
        (j) => j.owner === owner && j.status === "running",
      )
    )
      return res
        .status(429)
        .json({ error: "A source search is already running in this session." });
    if ([...jobs.values()].filter((j) => j.status === "running").length >= 5)
      return res.status(429).json({
        error: "Five source searches are running. Try again shortly.",
      });
    if (jobs.size >= 30) {
      const old = [...jobs.values()].find((j) => j.status !== "running");
      if (old) jobs.delete(old.id);
    }
    const job: Job = {
      id: randomUUID(),
      owner,
      status: "running",
      progress: "Starting scholarly search",
      created: Date.now(),
    };
    jobs.set(job.id, job);
    void withUsage(() =>
      discoverSources(claim, query || claim, (p) => {
        job.progress = p;
      }),
    )
      .then(({ result, usage }) => {
        job.report = { ...result, usage };
        job.status = "complete";
      })
      .catch((e) => {
        job.error = e instanceof Error ? e.message : "Source search failed.";
        job.status = "failed";
      });
    setTimeout(() => jobs.delete(job.id), 30 * 60_000).unref();
    res.status(202).json({ id: job.id });
  });
  router.get("/searches/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.owner !== String(res.locals.proofSession || "local"))
      return res.status(404).json({
        error: "Search expired or is not part of this browser session.",
      });
    const { owner, ...publicJob } = job;
    res.json(publicJob);
  });
  return router;
}
