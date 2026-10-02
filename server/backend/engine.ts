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
import {
  selectClaims,
  claimKind,
  claimContext,
  citationRequirementForSpan,
} from "../claims.js";
import { planResearch } from "./research-plan.js";
import { citations, matchesCitation } from "../parse.js";
import { judgeClaim } from "../judge.js";
import { type Database, event } from "./db.js";
import { asset, checksum, validateSelection } from "./library.js";
import { retrieve } from "./retrieval.js";
import { ownedRun } from "./service.js";
import { providerContext } from "./providers.js";
import type { BlobStore } from "./storage.js";
import { research, resolveSelectedReferences } from "./research.js";
import { HttpError } from "./config.js";

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
    : selectClaims(text).candidates;
  return candidates.map((s) => {
    const context = claimContext(text, s.start, s.end);
    return {
      text: s.text,
      start: s.start,
      end: s.end,
      context,
      kind: claimKind(s.text, context),
      citationRequirement: citationRequirementForSpan(
        text,
        s.start,
        s.end,
        spans?.find((span) => span.start === s.start && span.end === s.end)
          ?.citationRequirement,
      ),
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

function requireEvidencePassage(assessment: Finding): Finding {
  if (assessment.status !== "supported" || assessment.evidence?.trim())
    return assessment;
  return {
    ...assessment,
    status: "uncertain",
    fix: undefined,
    explanation:
      "This support judgment did not include an exact assessed source passage. Support and automatic correction were withheld.",
  };
}

async function assessPacket(
  db: Database,
  ws: string,
  id: string,
  run: any,
  input: RunInput,
  claim: Claim,
  claimData: any,
  source: Source,
  packet: Passage[],
  metadata: any,
  eligibility: string,
  provenanceFrozen: boolean,
  academicRequired: boolean,
  judge: EngineDeps["judge"],
): Promise<Finding> {
  const cacheKey = checksum(
    JSON.stringify({
      claim: claimData,
      packet,
      model: run.config.model,
      prompt: run.config.prompt,
      policy: run.config.policy,
      source: metadata,
      eligibility,
      access: source.access,
      academicRequired,
      provenanceFrozen,
      sourcePolicy: input.sourcePolicy,
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
      !provenanceFrozen ||
      !input.allowProviderProcessing ||
      (academicRequired && eligibility !== "eligible")
    )
      assessment = {
        ...claim,
        method: "unverified",
        status: "uncertain",
        explanation: !provenanceFrozen
          ? "The original source metadata was not frozen for this older run. Start a new check."
          : !input.allowProviderProcessing
            ? "Provider processing is disabled."
            : "Academic source eligibility is not confirmed.",
      };
    else
      assessment = await judge(
        claim,
        source,
        packet.map((p) => p.text),
        { context: claimData.context },
      );
    assessment = requireEvidencePassage(assessment);
    assertEvidence(assessment, packet);
    const quotes = [...claim.text.matchAll(/["“]([^"”]{20,})["”]/g)].map((m) =>
      m[1].replace(/\s+/g, " "),
    );
    if (
      assessment.status === "supported" &&
      quotes.some(
        (q) => !packet.some((p) => p.text.replace(/\s+/g, " ").includes(q)),
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
      if (current.cancel_requested) throw new Error("Run cancelled.");
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
  return requireEvidencePassage(assessment);
}

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
                  skippedSpans: selectClaims(document.text).skipped.filter(
                    (s) =>
                      !input.claimSpans?.some(
                        (selected) =>
                          selected.start <= s.start && selected.end >= s.end,
                      ),
                  ),
                  excludedSpans: input.claimSpans
                    ? selectClaims(document.text)
                        .candidates.filter(
                          (s) =>
                            !input.claimSpans?.some(
                              (selected) =>
                                selected.start <= s.start &&
                                selected.end >= s.end,
                            ),
                        )
                        .map(({ start, end }) => ({ start, end }))
                    : [],
                  selectionPolicy: run.config.claimSelection,
                  documentCandidates: selectClaims(document.text).candidates
                    .length,
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
        const citationWorkflow =
          input.mode === "source_check" ||
          (input.mode === "discover" && input.citationOutput === "generate");
        const needsCitationEvidence = (claim: any) =>
          citationRequirementForSpan(
            document.text,
            claim.start,
            claim.end,
            claim.citationRequirement,
          ) === "required" || citations(claim.text).length > 0;
        const researchPlan = planResearch(
          claims
            .map((c) => c.data)
            .filter(
              (claim) =>
                !citationWorkflow ||
                (input.mode === "discover"
                  ? citationRequirementForSpan(
                      document.text,
                      claim.start,
                      claim.end,
                      claim.citationRequirement,
                    ) === "required"
                  : needsCitationEvidence(claim)),
            ),
          input.sourcePolicy,
        );
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
        const persistFinding = async (
          claimRow: any,
          result: BackendFinding,
          claimCitations: string[],
          citedAssetIds: string[],
        ) => {
          await db.transaction(async (tx) => {
            const current = await ownedRun(tx, ws, id, true);
            if (current.cancel_requested) throw new Error("Run cancelled.");
            const inserted = await tx.query(
              "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,claim_id) DO NOTHING RETURNING id",
              [
                result.id,
                ws,
                id,
                claimRow.id,
                claimRow.ordinal,
                JSON.stringify(result),
              ],
            );
            if (!inserted.rows.length) return;
            for (const e of result.evidence)
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
                claimRow.id,
                JSON.stringify({
                  citations: claimCitations,
                  assetIds: citedAssetIds,
                  status: result.citation,
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
        };
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
          claimRow.data = {
            ...claimRow.data,
            citationRequirement: citationRequirementForSpan(
              document.text,
              claimRow.data.start,
              claimRow.data.end,
              input.claimSpans?.find(
                (span) =>
                  span.start === claimRow.data.start &&
                  span.end === claimRow.data.end,
              )?.citationRequirement ?? claimRow.data.citationRequirement,
            ),
          };
          const commonKnowledge =
            claimRow.data.citationRequirement === "common_knowledge";
          const claim: Claim = {
            id: claimRow.id,
            ...claimRow.data,
            citations: citations(claimRow.data.text),
          };
          if (
            citationWorkflow &&
            commonKnowledge &&
            (!claim.citations.length || !sourceSelections.length)
          ) {
            const finding: BackendFinding = {
              id: randomUUID(),
              claim: claimRow.data,
              support: "not_verified",
              citation: "not_required",
              basis: "supplied_text",
              eligibility: "unknown",
              processing: "complete",
              evidence: [],
              explanation: [
                "Common knowledge does not require a citation. Factual accuracy was not assessed in this citation workflow.",
              ],
              checkedPassageIds: [],
            };
            if (claim.citations.length)
              finding.explanation.push(
                "The existing citation had no selected source text to compare. No additional evidence was researched for this common fact.",
              );
            await persistFinding(claimRow, finding, claim.citations, []);
            continue;
          }
          let selections = [...sourceSelections];
          let researchCandidates: any[] = [];
          let researchBudgetExhausted = false;
          const notices = [...referenceNotices];
          let suppliedSufficient = false;
          const plan = researchPlan.get(claim.start);
          const wholeAcademicText =
            input.sourcePolicy === "academic" ||
            (["matched", "public"].includes(input.sourcePolicy) &&
              plan?.route === "academic");
          const inspectWholeText =
            wholeAcademicText || input.sourcePolicy === "public";
          if (
            input.mode !== "source_check" &&
            input.allowProviderProcessing &&
            sourceSelections.length
          ) {
            const supports: Support[] = [];
            let failed = false;
            for (const selection of sourceSelections) {
              const live = await asset(db, ws, selection.assetId);
              const extraction = (
                await db.query(
                  "SELECT status FROM extractions WHERE workspace_id=$1 AND id=$2 AND asset_id=$3",
                  [ws, selection.extractionId, selection.assetId],
                )
              ).rows[0];
              const frozen = sourceSnapshots[selection.assetId];
              const current = frozen ? { ...live, ...frozen } : live;
              failed ||= extraction?.status !== "complete";
              const retrieved = await retrieve(
                db,
                ws,
                selection,
                claim.text,
                undefined,
                inspectWholeText ? Number.MAX_SAFE_INTEGER : 10,
                {
                  enabled: !!run.config.embeddingEnabled,
                  revision: run.config.embeddingRevision,
                  modelDirectory: run.config.embeddingModelDirectory,
                },
              );
              const source: Source = {
                id: selection.assetId,
                title: current.metadata.title,
                authors: current.metadata.authors || [],
                year: current.metadata.year || "",
                doi: current.metadata.doi,
                access: current.access,
                provider: "Persistent library",
                retrievedAt: String(current.created_at),
                passages: retrieved.passages.map((p) => p.text),
                publicationWarning: current.metadata.publicationWarning,
              };
              for (const packet of packets(retrieved.passages)) {
                const assessment = await assessPacket(
                  db,
                  ws,
                  id,
                  run,
                  input,
                  claim,
                  claimRow.data,
                  source,
                  packet,
                  current.metadata,
                  current.eligibility,
                  !!frozen,
                  input.sourcePolicy === "academic" ||
                    (input.sourcePolicy === "public" &&
                      plan?.route === "academic"),
                  deps.judge,
                );
                supports.push(supportOf(assessment));
                failed ||=
                  assessment.method === "unverified" ||
                  assessment.status === "uncertain" ||
                  ["abstract", "metadata", "unavailable"].includes(
                    current.access,
                  ) ||
                  !!current.metadata.publicationWarning;
              }
            }
            suppliedSufficient =
              !failed && combineSupport(supports) === "supported";
            if (suppliedSufficient)
              notices.push(
                "The selected source passages cover this claim. No external search was needed.",
              );
          }
          const externalPermitted = !["primary_text", "private"].includes(
            plan?.route || "academic",
          );
          if (
            !externalPermitted &&
            input.mode !== "source_check" &&
            !suppliedSufficient
          )
            notices.push(
              plan?.route === "private"
                ? "This personal statement needs your supplied evidence. It was not sent to public search."
                : "This claim needs the original work or relevant supplied passages. Upload that text to check it.",
            );
          if (
            input.mode !== "source_check" &&
            input.allowProviderProcessing &&
            !suppliedSufficient &&
            externalPermitted &&
            !(citationWorkflow && commonKnowledge)
          ) {
            const found = await deps
              .research(
                db,
                blobs,
                ws,
                id,
                run.config.researchQuery || plan?.query || claim.text,
                input.mode,
                run.config.limits.candidates,
                plan?.route === "public"
                  ? "public"
                  : plan?.route === "authoritative"
                    ? "authoritative"
                    : "academic",
              )
              .catch((error: unknown) => {
                if (
                  !(error instanceof HttpError) ||
                  error.status !== 429 ||
                  error.message !== "Run provider-call budget exhausted."
                )
                  throw error;
                researchBudgetExhausted = true;
                return {
                  selections: [],
                  candidates: [],
                  sourceSnapshots: {},
                  notices: [
                    "The research request limit was reached before this claim could be checked. Check a smaller section or select relevant materials.",
                  ],
                };
              });
            selections = [
              ...sourceSelections,
              ...found.selections.filter(
                (s) =>
                  !sourceSelections.some((old) => old.assetId === s.assetId),
              ),
            ];
            if ((plan?.size || 0) > 1)
              notices.push(
                `Research was shared by ${plan!.size} related claims. This claim was assessed separately.`,
              );
            researchCandidates = found.candidates;
            notices.push(...found.notices);
            rememberSnapshots(found.sourceSnapshots || {});
          }
          const sources = await Promise.all(
            selections.map(async (selection) => {
              const live = await asset(db, ws, selection.assetId);
              const extraction = (
                await db.query(
                  "SELECT status FROM extractions WHERE workspace_id=$1 AND id=$2 AND asset_id=$3",
                  [ws, selection.extractionId, selection.assetId],
                )
              ).rows[0];
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
                extractionComplete: extraction?.status === "complete",
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
            academicUncertainty = false,
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
            if (inspectWholeText) {
              const extraction = (
                await db.query(
                  "SELECT status FROM extractions WHERE workspace_id=$1 AND id=$2",
                  [ws, item.selection.extractionId],
                )
              ).rows[0];
              academicUncertainty ||=
                extraction?.status !== "complete" ||
                !["full_text", "uploaded"].includes(item.asset.access);
            }
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
              inspectWholeText ? Number.MAX_SAFE_INTEGER : 10,
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
              input.mode !== "source_check" &&
              !sourceSelections.some(
                (s) => s.assetId === item.selection.assetId,
              )
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
              const assessment = await assessPacket(
                db,
                ws,
                id,
                run,
                input,
                claim,
                claimRow.data,
                source,
                packet,
                item.asset.metadata,
                item.asset.eligibility,
                item.provenanceFrozen,
                input.sourcePolicy === "academic" ||
                  (input.sourcePolicy === "public" &&
                    plan?.route === "academic") ||
                  (input.sourcePolicy === "matched" &&
                    !sourceSelections.some(
                      (s) => s.assetId === item.selection.assetId,
                    ) &&
                    researchPlan.get(claim.start)?.route === "academic"),
                deps.judge,
              );
              assertEvidence(assessment, packet);
              attempts++;
              if (assessment.method === "unverified") semanticFailures++;
              if (assessment.method !== "unverified")
                for (const p of packet) inspected.add(p.id);
              const support = supportOf(assessment);
              academicUncertainty ||=
                inspectWholeText && assessment.status === "uncertain";
              if (!alternativeOnly) primaryAssessments.push(assessment.status);
              (alternativeOnly ? alternative : primary).push(support);
              const passage = packet.find(
                (p) => p.text === assessment.evidence,
              );
              const isCitedPacket = packet.some((p) =>
                retrieved.citedIds.includes(p.id),
              );
              if (isCited)
                citedSource.push(
                  passage || support !== "supported" ? support : "not_verified",
                );
              if (isCited && isCitedPacket)
                citedLocation.push(
                  (passage && retrieved.citedIds.includes(passage.id)) ||
                    support !== "supported"
                    ? support
                    : "not_verified",
                );
              if (passage) {
                evidence.push({ ...passage, role, support });
              }
              notices.push(assessment.explanation);
              if (
                (isCited ||
                  input.checkScope === "selected_library" ||
                  (!claim.citations.length &&
                    input.selectedSources.some(
                      (s) => s.assetId === item.selection.assetId,
                    ))) &&
                !ambiguous &&
                item.extractionComplete &&
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
          if (commonKnowledge) {
            if (claim.citations.length && citation !== "not_checked")
              notices.push(
                `Common knowledge does not require a citation. The existing citation was assessed as ${citation.replaceAll("_", " ")}.`,
              );
            citation = "not_required";
          }
          let support = combineSupport(primary);
          if (academicUncertainty && support === "supported")
            support = "not_verified";
          if (academicUncertainty)
            notices.push(
              wholeAcademicText
                ? "Academic content or extraction remained incomplete or uncertain. Complete support and automatic correction were withheld."
                : "Source content or extraction remained incomplete or uncertain. Complete support and automatic correction were withheld.",
            );
          if (semanticFailures && support === "supported") support = "partial";
          if (ambiguous && support === "supported") support = "not_verified";
          const fix =
            ["contradicted", "overstated", "partial"].includes(support) &&
            semanticFailures === 0 &&
            !academicUncertainty &&
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
              input.sourcePolicy === "user_supplied" ||
              suppliedSufficient ||
              !externalPermitted
                ? "supplied_text"
                : ["authoritative", "public"].includes(plan?.route || "")
                  ? "public_sources"
                  : "academic_research",
            ...(support === "not_verified"
              ? {
                  evidenceGap: researchBudgetExhausted
                    ? ("check_incomplete" as const)
                    : !retrievedPassages
                      ? ("source_unavailable" as const)
                      : wholeAcademicText &&
                          !sources.some(
                            (s) => s.asset.eligibility === "eligible",
                          )
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
          await persistFinding(
            claimRow,
            result,
            claim.citations,
            cited.map((source) => source.selection.assetId),
          );
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
