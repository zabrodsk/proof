import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { selectClaims } from "./claims.js";
import { discoverSources } from "./discovery.js";
import { resolveScholarly, judgeScholarlyClaim } from "./scholarly.js";
import { articleMetaDoi } from "./article-input.js";
import { dois } from "./parse.js";
import { clean, resolveDOI, splitPassages } from "./sources.js";
import { remoteFile } from "./remote.js";
import { readPdfPages } from "./documents.js";
import { withUsage } from "./usage.js";
import { directDoi } from "./source-input.js";
import type { Source } from "../shared/types.js";
import type {
  EvidenceMode,
  EvidenceReport,
  SourceInput,
} from "../shared/evidence.js";

export const sourceInput = z
  .object({
    label: z.string().trim().max(300),
    url: z.string().trim().max(2000).optional(),
    text: z.string().trim().max(100000).optional(),
  })
  .refine(
    (s) => !!s.url || (s.text?.length || 0) >= 40,
    "Paste a source link or at least 40 characters of source text.",
  );

export function pageText(html: string) {
  const stripped = html.replace(
    /<(script|style|nav|footer|header|form|aside|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const body =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(stripped)?.[1] ||
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(stripped)?.[1] ||
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(stripped)?.[1] ||
    stripped;
  return body
    .split(/<\/(?:p|div|section|h[1-6]|li)>|<br\s*\/?\s*>/i)
    .map(clean)
    .filter(Boolean)
    .join("\n\n");
}
export async function loadEvidenceSource(input: SourceInput): Promise<Source> {
  const base: Source = {
    id: randomUUID(),
    title: input.label || input.url || "Pasted source",
    authors: [],
    year: "",
    url: /^https:\/\//i.test(input.url || "") ? input.url : undefined,
    passages: [],
    access: "unavailable",
    provider: "Your source",
    retrievedAt: new Date().toISOString(),
  };
  try {
    let doi = input.url ? directDoi(input.url) : undefined;
    if (!doi && input.url) {
      const file = await remoteFile(input.url);
      if (file.buffer.subarray(0, 1024).toString().includes("%PDF-")) {
        const pages = await readPdfPages(file.buffer);
        const candidates = dois(
          pages[0].text.split(/\b(?:references|bibliography)\b/i)[0],
        );
        if (candidates.length === 1) doi = candidates[0];
      } else doi = articleMetaDoi(file.buffer.toString("utf8"));
    }
    if (!doi && input.text) {
      const candidates = dois(
        input.text.slice(0, 5000).split(/\b(?:references|bibliography)\b/i)[0],
      );
      if (candidates.length === 1) doi = candidates[0];
    }
    if (!doi)
      throw new Error(
        "I could not identify a published journal article. Paste its publisher link. Source text with unconfirmed provenance is not used as evidence.",
      );
    const source = await resolveScholarly(doi);
    if (
      input.text &&
      !input.text.toLowerCase().includes(source.title.toLowerCase())
    ) {
      // Formatting can differ, but the complete title must still match.
      const norm = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, "");
      if (!norm(input.text.slice(0, 10000)).includes(norm(source.title)))
        throw new Error(
          "The uploaded or pasted text could not be matched to the article title. Paste the publisher link so we can identify the right paper.",
        );
    }
    return source;
  } catch (e) {
    base.passages = [];
    base.access = "unavailable";
    base.notice =
      e instanceof Error ? e.message : "Could not verify this source.";
    base.scholarly = {
      eligible: false,
      reason: base.notice,
      checkedAt: new Date().toISOString(),
    };
  }
  return base;
}
export function evidenceSentences(text: string) {
  const sentences = selectClaims(text).candidates;
  if (!sentences.length)
    throw new Error(
      "No candidate claims found. Names, dates, headings, questions, and assignment instructions are skipped.",
    );
  if (text.length > 100000 || sentences.length > 100)
    throw new Error(
      "Check up to 100 sentences at a time. Split your text into smaller sections. Nothing has been checked yet.",
    );
  if (sentences.some((s) => s.text.length > 4000))
    throw new Error(
      "One sentence is over 4,000 characters. Add sentence breaks or check a shorter section.",
    );
  return sentences;
}
export async function checkEvidence(
  text: string,
  mode: EvidenceMode,
  inputs: SourceInput[],
  progress: (p: string) => void = () => {},
  deps = {
    load: loadEvidenceSource,
    discover: discoverSources,
    judge: judgeScholarlyClaim,
  },
): Promise<EvidenceReport> {
  const sentences = evidenceSentences(text);
  if (mode === "public" && sentences.length > 25)
    throw new Error(
      "Public research checks read full articles for every sentence. Check up to 25 sentences at a time. Nothing has been checked yet.",
    );
  if (mode === "supplied" && !inputs.length)
    throw new Error("Add at least one source first.");
  const sources: Source[] = [];
  if (mode === "supplied")
    for (const input of inputs) {
      progress(`Reading source ${sources.length + 1} of ${inputs.length}`);
      sources.push(await deps.load(input));
    }
  const report: EvidenceReport = {
    text,
    mode,
    rows: [],
    sources: [...sources],
    completed: 0,
    total: sentences.length,
  };
  for (const sentence of sentences) {
    progress(
      `Checking sentence ${report.rows.length + 1} of ${sentences.length}`,
    );
    const row: EvidenceReport["rows"][number] = {
      ...sentence,
      candidates: [],
      notices: [],
      completed: false,
    };
    try {
      if (mode === "public") {
        const found = await deps.discover(sentence.text, sentence.text, (p) =>
          progress(
            `Sentence ${report.rows.length + 1}/${sentences.length} · ${p}`,
          ),
        );
        row.candidates = found.candidates;
        row.notices = found.notices;
      } else {
        for (const source of sources) {
          const finding = await deps.judge(
            { ...sentence, citations: [] },
            source,
            undefined,
            undefined,
            (p) =>
              progress(
                `Sentence ${report.rows.length + 1}/${sentences.length} · ${p}`,
              ),
          );
          row.candidates.push({ source, finding });
        }
      }
      row.completed =
        row.candidates.length > 0 &&
        row.candidates.every((c) => c.finding.method !== "unverified");
      if (!row.completed)
        row.notices.push(
          "Some evidence could not be checked. This sentence is not fully checked.",
        );
    } catch {
      row.notices.push(
        "Could not finish this sentence. Try it again. It has not been marked correct.",
      );
    }
    for (const candidate of row.candidates) {
      if (
        !report.sources.some(
          (s) =>
            s.id === candidate.source.id ||
            (s.doi && s.doi === candidate.source.doi),
        )
      )
        report.sources.push(candidate.source);
      candidate.source = { ...candidate.source, passages: [] };
    }
    report.rows.push(row);
    if (row.completed) report.completed++;
  }
  return report;
}
export function evidenceRouter(runCheck = checkEvidence) {
  const router = Router();
  type Job = {
    id: string;
    owner: string;
    status: "running" | "complete" | "failed";
    progress: string;
    report?: EvidenceReport;
    error?: string;
    finished?: number;
  };
  const jobs = new Map<string, Job>();
  router.post("/evidence-checks", (req, res) => {
    const data = z
      .object({
        text: z.string().trim().min(10).max(100000),
        mode: z.enum(["supplied", "public"]),
        sources: z.array(sourceInput).max(8).default([]),
      })
      .parse(req.body);
    const sentences = evidenceSentences(data.text);
    if (data.mode === "public" && sentences.length > 25)
      throw new Error(
        "Check up to 25 sentences at a time with public sources. Nothing has been checked yet.",
      );
    if (data.mode === "supplied" && !data.sources.length)
      throw new Error("Add at least one source first.");
    const owner = String(res.locals.proofSession || "local");
    for (const [id, job] of jobs)
      if (job.finished && Date.now() - job.finished > 3600000) jobs.delete(id);
    const running = [...jobs.values()].filter((j) => j.status === "running");
    if (running.some((j) => j.owner === owner) || running.length >= 5)
      return res.status(429).json({
        error:
          "A check is already running, or all five spots are busy. Try again when one finishes.",
      });
    if (jobs.size >= 30) {
      const oldest = [...jobs.values()].find((j) => j.finished);
      if (oldest) jobs.delete(oldest.id);
    }
    const job: Job = {
      id: randomUUID(),
      owner,
      status: "running",
      progress: "Reading your text",
    };
    jobs.set(job.id, job);
    void withUsage(() =>
      runCheck(data.text, data.mode, data.sources, (p) => {
        job.progress = p;
      }),
    )
      .then(({ result, usage }) => {
        job.report = { ...result, usage };
        job.status = "complete";
      })
      .catch(() => {
        job.error =
          "The check could not finish. Your text has not been marked correct. Please try again.";
        job.status = "failed";
      })
      .finally(() => {
        job.finished = Date.now();
        setTimeout(() => jobs.delete(job.id), 3600000).unref();
      });
    res.status(202).json({ id: job.id });
  });
  router.get("/evidence-checks/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.owner !== String(res.locals.proofSession || "local"))
      return res.status(404).json({
        error:
          "This check expired or belongs to another session. Run it again.",
      });
    const { owner, ...result } = job;
    res.json(result);
  });
  return router;
}
