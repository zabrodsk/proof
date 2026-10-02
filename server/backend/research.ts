import { randomUUID } from "node:crypto";
import type { Eligibility, Selection } from "../../shared/backend.js";
import type { Source } from "../../shared/types.js";
import { evidenceRoute } from "../../shared/claims.js";
import { dois } from "../parse.js";
import { normalizedTitle, resolveScholarly } from "../scholarly.js";
import { resolveDOI } from "../sources.js";
import { HttpError, notFound, versions } from "./config.js";
import type { Database, Sql } from "./db.js";
import {
  checksum,
  createAsset,
  ingestAsset,
  validateSelection,
} from "./library.js";
import {
  coalesceRunRequest,
  exaSearch,
  providerContext,
  providerFetch,
} from "./providers.js";
import type { BlobStore } from "./storage.js";
import { remoteFile } from "../remote.js";
import { pageText } from "../evidence.js";
import { entirePassages } from "../scholarly.js";
import { extractFile } from "./extraction.js";
export const authoritativeDomains = [
  "nasa.gov",
  "noaa.gov",
  "cdc.gov",
  "nih.gov",
  "gov.uk",
  "europa.eu",
  "who.int",
  "un.org",
  "oecd.org",
  "worldbank.org",
  "unesco.org",
] as const;
export function authoritativeUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      authoritativeDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

export interface ResearchCandidate {
  title: string;
  url: string;
  doi?: string;
  // Retrieving a source never implies that a claim was checked against it.
  status: "promising";
  eligibility: Eligibility;
  access?: Source["access"];
  reason?: string;
  assetId?: string;
  extractionId?: string;
  referenceEntryId?: string;
  searchIntents: string[];
  resolved?: boolean;
  sourceSnapshot?: FrozenSource;
}
export interface FrozenSource {
  metadata: Record<string, any>;
  eligibility: Eligibility;
  access: Source["access"];
  created_at?: string;
}
export interface ResearchResult {
  selections: Selection[];
  candidates: ResearchCandidate[];
  notices: string[];
  sourceSnapshots?: Record<string, FrozenSource>;
}
interface ResearchState extends ResearchResult {
  kind?: "candidate_resolution";
  version: string;
  searches: {
    query: string;
    intent: string;
    complete: boolean;
    retrievedAt?: string;
    candidates: ResearchCandidate[];
  }[];
  complete: boolean;
}
export interface FrozenReference {
  id: string;
  parsed?: { doi?: string; title?: string };
  candidates?: { doi?: string; title?: string }[];
  confirmedCandidate?: { doi?: string; title?: string };
  status?: string;
  asset_id?: string | null;
  assetId?: string | null;
}
const researchVersion = `research-2:${versions.policy}:${versions.parser}`;

export function neutralResearchQuery(query: string) {
  // Strip a request to confirm a conclusion, but retain every word of the claim,
  // including negation, populations, dates, and numerical qualifications.
  return query
    .normalize("NFKC")
    .replace(
      /^\s*(?:please\s+)?(?:prove(?:\s+that)?|find\s+(?:sources|evidence)\s+(?:that\s+)?(?:prove|support|confirm)(?:\s+that)?|show\s+that)\s+/i,
      "",
    )
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export function researchQueries(
  query: string,
  mode: "discover" | "fact_check",
  route: "academic" | "authoritative" | "public" = "academic",
) {
  const neutral = neutralResearchQuery(query);
  return [
    { query: neutral, intent: "relevance" },
    ...(mode === "fact_check"
      ? [
          {
            query:
              route === "public"
                ? `${neutral} limitations conflicting evidence corrections disputed reports`
                : `${neutral} limitations conflicting evidence null results population conditions systematic review`,
            intent: "qualifications_and_conflicts",
          },
        ]
      : []),
  ];
}
function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch {
    return "";
  }
}
export function deduplicateCandidates(candidates: ResearchCandidate[]) {
  const output: ResearchCandidate[] = [];
  for (const candidate of candidates) {
    const doi = dois(candidate.doi || candidate.url)[0];
    const url = canonicalUrl(candidate.url);
    if (!doi && !url) continue;
    const previous = output.find(
      (other) =>
        !(
          other.referenceEntryId &&
          candidate.referenceEntryId &&
          other.referenceEntryId !== candidate.referenceEntryId
        ) &&
        !(
          other.assetId &&
          candidate.assetId &&
          other.assetId !== candidate.assetId
        ) &&
        ((doi && dois(other.doi || other.url)[0] === doi) ||
          (url && canonicalUrl(other.url) === url)),
    );
    if (previous) {
      previous.searchIntents = [
        ...new Set([...previous.searchIntents, ...candidate.searchIntents]),
      ];
      if (doi) previous.doi = doi;
    } else
      output.push({
        ...candidate,
        ...(doi ? { doi } : {}),
        searchIntents: [...candidate.searchIntents],
      });
  }
  return output;
}
async function active(db: Sql, ws: string, runId: string, lock = false) {
  const ctx = providerContext.getStore();
  ctx?.signal.throwIfAborted();
  const { rows } = await db.query(
    `SELECT input,cancel_requested,invalidated FROM runs WHERE workspace_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [ws, runId],
  );
  if (!rows[0]) throw notFound();
  if (rows[0].cancel_requested || rows[0].invalidated)
    throw new HttpError(409, "Run cancelled or invalidated.");
  return rows[0].input;
}
function requireProviderContext(ws: string, runId: string) {
  const ctx = providerContext.getStore();
  if (!ctx || ctx.ws !== ws || ctx.run !== runId)
    throw new HttpError(
      500,
      "Research requires the run's provider budget context.",
    );
  ctx.signal.throwIfAborted();
}
async function checkpoint(
  db: Database,
  ws: string,
  runId: string,
  key: string,
  state: ResearchState,
) {
  await db.transaction(async (tx) => {
    await active(tx, ws, runId, true);
    // Asset deletion and cache writes serialize. A retry cannot preserve a deleted selection.
    for (const selection of state.selections) {
      const result = await tx.query(
        "SELECT id FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
        [ws, selection.assetId],
      );
      if (!result.rows.length) throw notFound();
    }
    await tx.query(
      "INSERT INTO research_results(id,workspace_id,run_id,query_key,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,query_key) DO UPDATE SET data=excluded.data",
      [randomUUID(), ws, runId, key, JSON.stringify(state)],
    );
  });
}
async function loadState(
  db: Database,
  ws: string,
  runId: string,
  key: string,
): Promise<ResearchState | undefined> {
  const { rows } = await db.query(
    "SELECT data FROM research_results WHERE workspace_id=$1 AND run_id=$2 AND query_key=$3",
    [ws, runId, key],
  );
  const state = rows[0]?.data as ResearchState | undefined;
  if (state?.version !== researchVersion) return;
  await validateSelection(db, ws, state.selections);
  return state;
}
async function previousSearches(
  db: Database,
  ws: string,
  runId: string,
  key: string,
) {
  // Only public discovery results are reusable. Never carry claims, verdicts,
  // source eligibility or tenant-owned selections into a different run.
  const { rows } = await db.query(
    `SELECT r.data FROM research_results r JOIN runs parent ON parent.id=r.run_id AND parent.workspace_id=r.workspace_id
     WHERE r.workspace_id=$1 AND r.run_id<>$2 AND r.query_key=$3
     AND parent.invalidated=false AND parent.cancel_requested=false
     AND parent.created_at > now()-interval '5 minutes'
     ORDER BY parent.created_at DESC LIMIT 1`,
    [ws, runId, key],
  );
  const old = rows[0]?.data as ResearchState | undefined;
  if (old?.version !== researchVersion || old.kind === "candidate_resolution")
    return;
  if (
    !old.searches.every(
      (search) =>
        search.complete &&
        Number.isFinite(Date.parse(search.retrievedAt || "")) &&
        Date.now() - Date.parse(search.retrievedAt!) < 5 * 60 * 1000,
    )
  )
    return;
  return old.searches.map((search) => ({
    query: search.query,
    intent: search.intent,
    retrievedAt: search.retrievedAt,
    complete: true,
    candidates: search.candidates.map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      ...(candidate.doi ? { doi: candidate.doi } : {}),
      status: "promising" as const,
      eligibility: "unknown" as const,
      searchIntents: [search.intent],
    })),
  }));
}

function result(state: ResearchState): ResearchResult {
  return {
    selections: state.selections,
    candidates: state.candidates,
    notices: [...new Set(state.notices)],
    sourceSnapshots: Object.fromEntries(
      state.candidates
        .filter((c) => c.assetId && c.sourceSnapshot)
        .map((c) => [c.assetId!, c.sourceSnapshot!]),
    ),
  };
}
function eligibility(source: Source): Eligibility {
  if (source.publicationWarning) return "ineligible";
  return source.scholarly?.eligible ? "eligible" : "unknown";
}
async function existingSnapshot(
  db: Sql,
  ws: string,
  doi: string,
  academic: boolean,
  textFingerprint?: string,
) {
  const { rows } = await db.query(
    `SELECT a.id,a.metadata,a.eligibility,a.access,e.id AS extraction_id FROM source_assets a
    LEFT JOIN extractions e ON e.asset_id=a.id AND e.workspace_id=a.workspace_id AND e.parser_version=$3 AND e.status IN ('complete','partial')
    WHERE a.workspace_id=$1 AND lower(a.metadata->>'doi')=$2 AND a.deleted_at IS NULL
    AND a.metadata->>'assetKind'='retrieved_text_snapshot'
    AND ($4::boolean=false OR a.eligibility='eligible')
    AND ($5::text IS NULL OR a.metadata->>'textFingerprint'=$5) ORDER BY a.created_at DESC LIMIT 1`,
    [ws, doi, versions.parser, academic, textFingerprint || null],
  );
  return rows[0];
}
async function refreshPublicationStatus(
  db: Database,
  ws: string,
  runId: string,
  previous: any,
  doi: string,
) {
  // Publication status gets a fresh registry check for each run. Text/extraction
  // reuse is independent: a new notice must not require re-reading the whole PDF.
  if (previous.metadata.lastPublicationCheckRunId === runId) return previous;
  const response = await providerFetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok)
    throw new Error(
      `Publication-status refresh returned HTTP ${response.status}. The cached source was not assessed.`,
    );
  const work = (await response.json()).message;
  if (dois(work?.DOI || "")[0] !== doi)
    throw new Error(
      "Publication-status registry identity did not match the cached DOI.",
    );
  const warning = !!(
    work["update-to"]?.length ||
    work.is_retracted ||
    work.retracted ||
    Object.keys(work.relation || {}).some((key) =>
      /retract|correct|update/i.test(key),
    ) ||
    /^(?:retraction|correction|erratum|withdrawal)\b/i.test(
      work.title?.[0] || "",
    )
  );
  const metadata = {
    ...previous.metadata,
    publicationWarning: warning,
    publicationStatusCheckedAt: new Date().toISOString(),
    lastPublicationCheckRunId: runId,
    publicationStatusProvider: "Crossref",
    publicationStatusNotice: warning
      ? "A publication notice was found in Crossref."
      : "No publication notice was found in the checked Crossref record. This does not guarantee that none exists.",
  };
  const currentEligibility = warning ? "ineligible" : previous.eligibility;
  await db.transaction(async (tx) => {
    await active(tx, ws, runId, true);
    const current = await tx.query(
      "SELECT id FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
      [ws, previous.id],
    );
    if (!current.rows.length) throw notFound();
    // Bibliographic identity, retrieved text, and extraction versions stay immutable.
    await tx.query(
      "UPDATE source_assets SET metadata=$3,eligibility=$4 WHERE workspace_id=$1 AND id=$2",
      [ws, previous.id, JSON.stringify(metadata), currentEligibility],
    );
  });
  return { ...previous, metadata, eligibility: currentEligibility };
}
function guardedDatabase(db: Database, ws: string, runId: string): Database {
  return {
    query: (sql, args) => db.query(sql, args),
    close: async () => {},
    transaction: (fn) =>
      db.transaction(async (tx) => {
        await active(tx, ws, runId, true);
        return fn(tx);
      }),
  };
}
async function sourceSnapshot(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  source: Source,
  academic: boolean,
): Promise<{ selection: Selection; snapshot: FrozenSource } | undefined> {
  if (
    !source.passages.length ||
    !["full_text", "abstract"].includes(source.access) ||
    (!source.doi && !source.evidencePolicy)
  )
    return;
  if (academic && !source.scholarly?.eligible) return;
  const doi = dois(source.doi || "")[0];
  if (!doi && !source.evidencePolicy) return;
  const body = Buffer.from(source.passages.join("\n\n"), "utf8");
  const textFingerprint = checksum(
    JSON.stringify({
      content: checksum(body),
      url: source.scholarly?.fullTextUrl || source.url,
      access: source.access,
      parser: versions.parser,
    }),
  );
  const metadata = {
    title: source.title,
    authors: source.authors,
    authorDetails: source.authorDetails,
    year: source.year,
    journal: source.journal,
    volume: source.volume,
    issue: source.issue,
    pages: source.pages,
    issns: source.issns,
    publicationType: source.publicationType,
    doi,
    evidencePolicy: source.evidencePolicy,
    url: source.url,
    scholarly: source.scholarly,
    publicationWarning: !!source.publicationWarning,
    publicationStatusCheckedAt:
      source.scholarly?.checkedAt || source.retrievedAt,
    lastPublicationCheckRunId: runId,
    access: source.access,
    eligibility: eligibility(source),
    provider: source.provider,
    retrievedAt: source.retrievedAt,
    retrievedByRunId: runId,
    assetKind: "retrieved_text_snapshot",
    originalFormat: source.scholarly?.format,
    fullTextUrl: source.scholarly?.fullTextUrl,
    pagination: "unavailable",
    textFingerprint,
    contentFingerprint: checksum(body),
    extractionCompleteness:
      source.access === "full_text" ? "complete" : "abstract_only",
    notice: source.notice,
  };
  // The saved original is a retrieved text snapshot, never a fabricated original PDF.
  const saved = await db.transaction(async (tx) => {
    await active(tx, ws, runId, true);
    // Serialize identity reuse within this workspace, including concurrent claims.
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ws]);
    const old = doi
      ? await existingSnapshot(tx, ws, doi, academic, textFingerprint)
      : (
          await tx.query(
            `SELECT a.id,a.metadata,a.eligibility,a.access,e.id AS extraction_id FROM source_assets a
        LEFT JOIN extractions e ON e.asset_id=a.id AND e.workspace_id=a.workspace_id AND e.parser_version=$4 AND e.status IN ('complete','partial')
        WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND a.metadata->>'assetKind'='retrieved_text_snapshot'
        AND a.metadata->>'url'=$2 AND a.metadata->>'textFingerprint'=$3 ORDER BY a.created_at DESC LIMIT 1`,
            [ws, source.url, textFingerprint, versions.parser],
          )
        ).rows[0];
    if (old)
      return {
        id: old.id as string,
        extractionId: old.extraction_id as string | undefined,
        snapshot: {
          metadata: old.metadata,
          eligibility: old.eligibility,
          access: old.access,
        } as FrozenSource,
      };
    const created = await createAsset(
      tx,
      ws,
      metadata,
      "retrieved-source.txt",
      "text/plain",
      body.length,
    );
    await blobs.put(created.key, body, "text/plain");
    await tx.query(
      "UPDATE source_assets SET access=$3,eligibility=$4 WHERE workspace_id=$1 AND id=$2",
      [ws, created.id, source.access, eligibility(source)],
    );
    await tx.query(
      "UPDATE source_works SET identity_status='confirmed' WHERE workspace_id=$1 AND id=$2",
      [ws, created.workId],
    );
    return {
      id: created.id,
      extractionId: undefined,
      snapshot: {
        metadata,
        eligibility: eligibility(source),
        access: source.access,
        created_at: source.retrievedAt,
      } as FrozenSource,
    };
  });
  const extractionId =
    saved.extractionId ||
    (await ingestAsset(guardedDatabase(db, ws, runId), blobs, ws, saved.id));
  await active(db, ws, runId);
  return {
    selection: { assetId: saved.id, extractionId, pageRanges: [] },
    snapshot: saved.snapshot,
  };
}
async function identifyDoi(candidate: ResearchCandidate) {
  const direct = dois(candidate.doi || candidate.url)[0];
  if (direct) return direct;
  // Discovery may resolve an exact title. Selected-reference resolution never calls this.
  if (!candidate.title || candidate.title === candidate.url) return;
  const response = await providerFetch(
    `https://api.crossref.org/works?query.title=${encodeURIComponent(candidate.title)}&rows=5`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok)
    throw new Error(`Crossref returned HTTP ${response.status}.`);
  const data = await response.json();
  const matches = (data.message?.items || []).filter(
    (work: any) =>
      normalizedTitle(work.title?.[0] || "") ===
      normalizedTitle(candidate.title),
  );
  const ids = [
    ...new Set(matches.flatMap((work: any) => dois(work.DOI || ""))),
  ];
  return ids.length === 1 ? (ids[0] as string) : undefined;
}
async function resolveCandidate(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  candidate: ResearchCandidate,
  academic: boolean,
  identify: boolean,
) {
  await active(db, ws, runId);
  requireProviderContext(ws, runId);
  const doi = identify
    ? await identifyDoi(candidate)
    : dois(candidate.doi || "")[0];
  if (!doi) {
    candidate.reason =
      "No unambiguous DOI identity was resolved. This source has not been checked.";
    candidate.resolved = true;
    return;
  }
  candidate.doi = doi;
  let previous = await existingSnapshot(db, ws, doi, false);
  // Registry checks and text freshness are separate. An expired or legacy
  // snapshot must not masquerade as the current edition of a mutable source.
  const retrievedAt = Date.parse(
    previous?.metadata.retrievedAt || previous?.created_at || "",
  );
  if (
    !previous?.metadata.textFingerprint ||
    !Number.isFinite(retrievedAt) ||
    Date.now() - retrievedAt > 24 * 60 * 60 * 1000
  )
    previous = undefined;
  if (previous)
    previous = await refreshPublicationStatus(db, ws, runId, previous, doi);
  if (previous?.metadata.publicationWarning) {
    Object.assign(candidate, {
      title: previous.metadata.title,
      eligibility: "ineligible",
      access: previous.access,
      resolved: true,
      reason:
        previous.metadata.publicationStatusNotice ||
        "A publication notice excludes this work from checked academic evidence.",
    });
    return;
  }
  if (previous && (!academic || previous.eligibility === "eligible")) {
    const extractionId =
      previous.extraction_id ||
      (await ingestAsset(
        guardedDatabase(db, ws, runId),
        blobs,
        ws,
        previous.id,
      ));
    Object.assign(candidate, {
      assetId: previous.id,
      extractionId,
      title: previous.metadata.title,
      eligibility: previous.eligibility,
      access: previous.access,
      resolved: true,
      reason: "Retrieved text is available for passage assessment.",
      sourceSnapshot: {
        metadata: previous.metadata,
        eligibility: previous.eligibility,
        access: previous.access,
      },
    });
    return { assetId: previous.id, extractionId, pageRanges: [] } as Selection;
  }
  const source = academic
    ? await resolveScholarly(doi, true)
    : await resolveDOI(doi, true);
  await active(db, ws, runId);
  if (dois(source.doi || "")[0] !== doi)
    throw new Error("Retrieved source identity differs from the selected DOI.");
  const saved = await sourceSnapshot(db, blobs, ws, runId, source, academic);
  const selection = saved?.selection;
  Object.assign(candidate, {
    title: source.title,
    url: source.url || candidate.url,
    doi,
    eligibility: eligibility(source),
    access: source.access,
    reason: selection
      ? "Retrieved text is available for passage assessment."
      : source.scholarly?.reason ||
        source.notice ||
        "Readable evidence is unavailable.",
    ...(selection || {}),
    ...(saved ? { sourceSnapshot: saved.snapshot } : {}),
    resolved: !source.scholarly?.retryable,
  });
  return selection;
}
async function resolvedCandidate(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  candidate: ResearchCandidate,
  academic: boolean,
  identify: boolean,
) {
  const input = await active(db, ws, runId);
  const resolutionKey = checksum(
    JSON.stringify({
      version: researchVersion,
      resolution:
        dois(candidate.doi || candidate.url)[0] || canonicalUrl(candidate.url),
      academic,
      identify,
      sourcePolicy: input.sourcePolicy,
      externalAccess: input.externalAccess,
    }),
  );
  return coalesceRunRequest(`resolution:${resolutionKey}`, async () => {
    const prior = await loadState(db, ws, runId, resolutionKey);
    if (prior?.complete && prior.kind === "candidate_resolution") return prior;
    const copy = structuredClone(candidate);
    const selection = await resolveCandidate(
      db,
      blobs,
      ws,
      runId,
      copy,
      academic,
      identify,
    );
    const resolution: ResearchState = {
      version: researchVersion,
      kind: "candidate_resolution",
      complete: !!copy.resolved,
      searches: [],
      candidates: [copy],
      selections: selection ? [selection] : [],
      notices: [],
    };
    if (copy.resolved)
      await checkpoint(db, ws, runId, resolutionKey, resolution);
    return resolution;
  });
}
async function resolveCandidates(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  key: string,
  state: ResearchState,
  academic: boolean,
  identify: boolean,
) {
  for (const candidate of state.candidates) {
    if (candidate.resolved) continue;
    try {
      const resolved = await resolvedCandidate(
        db,
        blobs,
        ws,
        runId,
        candidate,
        academic,
        identify,
      );
      const { searchIntents, referenceEntryId } = candidate;
      Object.assign(candidate, resolved.candidates[0], {
        searchIntents,
        ...(referenceEntryId ? { referenceEntryId } : {}),
      });
      for (const selection of resolved.selections)
        if (!state.selections.some((s) => s.assetId === selection.assetId))
          state.selections.push(selection);
    } catch (error) {
      await active(db, ws, runId);
      if (error instanceof HttpError) throw error;
      candidate.reason =
        error instanceof Error ? error.message : "Source retrieval failed.";
      state.notices.push(`${candidate.title}: ${candidate.reason}`);
    }
    await checkpoint(db, ws, runId, key, state);
  }
  state.candidates = deduplicateCandidates(state.candidates);
  state.complete =
    state.searches.every((s) => s.complete) &&
    state.candidates.every((c) => c.resolved);
  await checkpoint(db, ws, runId, key, state);
  return result(state);
}

export async function research(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  query: string,
  mode: "discover" | "fact_check",
  maxCandidates: number,
  route: "academic" | "authoritative" | "public" = "academic",
  dependencies: { download: typeof remoteFile } = { download: remoteFile },
): Promise<ResearchResult> {
  const input = await active(db, ws, runId);
  if (
    input.mode !== mode ||
    input.externalAccess !== "research" ||
    !input.allowProviderProcessing
  )
    throw new HttpError(403, "This run does not permit independent research.");
  requireProviderContext(ws, runId);
  if (input.sourcePolicy === "academic" && route !== "academic")
    throw new HttpError(403, "Academic-only runs cannot use public discovery.");
  if (route === "public" && input.sourcePolicy !== "public")
    throw new HttpError(
      403,
      "This run does not permit all-source public discovery.",
    );
  const natural = evidenceRoute(query);
  if (natural === "private" || natural === "primary_text")
    throw new HttpError(
      403,
      "Private and original-work claims require supplied evidence.",
    );
  if (natural === "academic" && route !== "academic")
    throw new HttpError(403, "Scientific claims require academic discovery.");
  const maximum = Math.min(20, Math.max(1, Math.floor(maxCandidates)));
  if (!Number.isFinite(maximum))
    throw new HttpError(400, "A finite candidate limit is required.");
  const searches = researchQueries(query, mode, route);
  if (!searches[0].query)
    throw new HttpError(400, "A research query is required.");
  const key = checksum(
    JSON.stringify({
      version: researchVersion,
      mode,
      query: searches[0].query,
      maximum,
      route,
      sourcePolicy: input.sourcePolicy,
      externalAccess: input.externalAccess,
    }),
  );
  const cached = await loadState(db, ws, runId, key);
  const reusable = cached
    ? undefined
    : await previousSearches(db, ws, runId, key);
  const state: ResearchState = cached || {
    version: researchVersion,
    selections: [],
    candidates: [],
    notices: reusable
      ? [
          "Recent search results were reused within this workspace and source scope. Source content and eligibility are checked again for this run.",
        ]
      : [],
    complete: false,
    searches:
      reusable ||
      searches.map((s) => ({ ...s, complete: false, candidates: [] })),
  };
  if (state.complete) return result(state);
  for (const search of state.searches) {
    if (search.complete) continue;
    try {
      const hits = await exaSearch(
        search.query,
        maximum,
        route === "authoritative"
          ? { domains: authoritativeDomains }
          : route === "public"
            ? { scope: "public" }
            : { scope: "academic" },
      );
      search.candidates = hits.map(
        (hit: { title: string; url: string; doi?: string }) => ({
          title: hit.title,
          url: hit.url,
          ...(hit.doi ? { doi: hit.doi } : {}),
          status: "promising" as const,
          eligibility: "unknown" as const,
          searchIntents: [search.intent],
        }),
      );
      search.complete = true;
      search.retrievedAt = new Date().toISOString();
    } catch (error) {
      await active(db, ws, runId);
      if (error instanceof HttpError) throw error;
      state.notices.push(
        `${search.intent}: ${error instanceof Error ? error.message : "Search failed."}`,
      );
    }
    await checkpoint(db, ws, runId, key, state);
  }
  // Round-robin search intentions so the candidate cap cannot erase the conflict search.
  const merged: ResearchCandidate[] = [];
  for (let index = 0; index < maximum; index++)
    for (const search of state.searches)
      if (search.candidates[index]) merged.push(search.candidates[index]);
  const unique = deduplicateCandidates(merged);
  if (unique.length > maximum)
    state.notices.push(
      `Candidate budget limited retrieval to ${maximum} of ${unique.length} distinct search results.`,
    );
  const known = state.candidates;
  state.candidates = deduplicateCandidates(
    unique
      .slice(0, maximum)
      .map(
        (candidate) =>
          known.find(
            (previous) =>
              (candidate.doi && previous.doi === candidate.doi) ||
              canonicalUrl(previous.url) === canonicalUrl(candidate.url),
          ) || candidate,
      ),
  );
  await checkpoint(db, ws, runId, key, state);
  if (route === "authoritative" || route === "public") {
    for (const candidate of state.candidates) {
      if (candidate.resolved) continue;
      if (route === "public" && dois(candidate.doi || candidate.url)[0]) {
        try {
          const resolved = await resolvedCandidate(
            db,
            blobs,
            ws,
            runId,
            candidate,
            true,
            false,
          );
          const intents = candidate.searchIntents;
          Object.assign(candidate, resolved.candidates[0], {
            searchIntents: intents,
          });
          for (const selection of resolved.selections)
            if (!state.selections.some((s) => s.assetId === selection.assetId))
              state.selections.push(selection);
        } catch (error) {
          await active(db, ws, runId);
          if (error instanceof HttpError) throw error;
          candidate.reason =
            error instanceof Error ? error.message : "Source retrieval failed.";
          state.notices.push(`${candidate.title}: ${candidate.reason}`);
        }
        await checkpoint(db, ws, runId, key, state);
        continue;
      }
      const resolutionKey = checksum(
        JSON.stringify({
          version: researchVersion,
          publicSource: canonicalUrl(candidate.url),
          route,
          sourcePolicy: input.sourcePolicy,
          externalAccess: input.externalAccess,
        }),
      );
      if (route === "authoritative" && !authoritativeUrl(candidate.url)) {
        candidate.resolved = true;
        candidate.reason =
          "This URL is outside the supported authoritative source domains.";
        continue;
      }
      try {
        const resolution = await coalesceRunRequest(
          `public-resolution:${resolutionKey}`,
          async () => {
            const prior = await loadState(db, ws, runId, resolutionKey);
            if (prior?.complete && prior.kind === "candidate_resolution")
              return prior;
            const copy = structuredClone(candidate);
            const downloaded = await dependencies.download(copy.url);
            if (route === "authoritative" && !authoritativeUrl(downloaded.url))
              throw new Error(
                "The source redirected outside its authoritative domain.",
              );
            const raw = downloaded.buffer.toString("utf8");
            let text = /text\/html|application\/xhtml\+xml/i.test(
              downloaded.type,
            )
              ? pageText(raw)
              : /^text\/plain/i.test(downloaded.type)
                ? raw
                : "";
            if (
              downloaded.buffer.subarray(0, 1024).toString().includes("%PDF-")
            ) {
              const parsed = await extractFile(
                downloaded.buffer,
                "public-source.pdf",
              );
              if (
                parsed.coverage.unreadablePages.length ||
                parsed.coverage.omittedPages.length
              )
                throw new Error(
                  "The public PDF has unreadable pages. Upload the original to review its extraction coverage.",
                );
              text = parsed.pages.map((page) => page.text).join("\n\n");
            }
            if (text.length < 200 || text.length > 150_000)
              throw new Error(
                "Readable source text is unavailable or exceeds the check limit. Upload the original document.",
              );
            const source: Source = {
              id: randomUUID(),
              title: copy.title,
              authors: [],
              year: "",
              url: downloaded.url,
              access: "full_text",
              passages: entirePassages(text),
              provider:
                route === "authoritative"
                  ? "Authoritative public source"
                  : "Public web source",
              evidencePolicy:
                route === "authoritative" ? "authoritative" : "public",
              retrievedAt: new Date().toISOString(),
            };
            const saved = await sourceSnapshot(
              db,
              blobs,
              ws,
              runId,
              source,
              false,
            );
            await active(db, ws, runId);
            Object.assign(copy, {
              url: source.url,
              ...saved?.selection,
              sourceSnapshot: saved?.snapshot,
              access: source.access,
              resolved: true,
              reason:
                "Original source text is available for passage assessment. Academic peer review is not claimed.",
            });
            const resolved: ResearchState = {
              version: researchVersion,
              kind: "candidate_resolution",
              complete: true,
              searches: [],
              candidates: [copy],
              selections: saved ? [saved.selection] : [],
              notices: [],
            };
            await checkpoint(db, ws, runId, resolutionKey, resolved);
            return resolved;
          },
        );
        const intents = candidate.searchIntents;
        Object.assign(candidate, resolution.candidates[0], {
          searchIntents: intents,
        });
        for (const selection of resolution.selections)
          if (!state.selections.some((s) => s.assetId === selection.assetId))
            state.selections.push(selection);
      } catch (error) {
        await active(db, ws, runId);
        if (error instanceof HttpError) throw error;
        candidate.reason =
          error instanceof Error ? error.message : "Source retrieval failed.";
        state.notices.push(`${candidate.title}: ${candidate.reason}`);
      }
      await checkpoint(db, ws, runId, key, state);
    }
    state.complete =
      state.searches.every((s) => s.complete) &&
      state.candidates.every((c) => c.resolved);
    await checkpoint(db, ws, runId, key, state);
    return result(state);
  }
  return resolveCandidates(db, blobs, ws, runId, key, state, true, true);
}

export async function resolveSelectedReferences(
  db: Database,
  blobs: BlobStore,
  ws: string,
  runId: string,
  entries: FrozenReference[],
  maxCandidates = 20,
): Promise<ResearchResult> {
  if (!Number.isFinite(maxCandidates) || maxCandidates < 1)
    throw new HttpError(400, "A positive finite candidate limit is required.");
  maxCandidates = Math.min(100, Math.floor(maxCandidates));
  const input = await active(db, ws, runId);
  if (
    input.mode !== "source_check" ||
    input.externalAccess !== "resolve_selected_references" ||
    !input.allowProviderProcessing
  )
    throw new HttpError(
      403,
      "This run does not permit external reference resolution.",
    );
  requireProviderContext(ws, runId);
  const key = checksum(
    JSON.stringify({
      version: researchVersion,
      selectedReferences: entries,
      academic: input.sourcePolicy === "academic",
      maxCandidates,
    }),
  );
  const cached = await loadState(db, ws, runId, key);
  if (cached?.complete) return result(cached);
  const state: ResearchState = cached || {
    version: researchVersion,
    selections: [],
    candidates: [],
    notices: [],
    searches: [],
    complete: false,
  };
  if (!cached)
    for (const entry of entries) {
      if (entry.asset_id || entry.assetId) continue;
      // A DOI explicitly present in the supplied reference, or one unambiguous/confirmed
      // match, is the only identity allowed. Never search around an ambiguous entry.
      const selected =
        entry.confirmedCandidate ||
        (entry.status === "matched_needs_pdf" && entry.candidates?.length === 1
          ? entry.candidates[0]
          : undefined);
      const doi = dois(
        entry.confirmedCandidate?.doi ||
          entry.parsed?.doi ||
          selected?.doi ||
          "",
      )[0];
      if (!doi || (entry.status === "ambiguous" && !entry.confirmedCandidate)) {
        state.notices.push(
          `Reference ${entry.id} needs an unambiguous DOI or a selected upload.`,
        );
        continue;
      }
      if (state.candidates.length >= maxCandidates) {
        state.notices.push(
          `Reference ${entry.id} was not retrieved because the candidate budget was reached.`,
        );
        continue;
      }
      state.candidates.push({
        title: selected?.title || entry.parsed?.title || doi,
        doi,
        url: `https://doi.org/${doi}`,
        referenceEntryId: entry.id,
        status: "promising",
        eligibility: "unknown",
        searchIntents: ["selected_reference"],
      });
    }
  await checkpoint(db, ws, runId, key, state);
  return resolveCandidates(
    db,
    blobs,
    ws,
    runId,
    key,
    state,
    input.sourcePolicy === "academic",
    false,
  );
}
