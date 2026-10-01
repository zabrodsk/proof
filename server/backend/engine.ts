import { randomUUID } from "node:crypto";
import type {
  BackendFinding,
  Citation,
  EvidenceLink,
  Passage,
  RunInput,
  Selection,
  Support,
} from "../../shared/backend.js";
import type { Source, Finding, Claim } from "../../shared/types.js";
import { allSentences } from "../classroom.js";
import { citations, matchesCitation } from "../parse.js";
import { judgeClaim } from "../judge.js";
import { type Database, event } from "./db.js";
import { asset, checksum, validateSelection } from "./library.js";
import { retrieve } from "./retrieval.js";
import { ownedRun } from "./service.js";
import { providerContext } from "./providers.js";
import type { BlobStore } from "./storage.js";
import { research, resolveSelectedReferences } from "./research.js";

export function combineSupport(values: Support[]): Support {
  const has = (v: Support) => values.includes(v);
  if (
    has("mixed") ||
    (has("contradicted") &&
      (has("supported") || has("partial") || has("overstated")))
  )
    return "mixed";
  if (has("contradicted")) return "contradicted";
  if (has("overstated")) return "overstated";
  if (has("partial")) return "partial";
  if (has("supported")) return "supported";
  return "not_verified";
}
export function supportOf(f: Finding): Support {
  if (f.method === "unverified") return "not_verified";
  if (f.status === "numeric_mismatch") return "contradicted";
  if (["supported", "partial", "overstated", "contradicted"].includes(f.status))
    return f.status as Support;
  return "not_verified";
}
export function claimCandidates(text: string, spans: RunInput["claimSpans"]) {
  const candidates = spans
    ? spans.map((s) => ({ ...s, text: text.slice(s.start, s.end) }))
    : allSentences(text);
  return candidates.map((s) => {
    const before = text.lastIndexOf("\n\n", s.start),
      after = text.indexOf("\n\n", s.end);
    return {
      text: s.text,
      start: s.start,
      end: s.end,
      context: text
        .slice(before < 0 ? 0 : before + 2, after < 0 ? text.length : after)
        .slice(0, 6000),
      kind: /["“][^"”]+["”]/.test(s.text)
        ? "quotation"
        : /\b(I think|I believe|in my opinion)\b/i.test(s.text)
          ? "opinion"
          : /\b(is|are|was|were|causes?|found|shows?|reports?|increases?|reduces?)\b/i.test(
                s.text,
              )
            ? "factual"
            : "ambiguous",
      compound: /\b(and|but|whereas|although)\b/i.test(s.text),
    };
  });
}
export function assertEvidence(f: Finding, packet: Passage[]) {
  if (f.evidence && !packet.some((p) => p.text === f.evidence))
    throw new Error("Assessment returned evidence outside its input packet.");
  if (f.checkedPassages?.some((text) => !packet.some((p) => p.text === text)))
    throw new Error("Assessment returned unchecked passage text.");
}
function packets(passages: Passage[]) {
  const result: Passage[][] = [];
  let current: Passage[] = [],
    size = 0;
  for (const p of passages) {
    if (
      current.length &&
      (current.length >= 6 || size + p.text.length > 9000)
    ) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.text.length;
  }
  if (current.length) result.push(current);
  return result;
}
export type EngineDeps = {
  judge: typeof judgeClaim;
  research: typeof research;
  resolveReferences: typeof resolveSelectedReferences;
};
const defaults: EngineDeps = {
  judge: judgeClaim,
  research,
  resolveReferences: resolveSelectedReferences,
};
export async function processRun(
  db: Database,
  blobs: BlobStore,
  ws: string,
  id: string,
  deps: EngineDeps = defaults,
) {
  let run = await ownedRun(db, ws, id);
  if (!["queued", "running"].includes(run.status) || run.cancel_requested)
    return;
  const controller = new AbortController();
  const monitor = setInterval(() => {
    void ownedRun(db, ws, id)
      .then((r) => {
        if (r.cancel_requested) controller.abort();
      })
      .catch(() => controller.abort());
  }, 500);
  monitor.unref();
  try {
    await providerContext.run(
      {
        db,
        ws,
        run: id,
        signal: controller.signal,
        maxCalls: run.config.limits.providerCalls,
        model: run.config.model,
      },
      async () => {
        const input: RunInput = run.input;
        await validateSelection(db, ws, input.selectedSources);
        await db.transaction(async (tx) => {
          const current = await ownedRun(tx, ws, id, true);
          if (current.cancel_requested) throw new Error("Run cancelled.");
          await tx.query(
            "UPDATE runs SET status='running',updated_at=now() WHERE workspace_id=$1 AND id=$2",
            [ws, id],
          );
          await event(tx, ws, id, "running", { stage: current.stage });
        });
        const document = (
          await db.query(
            "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2",
            [ws, run.document_version_id],
          )
        ).rows[0];
        let claims = (
          await db.query(
            "SELECT * FROM claims WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
            [ws, id],
          )
        ).rows;
        if (!claims.length) {
          const candidates = claimCandidates(document.text, input.claimSpans),
            permitted = candidates.slice(0, run.config.limits.claims);
          await db.transaction(async (tx) => {
            await ownedRun(tx, ws, id, true);
            for (let ordinal = 0; ordinal < permitted.length; ordinal++)
              await tx.query(
                "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,ordinal) DO NOTHING",
                [
                  randomUUID(),
                  ws,
                  id,
                  ordinal,
                  JSON.stringify(permitted[ordinal]),
                ],
              );
            await tx.query(
              "UPDATE runs SET stage='assess',coverage=$3 WHERE workspace_id=$1 AND id=$2",
              [
                ws,
                id,
                JSON.stringify({
                  totalClaims: candidates.length,
                  selectedClaims: permitted.length,
                  unprocessedSpans: candidates
                    .slice(permitted.length)
                    .map(({ start, end }) => ({ start, end })),
                  completedClaims: 0,
                }),
              ],
            );
          });
          claims = (
            await db.query(
              "SELECT * FROM claims WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
              [ws, id],
            )
          ).rows;
        }
        const sourceSelections = [...input.selectedSources];
        const sourceSnapshots = { ...(run.config.sourceSnapshots || {}) };
        const rememberSnapshots = (snapshots: typeof sourceSnapshots) => {
          for (const [assetId, snapshot] of Object.entries(snapshots))
            sourceSnapshots[assetId] ??= snapshot;
        };
        const referenceNotices: string[] = [];
        const resolvedReferenceIds = new Set<string>(
          (run.config.references || [])
            .filter((r: any) => r.status === "matched_ready" && r.asset_id)
            .map((r: any) => r.id),
        );
        if (
          input.mode === "source_check" &&
          input.externalAccess === "resolve_selected_references" &&
          input.allowProviderProcessing
        ) {
          const resolved = await deps.resolveReferences(
            db,
            blobs,
            ws,
            id,
            run.config.references || [],
            run.config.limits.candidates,
          );
          for (const s of resolved.selections)
            if (!sourceSelections.some((p) => p.assetId === s.assetId))
              sourceSelections.push(s);
          referenceNotices.push(...resolved.notices);
          rememberSnapshots(resolved.sourceSnapshots || {});
          for (const candidate of resolved.candidates)
            if (
              candidate.referenceEntryId &&
              candidate.assetId &&
              resolved.selections.some((s) => s.assetId === candidate.assetId)
            )
              resolvedReferenceIds.add(candidate.referenceEntryId);
        }
        for (const claimRow of claims) {
          controller.signal.throwIfAborted();
          run = await ownedRun(db, ws, id);
          if (run.cancel_requested) return;
          if (
            (
              await db.query(
                "SELECT id FROM findings WHERE workspace_id=$1 AND run_id=$2 AND claim_id=$3",
                [ws, id, claimRow.id],
              )
            ).rows.length
          )
            continue;
          const claim: Claim = {
            id: claimRow.id,
            ...claimRow.data,
            citations: citations(claimRow.data.text),
          };
          let selections = [...sourceSelections];
          let researchCandidates: any[] = [];
          const notices = [...referenceNotices];
          if (input.mode !== "source_check" && input.allowProviderProcessing) {
            const found = await deps.research(
              db,
              blobs,
              ws,
              id,
              run.config.researchQuery || claim.text,
              input.mode,
              run.config.limits.candidates,
            );
            selections = found.selections;
            researchCandidates = found.candidates;
            notices.push(...found.notices);
            rememberSnapshots(found.sourceSnapshots || {});
          }
          const sources = await Promise.all(
            selections.map(async (selection) => {
              const live = await asset(db, ws, selection.assetId);
              let frozen = sourceSnapshots[selection.assetId];
              // New research results from compatibility adapters may predate the
              // richer research contract. Freeze their first assessment input too.
              if (
                !frozen &&
                run.config.sourceSnapshots &&
                !input.selectedSources.some(
                  (s) => s.assetId === selection.assetId,
                )
              ) {
                frozen = {
                  metadata: live.metadata,
                  eligibility: live.eligibility,
                  access: live.access,
                  created_at: live.created_at,
                };
                sourceSnapshots[selection.assetId] = frozen;
              }
              if (!frozen)
                notices.push(
                  "This older run has no frozen source metadata. Source eligibility and publication status cannot be reproduced.",
                );
              return {
                selection,
                provenanceFrozen: !!frozen,
                asset: frozen
                  ? { ...live, ...frozen }
                  : { ...live, eligibility: "unknown", access: "unavailable" },
              };
            }),
          );
          await db.transaction(async (tx) => {
            const current = await ownedRun(tx, ws, id, true);
            if (current.cancel_requested) throw new Error("Run cancelled.");
            await tx.query(
              "UPDATE runs SET config=jsonb_set(config,'{sourceSnapshots}',$3::jsonb) WHERE workspace_id=$1 AND id=$2",
              [ws, id, JSON.stringify(sourceSnapshots)],
            );
          });
          const cited = sources.filter((s) =>
            claim.citations.some((c) =>
              matchesCitation(c, {
                ...s.asset.metadata,
                authors: s.asset.metadata.authors || [],
                doi: s.asset.metadata.doi,
              } as Source),
            ),
          );
          const ambiguous =
            (cited.length > 1 && claim.citations.length === 1) ||
            claim.citations.length > 1;
          let citation: Citation =
            input.mode !== "source_check" ||
            input.checkScope === "selected_library"
              ? "not_checked"
              : !claim.citations.length
                ? "missing"
                : cited.length === 0 || ambiguous
                  ? "ambiguous"
                  : "not_checked";
          const evidence: EvidenceLink[] = [];
          const inspected = new Set<string>();
          const primary: Support[] = [],
            alternative: Support[] = [],
            citedLocation: Support[] = [],
            citedSource: Support[] = [];
          let semanticFailures = 0,
            attempts = 0,
            retrievedPassages = 0,
            locatorKnown = true,
            hadLocator = false;
          const primaryAssessments: Finding["status"][] = [];
          const proposedFixes: NonNullable<BackendFinding["fix"]>[] = [];
          const allEligible =
            sources.length > 0 &&
            sources.every((s) => s.asset.eligibility === "eligible");
          for (const item of sources) {
            const isCited = cited.some(
              (c) => c.selection.assetId === item.selection.assetId,
            );
            const alternativeOnly =
              input.mode === "source_check" &&
              input.checkScope !== "selected_library" &&
              claim.citations.length > 0 &&
              !isCited;
            if (
              input.checkScope === "cited_only" &&
              input.mode === "source_check" &&
              !isCited
            )
              continue;
            const citationText = claim.citations.find((c) =>
              matchesCitation(c, {
                ...item.asset.metadata,
                authors: item.asset.metadata.authors || [],
              } as Source),
            );
            const locatorMatch = citationText?.match(
              /(?:,?\s+(?:p\.?\s*)?)(\d{1,4})(?:[–-](\d{1,4}))?\s*$/,
            );
            const locator = locatorMatch?.[1];
            const actualLocator =
              locator && !/^(19|20)\d{2}$/.test(locator)
                ? locator + (locatorMatch?.[2] ? "-" + locatorMatch[2] : "")
                : undefined;
            hadLocator ||= !!actualLocator;
            const retrieved = await retrieve(
              db,
              ws,
              item.selection,
              claim.text,
              actualLocator,
              10,
              run.config.embeddingEnabled === undefined
                ? undefined
                : {
                    enabled: run.config.embeddingEnabled,
                    revision: run.config.embeddingRevision,
                    modelDirectory: run.config.embeddingModelDirectory,
                  },
            );
            retrievedPassages += retrieved.passages.length;
            if (isCited && actualLocator && !retrieved.locatorKnown)
              locatorKnown = false;
            const source: Source = {
              id: item.selection.assetId,
              title: item.asset.metadata.title,
              authors: item.asset.metadata.authors || [],
              year: item.asset.metadata.year || "",
              doi: item.asset.metadata.doi,
              access: item.asset.access,
              provider: "Persistent library",
              retrievedAt:
                item.asset.created_at?.toISOString?.() ||
                String(item.asset.created_at),
              passages: retrieved.passages.map((p) => p.text),
              publicationWarning: item.asset.metadata.publicationWarning,
            };
            const role =
              input.mode !== "source_check"
                ? "research"
                : alternativeOnly
                  ? "alternative"
                  : "cited";
            const citedPackets = packets(
              retrieved.passages.filter((p) =>
                retrieved.citedIds.includes(p.id),
              ),
            );
            const otherPackets = packets(
              retrieved.passages.filter(
                (p) => !retrieved.citedIds.includes(p.id),
              ),
            );
            for (const packet of [...citedPackets, ...otherPackets]) {
              controller.signal.throwIfAborted();
              const cacheKey = checksum(
                JSON.stringify({
                  claim: claimRow.data,
                  packet,
                  model: run.config.model,
                  prompt: run.config.prompt,
                  policy: run.config.policy,
                  source: item.asset.metadata,
                }),
              );
              let assessment: Finding | undefined = (
                await db.query(
                  "SELECT data FROM assessments WHERE workspace_id=$1 AND run_id=$2 AND cache_key=$3",
                  [ws, id, cacheKey],
                )
              ).rows[0]?.data;
              if (!assessment) {
                if (
                  !item.provenanceFrozen ||
                  !input.allowProviderProcessing ||
                  (input.sourcePolicy === "academic" &&
                    item.asset.eligibility !== "eligible")
                )
                  assessment = {
                    ...claim,
                    method: "unverified",
                    status: "uncertain",
                    explanation: !item.provenanceFrozen
                      ? "The original source metadata was not frozen for this older run. Start a new check."
                      : !input.allowProviderProcessing
                        ? "Provider processing is disabled."
                        : "Academic source eligibility is not confirmed.",
                  };
                else
                  assessment = await deps.judge(
                    claim,
                    source,
                    packet.map((p) => p.text),
                    { context: claimRow.data.context },
                  );
                assertEvidence(assessment, packet);
                const quotes = [
                  ...claim.text.matchAll(/["“]([^"”]{20,})["”]/g),
                ].map((m) => m[1].replace(/\s+/g, " "));
                if (
                  assessment.status === "supported" &&
                  quotes.some(
                    (q) =>
                      !packet.some((p) =>
                        p.text.replace(/\s+/g, " ").includes(q),
                      ),
                  )
                )
                  assessment = {
                    ...assessment,
                    status: "uncertain",
                    fix: undefined,
                    explanation:
                      "The quotation was not found verbatim in the assessed passages.",
                  };
                await db.transaction(async (tx) => {
                  const current = await ownedRun(tx, ws, id, true);
                  if (current.cancel_requested)
                    throw new Error("Run cancelled.");
                  await tx.query(
                    "INSERT INTO assessments(id,workspace_id,run_id,claim_id,cache_key,input_passage_ids,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,cache_key) DO NOTHING",
                    [
                      randomUUID(),
                      ws,
                      id,
                      claim.id,
                      cacheKey,
                      JSON.stringify(packet.map((p) => p.id)),
                      JSON.stringify(assessment),
                    ],
                  );
                });
              }
              assertEvidence(assessment, packet);
              attempts++;
              if (assessment.method === "unverified") semanticFailures++;
              if (assessment.method !== "unverified")
                for (const p of packet) inspected.add(p.id);
              const support = supportOf(assessment);
              if (!alternativeOnly) primaryAssessments.push(assessment.status);
              (alternativeOnly ? alternative : primary).push(support);
              if (isCited) citedSource.push(support);
              const passage = packet.find(
                (p) => p.text === assessment.evidence,
              );
              const isCitedPacket = packet.some((p) =>
                retrieved.citedIds.includes(p.id),
              );
              if (isCited && isCitedPacket) citedLocation.push(support);
              if (passage) {
                evidence.push({ ...passage, role, support });
              }
              notices.push(assessment.explanation);
              if (
                (isCited || input.checkScope === "selected_library") &&
                !ambiguous &&
                assessment.fix &&
                ((assessment.fixKind === "number" &&
                  assessment.numericCorrection) ||
                  (assessment.fixKind === "quotation" &&
                    assessment.evidenceExcerpt &&
                    passage?.text.includes(assessment.evidenceExcerpt) &&
                    assessment.fix.includes(
                      `"${assessment.evidenceExcerpt}"`,
                    ))) &&
                passage &&
                !alternativeOnly &&
                !source.publicationWarning
              )
                proposedFixes.push({
                  original: claim.text,
                  replacement: assessment.fix,
                  start: claim.start,
                  end: claim.end,
                  documentVersionId: input.documentVersionId,
                  kind:
                    assessment.fixKind === "number" ? "number" : "quotation",
                });
            }
          }
          if (
            input.mode === "source_check" &&
            input.checkScope !== "selected_library" &&
            claim.citations.length &&
            cited.length &&
            !ambiguous
          ) {
            const all = combineSupport(citedSource),
              located = combineSupport(citedLocation);
            citation = hadLocator
              ? !locatorKnown
                ? "ambiguous"
                : located === "supported"
                  ? "correct"
                  : all === "supported"
                    ? "wrong_locator"
                    : "not_checked"
              : all === "supported"
                ? "correct"
                : "not_checked";
            if (
              [
                "not_verified",
                "contradicted",
                "partial",
                "overstated",
              ].includes(all) &&
              combineSupport(alternative) === "supported"
            )
              citation = "wrong_source";
          }
          let support = combineSupport(primary);
          if (semanticFailures && support === "supported") support = "partial";
          if (ambiguous && support === "supported") support = "not_verified";
          const fix =
            ["contradicted", "overstated", "partial"].includes(support) &&
            semanticFailures === 0 &&
            !ambiguous &&
            proposedFixes.length > 0 &&
            new Set(proposedFixes.map((f) => f.replacement)).size === 1
              ? proposedFixes[0]
              : undefined;
          const result: BackendFinding = {
            id: randomUUID(),
            claim: claimRow.data,
            support,
            citation,
            basis:
              input.sourcePolicy === "user_supplied"
                ? "supplied_text"
                : "academic_research",
            ...(support === "not_verified"
              ? {
                  evidenceGap: !retrievedPassages
                    ? ("source_unavailable" as const)
                    : input.sourcePolicy === "academic" &&
                        !sources.some((s) => s.asset.eligibility === "eligible")
                      ? ("source_requirements" as const)
                      : !attempts || semanticFailures
                        ? ("check_incomplete" as const)
                        : primaryAssessments.length > 0 &&
                            primaryAssessments.every(
                              (s) => s === "not_addressed",
                            )
                          ? ("not_addressed" as const)
                          : ("insufficient_evidence" as const),
                }
              : {}),
            eligibility: allEligible
              ? "eligible"
              : sources.some((s) => s.asset.eligibility === "ineligible")
                ? "ineligible"
                : "unknown",
            processing:
              attempts > 0 && semanticFailures === 0 ? "complete" : "partial",
            evidence,
            explanation: [...new Set(notices)],
            checkedPassageIds: [...inspected],
            fix,
          };
          if (claimRow.data.compound)
            result.explanation.push(
              "This sentence contains connected clauses. The assessment covers the original wording; review each clause.",
            );
          if (researchCandidates.length)
            result.explanation.push(
              `${researchCandidates.filter((c) => !c.assetId).length} candidate works have no assessable text. Candidate details are retained with the research results.`,
            );
          await db.transaction(async (tx) => {
            const current = await ownedRun(tx, ws, id, true);
            if (current.cancel_requested) throw new Error("Run cancelled.");
            const inserted = await tx.query(
              "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,claim_id) DO NOTHING RETURNING id",
              [
                result.id,
                ws,
                id,
                claim.id,
                claimRow.ordinal,
                JSON.stringify(result),
              ],
            );
            if (!inserted.rows.length) return;
            for (const e of evidence)
              await tx.query(
                "INSERT INTO evidence_links(id,workspace_id,finding_id,passage_id,data) VALUES($1,$2,$3,$4,$5)",
                [
                  randomUUID(),
                  ws,
                  result.id,
                  e.id,
                  JSON.stringify({ role: e.role, support: e.support }),
                ],
              );
            await tx.query(
              "INSERT INTO citation_links(id,workspace_id,claim_id,data) VALUES($1,$2,$3,$4)",
              [
                randomUUID(),
                ws,
                claim.id,
                JSON.stringify({
                  citations: claim.citations,
                  assetIds: cited.map((s) => s.selection.assetId),
                  status: citation,
                }),
              ],
            );
            await tx.query(
              "UPDATE runs SET coverage=jsonb_set(coverage,'{completedClaims}',to_jsonb((SELECT count(*)::int FROM findings WHERE run_id=$2 AND workspace_id=$1))),updated_at=now() WHERE workspace_id=$1 AND id=$2",
              [ws, id],
            );
            await event(tx, ws, id, "finding", {
              id: result.id,
              ordinal: claimRow.ordinal,
              processing: result.processing,
            });
          });
        }
        const sourceCoverage: any[] = [];
        for (const selection of sourceSelections) {
          const r = (
            await db.query(
              "SELECT coverage FROM extractions WHERE workspace_id=$1 AND id=$2",
              [ws, selection.extractionId],
            )
          ).rows[0];
          if (r)
            sourceCoverage.push({
              assetId: selection.assetId,
              extractionId: selection.extractionId,
              ...r.coverage,
              permittedPages: selection.pageRanges,
            });
        }
        await db.transaction(async (tx) => {
          const current = await ownedRun(tx, ws, id, true);
          if (current.cancel_requested) return;
          const partial = (
            await tx.query(
              "SELECT count(*)::int AS n FROM findings WHERE workspace_id=$1 AND run_id=$2 AND data->>'processing'<>'complete'",
              [ws, id],
            )
          ).rows[0].n;
          const isPartial =
            partial > 0 ||
            !claims.length ||
            current.coverage.unprocessedSpans?.length > 0 ||
            sourceCoverage.some(
              (c) => c.unreadablePages?.length || c.omittedPages?.length,
            ) ||
            (run.config.references || []).some(
              (r: any) => !resolvedReferenceIds.has(r.id),
            );
          const status = isPartial ? "partial" : "complete";
          await tx.query(
            "UPDATE runs SET status=$3,stage='done',coverage=coverage||$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND id=$2",
            [
              ws,
              id,
              status,
              JSON.stringify({
                sources: sourceCoverage,
                unresolvedReferences: (run.config.references || [])
                  .filter((r: any) => !resolvedReferenceIds.has(r.id))
                  .map((r: any) => ({ id: r.id, status: r.status })),
              }),
            ],
          );
          await event(tx, ws, id, status, { findings: claims.length });
        });
      },
    );
  } finally {
    clearInterval(monitor);
  }
}
