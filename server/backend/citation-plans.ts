import { validateFixEvidence } from "./verified-fixes.js";
import { randomUUID } from "node:crypto";
import type { BackendFinding, EvidenceLink } from "../../shared/backend.js";
import { bibliography, citationDois } from "../../shared/mla.js";
import {
  type CitationPlan,
  renderCitationPlan,
  escapeHtml,
  referenceHtml,
} from "../../shared/citation-plan.js";
import { type Database, type Sql, event } from "./db.js";
import { HttpError, notFound, limits } from "./config.js";
import { checksum } from "./library.js";
import { ownedRun } from "./service.js";
import {
  formatCitation,
  parseCitationOccurrences,
  citationWorkIdentity,
  type ReferenceMetadata,
} from "./citations.js";
import { assignmentProfiles } from "../../shared/citation-profiles.js";
import {
  citationRequirementForSpan,
  documentSentences,
} from "../../shared/claims.js";

const planVersion = "citation-plan-3";
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
const fingerprint = (value: unknown) => checksum(JSON.stringify(stable(value)));
function metadata(value: any): ReferenceMetadata {
  return {
    ...value,
    type:
      value.type ||
      (value.journal || value.containerTitle
        ? "article-journal"
        : value.isbn
          ? "book"
          : value.url
            ? "webpage"
            : "document"),
    authors: value.authorDetails?.length
      ? value.authorDetails.map((author: any) =>
          author.family || author.given
            ? { family: author.family, given: author.given }
            : { literal: author.literal || author.name },
        )
      : value.authors,
    containerTitle: value.containerTitle || value.journal,
  };
}
function snapshot(asset: any, extraction: any) {
  return {
    metadata: asset.metadata,
    checksum: asset.checksum,
    versionId: asset.version_id,
    eligibility: asset.eligibility,
    access: asset.access,
    status: asset.status,
    extractionId: extraction.id,
    extractionStatus: extraction.status,
    coverage: extraction.coverage,
  };
}
function matches(entry: string, source: ReferenceMetadata) {
  const doi = citationDois(entry)[0];
  if (doi)
    return (
      !!source.doi &&
      doi.toLowerCase() ===
        source.doi.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi.org\//, "")
    );
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  if (!source.title || !source.year) return false;
  const title = normalize(source.title);
  const normalized = normalize(entry);
  const titleAt = normalized.indexOf(title);
  if (title.length <= 8 || titleAt < 0) return false;
  const author = source.authors?.[0];
  const authorKey =
    typeof author === "string"
      ? author.includes(",")
        ? author.split(",")[0]
        : author
      : author?.family || author?.literal;
  if (authorKey && !normalized.slice(0, titleAt).includes(normalize(authorKey)))
    return false;
  // Title-only matches cannot justify replacing a different publication or edition.
  const titleEnd = entry
    .toLocaleLowerCase()
    .indexOf(source.title.toLocaleLowerCase());
  if (titleEnd < 0) return false;
  const publication = entry
    .slice(titleEnd + source.title.length)
    .split(/https?:\/\/|\bAccessed\b/i)[0];
  const years = publication.match(/\b(?:1[5-9]\d{2}|20\d{2}|21\d{2})\b/g) || [];
  if (years[0] !== String(source.year)) return false;
  const edition = /\b(\d+)(?:st|nd|rd|th)?\s+(?:ed\.?|edition)\b/i.exec(
    publication,
  )?.[1];
  if (edition && edition !== String(source.edition || "")) return false;
  if (source.edition && !edition) return false;
  return true;
}
export async function citationPlan(
  db: Database,
  ws: string,
  runId: string,
): Promise<CitationPlan> {
  return db.transaction(async (tx) => {
    const run = await ownedRun(tx, ws, runId, true);
    const applied = (
      await tx.query(
        "SELECT data FROM citation_plans WHERE workspace_id=$1 AND run_id=$2 AND data->>'status'='applied' ORDER BY created_at DESC LIMIT 1",
        [ws, runId],
      )
    ).rows[0];
    if (applied) return applied.data;
    if (["queued", "running"].includes(run.status))
      throw new HttpError(
        409,
        "Wait for the evidence check before reviewing citation edits.",
      );
    if (run.invalidated)
      throw new HttpError(
        409,
        "This check belongs to an older draft. Check the current version first.",
      );
    const version = (
      await tx.query(
        "SELECT v.*,d.current_version_id FROM document_versions v JOIN documents d ON d.workspace_id=v.workspace_id AND d.id=v.document_id WHERE v.workspace_id=$1 AND v.id=$2 AND d.archived_at IS NULL",
        [ws, run.document_version_id],
      )
    ).rows[0];
    if (!version || version.current_version_id !== run.document_version_id)
      throw new HttpError(
        409,
        "The draft changed. Check it again before preparing citations.",
      );
    const findings: BackendFinding[] = (
      await tx.query(
        "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
        [ws, runId],
      )
    ).rows.map((r) => r.data);
    const research = (
      await tx.query(
        "SELECT data FROM research_results WHERE workspace_id=$1 AND run_id=$2",
        [ws, runId],
      )
    ).rows;
    const frozen = { ...run.config.sourceSnapshots };
    for (const r of research)
      Object.assign(frozen, r.data.sourceSnapshots || {});
    const bib = bibliography(version.text);
    const profile = run.input.citationProfile || "mla9";
    const plan: CitationPlan = {
      id: randomUUID(),
      runId,
      documentId: version.document_id,
      documentVersionId: version.id,
      profile,
      profileVersion: `${planVersion}:${profile}:1`,
      status: "ready",
      operations: [],
      references: [],
      bibliography: {
        start: bib.heading?.start ?? version.text.length,
        end: version.text.length,
        heading: bib.heading?.text.trim() || "Works Cited",
        entries: bib.entries.map((e) => ({
          original: e.text,
          start: e.start,
          end: e.end,
        })),
      },
      gaps: [],
      exemptions: [],
      warnings: [],
      coverage: {
        totalClaims: findings.length,
        citableClaims: 0,
        citationExemptClaims: 0,
      },
      previewText: version.text,
    };
    const snapshots: Record<string, any> = {};
    const sources = new Map<
      string,
      { row: any; extraction: any; metadata: ReferenceMetadata }
    >();
    const allEvidence = findings.flatMap((f) => f.evidence || []);
    const selections = [
      ...(run.input.selectedSources || []),
      ...(run.config.resolvedSources || []),
      ...allEvidence,
    ];
    for (const evidence of selections) {
      if (sources.has(evidence.assetId)) continue;
      const row = (
        await tx.query(
          "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL AND status='ready'",
          [ws, evidence.assetId],
        )
      ).rows[0];
      const extraction = (
        await tx.query(
          "SELECT * FROM extractions WHERE workspace_id=$1 AND id=$2 AND asset_id=$3",
          [ws, evidence.extractionId, evidence.assetId],
        )
      ).rows[0];
      if (
        !row ||
        !extraction ||
        extraction.status !== "complete" ||
        !frozen[row.id] ||
        fingerprint(frozen[row.id].metadata) !== fingerprint(row.metadata)
      )
        continue;
      sources.set(row.id, {
        row,
        extraction,
        metadata: metadata(row.metadata),
      });
      snapshots[row.id] = { state: snapshot(row, extraction), passages: {} };
    }
    const references = [...sources].map(([id, s]) => ({
      id,
      metadata: s.metadata,
    }));
    const frozenReferences = (run.config.references || []) as any[];
    const importedReferences = frozenReferences.map((ref) => ({
      id: ref.asset_id || ref.resolvedAssetId || ref.id,
      metadata: {
        ...ref.parsed,
        authors: ref.parsed?.authorDetails || ref.parsed?.authors || [],
      },
    }));
    // Matching a supplied bibliography never implies that its full text exists.
    const auditReferences = [
      ...references.filter(
        (r) => !importedReferences.some((i) => i.id === r.id),
      ),
      ...importedReferences,
    ];
    const occurrences = parseCitationOccurrences(version.text, auditReferences);
    const sentences = documentSentences(version.text);
    const needsAttribution = (occurrence: (typeof occurrences)[number]) => {
      const claim = findings.find(
        (f) =>
          f.claim.start <= occurrence.start && f.claim.end >= occurrence.end,
      )?.claim;
      const sentence = sentences.find(
        (s) => s.start <= occurrence.start && s.end >= occurrence.end,
      );
      return (
        citationRequirementForSpan(
          version.text,
          claim?.start ?? sentence?.start ?? occurrence.start,
          claim?.end ?? sentence?.end ?? occurrence.end,
          claim?.citationRequirement,
        ) !== "common_knowledge"
      );
    };
    const requiredOccurrences = occurrences.filter(needsAttribution);
    const cited = new Set(
      occurrences.flatMap((o) =>
        o.items
          .filter((i) => i.status === "matched" && i.sourceIds.length === 1)
          .flatMap((i) => i.sourceIds),
      ),
    );
    plan.audit = {
      occurrences: occurrences.map((o) => ({
        id: o.id,
        text: o.raw,
        start: o.start,
        end: o.end,
        form: o.form,
        status: o.items.some((i) => i.status === "ambiguous")
          ? "ambiguous"
          : o.items.every((i) => i.status === "matched")
            ? "matched"
            : "unmatched",
        sourceIds: o.items.flatMap((i) => i.sourceIds),
        locator: o.items
          .map((i) => i.locator)
          .filter(Boolean)
          .join(", "),
        citation:
          findings.find((f) => f.claim.start <= o.start && f.claim.end >= o.end)
            ?.citation || "not_checked",
      })),
      bibliographyIssues: [],
      counts: {
        occurrences: occurrences.length,
        distinctCitedWorks: new Set(
          [...cited].map(
            (id) =>
              citationWorkIdentity(
                auditReferences.find((r) => r.id === id)?.metadata || {},
              ) || id,
          ),
        ).size,
        bibliographyEntries: bib.entries.length || frozenReferences.length,
      },
    };
    for (const ref of frozenReferences) {
      if (
        (!ref.asset_id && !ref.resolvedAssetId) ||
        !["full_text", "uploaded"].includes(
          ref.access ||
            sources.get(ref.asset_id || ref.resolvedAssetId)?.row.access ||
            "unavailable",
        )
      )
        plan.audit.bibliographyIssues.push({
          kind: "source_access",
          text: ref.parsed?.title || ref.original,
          detail:
            ref.resolutionNotice ||
            "This reference identifies a work, but its full text was not available for evidence checking. Allow retrieval of cited works or upload the article.",
          referenceIds: [ref.id],
        });
      for (const warning of ref.identityWarnings || [])
        plan.audit.bibliographyIssues.push({
          kind: "identity",
          text: ref.parsed?.title || ref.original,
          detail: warning,
          referenceIds: [ref.id],
        });
    }
    for (const occurrence of occurrences.filter((o) => !needsAttribution(o)))
      plan.audit.bibliographyIssues.push({
        kind: "unnecessary_citation",
        text: occurrence.raw,
        detail:
          "Common knowledge does not require this citation. The existing text is preserved for review.",
        referenceIds: occurrence.items.flatMap((item) => item.sourceIds),
      });
    for (const [id, source] of sources) {
      const formatted = formatCitation(source.metadata, {
        id,
        profile,
        references,
      });
      plan.warnings.push(...formatted.warnings);
      if (formatted.missingMetadata.length) {
        plan.audit.bibliographyIssues.push({
          kind: "metadata",
          text: source.metadata.title || "Source",
          detail: `Confirm missing metadata: ${formatted.missingMetadata.join(", ")}.`,
          referenceIds: [id],
        });
        continue;
      }
      plan.references.push({
        id,
        assetId: id,
        identity:
          citationWorkIdentity(source.metadata) ||
          `${id}:${source.row.version_id}`,
        text: formatted.text,
        html: formatted.html,
      });
    }
    const generation =
      run.input.mode === "discover" &&
      run.input.citationOutput === "generate" &&
      profile !== "classroom";
    if (profile === "classroom")
      plan.warnings.push(
        "This classroom profile audits citations. Make corrections in the required original document; Proof cannot certify its editing history.",
      );
    for (const finding of findings) {
      if (
        citationRequirementForSpan(
          version.text,
          finding.claim.start,
          finding.claim.end,
          finding.claim.citationRequirement,
        ) === "common_knowledge"
      ) {
        plan.exemptions!.push({
          findingId: finding.id,
          claim: finding.claim.text,
          reason:
            "Common knowledge does not require a citation. This exemption does not establish factual accuracy.",
        });
        plan.coverage.citationExemptClaims!++;
        continue;
      }
      const gap = (reason: string) =>
        plan.gaps.push({
          findingId: finding.id,
          claim: finding.claim.text,
          reason,
        });
      if (
        finding.support !== "supported" ||
        finding.processing !== "complete" ||
        finding.citation === "ambiguous"
      ) {
        gap(
          "The claim has unresolved support, conflicting evidence or an incomplete check. No citation was generated.",
        );
        continue;
      }
      const existingSourceIds = new Set(
        parseCitationOccurrences(finding.claim.text, references).flatMap((o) =>
          o.items
            .filter((i) => i.status === "matched")
            .flatMap((i) => i.sourceIds),
        ),
      );
      const existingOccurrences = parseCitationOccurrences(
        finding.claim.text,
        references,
      );
      const terminalOccurrence =
        existingOccurrences.length === 1 &&
        existingOccurrences[0].form === "parenthetical"
          ? existingOccurrences[0]
          : undefined;
      const misplaced =
        terminalOccurrence &&
        /\.(["”'’]?)\s*$/.test(
          finding.claim.text.slice(0, terminalOccurrence.start),
        ) &&
        /^\s*\.?\s*$/.test(finding.claim.text.slice(terminalOccurrence.end));
      const candidates = finding.evidence.filter(
        (e) =>
          e.support === "supported" &&
          sources.has(e.assetId) &&
          (finding.citation !== "correct" || existingSourceIds.has(e.assetId)),
      );
      const evidence =
        candidates.find((e) => e.labelStatus !== "unknown" && e.pageLabel) ||
        candidates[0];
      if (!evidence) {
        gap("No complete, current source with inspected support is available.");
        continue;
      }
      const source = sources.get(evidence.assetId)!;
      if (
        (run.input.sourcePolicy === "academic" || profile === "classroom") &&
        source.row.eligibility !== "eligible"
      ) {
        gap(
          "The supporting source does not meet the required academic eligibility policy.",
        );
        continue;
      }
      const passage = (
        await tx.query(
          "SELECT p.*,g.label,g.label_status,g.page_index FROM source_passages p JOIN source_pages g ON g.workspace_id=p.workspace_id AND g.id=p.page_id WHERE p.workspace_id=$1 AND p.id=$2 AND p.extraction_id=$3",
          [ws, evidence.id, evidence.extractionId],
        )
      ).rows[0];
      if (
        !passage ||
        passage.text !== evidence.text ||
        passage.start_offset !== evidence.start ||
        passage.end_offset !== evidence.end
      ) {
        gap("The stored evidence passage no longer matches its source.");
        continue;
      }
      const hasPage =
        passage.label_status !== "unknown" &&
        passage.label &&
        evidence.pageLabel === passage.label;
      if (profile === "classroom" && !hasPage) {
        gap(
          "A verified printed page number is required. The PDF page index cannot substitute for it.",
        );
        continue;
      }
      const formatted = formatCitation(source.metadata, {
        id: evidence.assetId,
        profile,
        references,
        ...(hasPage
          ? {
              locator: {
                kind: "page" as const,
                value: passage.label,
                verified: true as const,
              },
            }
          : {}),
      });
      if (formatted.missingMetadata.length) {
        gap(
          `Citation metadata needs confirmation: ${formatted.missingMetadata.join(", ")}.`,
        );
        continue;
      }
      const id = evidence.assetId;
      if (!plan.references.some((r) => r.id === id))
        plan.references.push({
          id,
          assetId: id,
          identity:
            citationWorkIdentity(source.metadata) ||
            `${id}:${source.row.version_id}`,
          text: formatted.text,
          html: formatted.html,
        });
      snapshots[id].passages[evidence.id] = fingerprint({
        text: passage.text,
        start: passage.start_offset,
        end: passage.end_offset,
        label: passage.label,
        labelStatus: passage.label_status,
      });
      plan.coverage.citableClaims++;
      if (!hasPage)
        plan.warnings.push(
          "Some sources have no verified printed pagination. Those MLA citations omit page numbers; inspect the linked evidence passage.",
        );
      if (
        profile !== "classroom" &&
        finding.citation === "correct" &&
        !bib.entries.some((entry) => matches(entry.text, source.metadata))
      ) {
        if (
          !plan.operations.some(
            (op) =>
              op.kind === "bibliography" &&
              op.original === "" &&
              op.referenceIds.includes(id),
          )
        )
          plan.operations.push({
            id: randomUUID(),
            findingId: finding.id,
            kind: "bibliography",
            start: version.text.length,
            end: version.text.length,
            original: "",
            replacement: formatted.text,
            referenceIds: [id],
            evidence: [evidence],
            explanation: [
              "Add the matching bibliography entry for this verified existing citation.",
            ],
          });
      }
      if (
        profile === "classroom" ||
        (!generation && finding.citation === "missing") ||
        (finding.citation === "correct" && !misplaced)
      )
        continue;
      if (
        finding.claim.start < 0 ||
        finding.claim.end > plan.bibliography.start ||
        version.text.slice(finding.claim.start, finding.claim.end) !==
          finding.claim.text
      ) {
        gap("The claim span no longer matches the draft.");
        continue;
      }
      const original = finding.claim.text;
      // A repair is offered only for a single existing citation. Multiple citations
      // require an explicit source choice; never replace a whole combined citation.
      const occurrences = parseCitationOccurrences(original, references);
      let replacement: string;
      if (
        finding.citation !== "missing" &&
        !(generation && !occurrences.length)
      ) {
        if (
          occurrences.length !== 1 ||
          occurrences[0].items.length !== 1 ||
          occurrences[0].items[0].status === "ambiguous" ||
          occurrences[0].form === "doi"
        ) {
          gap(
            "The existing citation needs manual disambiguation before a safe replacement.",
          );
          continue;
        }
        const occurrence = occurrences[0];
        let citation = formatted.inText;
        if (occurrence.form === "narrative") {
          if (!occurrence.items[0].sourceIds.includes(id)) {
            gap("Changing this narrative attribution requires manual review.");
            continue;
          }
          const narrative = formatCitation(source.metadata, {
            id,
            profile,
            references,
            narrative: true,
            ...(hasPage
              ? {
                  locator: {
                    kind: "page" as const,
                    value: passage.label,
                    verified: true as const,
                  },
                }
              : {}),
          });
          const at = occurrence.raw.lastIndexOf("(");
          if (at < 0) {
            gap("This narrative citation cannot be repaired automatically.");
            continue;
          }
          citation = occurrence.raw.slice(0, at) + narrative.inText;
        }
        replacement =
          original.slice(0, occurrence.start) +
          citation +
          original.slice(occurrence.end);
        if (misplaced) {
          const prefix = original.slice(0, occurrence.start);
          const punctuation = /\.(["”'’]?)\s*$/.exec(prefix)!;
          replacement =
            prefix.slice(0, punctuation.index).trimEnd() +
            punctuation[1] +
            " " +
            citation +
            ".";
        }
      } else {
        if (occurrences.length || /\([^()]+\)/.test(original)) {
          gap(
            "A parenthetical passage needs review before inserting another citation.",
          );
          continue;
        }
        const quotedEnd = original.match(/([.!?])(["”'’])\s*$/);
        const end = original.match(/([.!?])\s*$/);
        replacement = quotedEnd
          ? original.slice(0, quotedEnd.index) +
            (quotedEnd[1] === "." ? "" : quotedEnd[1]) +
            quotedEnd[2] +
            " " +
            formatted.inText +
            "."
          : end
            ? original.slice(0, end.index).trimEnd() +
              " " +
              formatted.inText +
              end[0]
            : original.trimEnd() + " " + formatted.inText;
      }
      if (replacement !== original)
        plan.operations.push({
          id: randomUUID(),
          findingId: finding.id,
          kind: "citation",
          start: finding.claim.start,
          end: finding.claim.end,
          original,
          replacement,
          referenceIds: [id],
          evidence: [evidence],
          explanation: [
            "This citation identifies the inspected supporting source.",
            ...formatted.warnings,
          ],
        });
    }
    for (let i = 0; i < bib.entries.length; i++) {
      const entry = bib.entries[i];
      const candidates = [
        ...new Map(
          plan.references
            .filter((r) =>
              matches(entry.text, sources.get(r.assetId)!.metadata),
            )
            .map((r) => [r.identity, r]),
        ).values(),
      ];
      if (candidates.length !== 1) {
        plan.warnings.push(
          "A bibliography entry could not be matched uniquely to verified source metadata. It will remain unchanged.",
        );
        plan.audit.bibliographyIssues.push({
          kind: candidates.length ? "ambiguous" : "unmatched",
          text: entry.text,
          detail: "Match this bibliography entry to one verified source.",
          referenceIds: candidates.map((r) => r.id),
        });
        continue;
      }
      const ref = candidates[0];
      plan.bibliography.entries[i].referenceId = ref.id;
      if (entry.text !== ref.text)
        plan.audit.bibliographyIssues.push({
          kind: "format",
          text: entry.text,
          detail: `Selected profile: ${ref.text}`,
          referenceIds: [ref.id],
        });
      if (
        ![...cited].some(
          (id) =>
            plan.references.find((r) => r.id === id)?.identity === ref.identity,
        )
      )
        plan.audit.bibliographyIssues.push({
          kind: "unused",
          text: entry.text,
          detail:
            "No unambiguous in-text citation to this work was found. It will be preserved.",
          referenceIds: [ref.id],
        });
      if (
        plan.bibliography.entries
          .slice(0, i)
          .some((e) => e.referenceId === ref.id)
      )
        plan.audit.bibliographyIssues.push({
          kind: "duplicate",
          text: entry.text,
          detail:
            "This work occurs more than once in the bibliography. Review before removing an entry.",
          referenceIds: [ref.id],
        });
      if (profile !== "classroom" && entry.text !== ref.text)
        plan.operations.push({
          id: randomUUID(),
          kind: "bibliography",
          start: entry.start,
          end: entry.end,
          original: entry.text,
          replacement: ref.text,
          referenceIds: [ref.id],
          evidence: [],
          explanation: [
            "Format this matched entry using the selected citation profile and verified metadata.",
          ],
        });
    }
    for (const id of cited)
      if (
        !plan.bibliography.entries.some(
          (e) =>
            plan.references.find((r) => r.id === e.referenceId)?.identity ===
            plan.references.find((r) => r.id === id)?.identity,
        )
      )
        plan.audit.bibliographyIssues.push({
          kind: "missing",
          text: sources.get(id)?.metadata.title || "Cited work",
          detail: "This cited work has no matching bibliography entry.",
          referenceIds: [id],
        });
    if (profile === "classroom" && run.input.assignmentProfile) {
      const count = (s: string) => (s.match(/\S+/g) || []).length;
      const bodyAndTitle = version.text.slice(0, plan.bibliography.start);
      const first = bodyAndTitle.split("\n")[0];
      const title =
        first.trim() &&
        !/[.!?]$/.test(first.trim()) &&
        bodyAndTitle.startsWith(`${first}\n\n`)
          ? count(first)
          : 0;
      const combined = count(bodyAndTitle);
      plan.audit.wordCounts = {
        body: combined - title,
        title,
        bibliography: count(version.text.slice(plan.bibliography.start)),
        combined,
        convention: "body-and-title",
      };
      const checks: NonNullable<CitationPlan["audit"]>["assignmentChecks"] = [];
      const check = (
        label: string,
        status: "pass" | "issue" | "manual",
        detail: string,
      ) => checks.push({ label, status, detail });
      if (run.input.assignmentProfile === "draft") {
        const target = assignmentProfiles.draft;
        check(
          "600-word exploratory draft",
          combined === target.words ? "pass" : "issue",
          `${combined} body-and-title words; body ${combined - title}, title ${title}. The teacher has not specified whether the title counts.`,
        );
        check(
          "Five in-text citations",
          requiredOccurrences.length >= target.citations ? "pass" : "issue",
          `${requiredOccurrences.length} source-dependent citation occurrences; target ${target.citations}. ${occurrences.length - requiredOccurrences.length} common-knowledge citations are excluded. Source and locator checks remain separate.`,
        );
        const requiredCited = new Set(
          requiredOccurrences.flatMap((o) =>
            o.items
              .filter((item) => item.status === "matched")
              .flatMap((item) => item.sourceIds),
          ),
        );
        const academicAssets = [...requiredCited].filter(
          (id) =>
            sources.get(id)?.row.eligibility === "eligible" &&
            sources.get(id)?.metadata.type === "article-journal",
        );
        const academic = [
          ...new Map(
            academicAssets.map((id) => [
              citationWorkIdentity(sources.get(id)!.metadata) || id,
              id,
            ]),
          ).values(),
        ];
        check(
          "Three distinct academic articles",
          academic.length >= target.academicArticles ? "pass" : "issue",
          `${academic.length} unambiguously cited, eligible journal works. DOI is not required for identity.`,
        );
        const locatorsVerified =
          plan.audit.occurrences.length > 0 &&
          plan.audit.occurrences.every(
            (o) => o.locator && o.citation === "correct",
          );
        check(
          "Printed citation pages",
          locatorsVerified ? "pass" : "issue",
          "Each citation needs a verified printed page and supporting evidence. A syntactically valid number does not verify its passage.",
        );
        const lengths = await Promise.all(
          academic.map(async (id) =>
            Number(
              (
                await tx.query(
                  "SELECT count(*)::int AS n FROM source_pages WHERE workspace_id=$1 AND extraction_id=$2",
                  [ws, sources.get(id)!.extraction.id],
                )
              ).rows[0].n,
            ),
          ),
        );
        check(
          "Article length",
          lengths.length > 0 &&
            lengths.every((n) => n >= target.minimumArticlePages)
            ? "pass"
            : "issue",
          "Every cited academic article must have at least three readable pages. Metadata page ranges alone do not prove complete access.",
        );
        check(
          "Individual research question",
          /\b(?:our group|group research question|our team)\b/i.test(
            bodyAndTitle,
          )
            ? "issue"
            : "manual",
          "Use the individual question. Review the argument and individual focus manually.",
        );
      } else {
        const target = assignmentProfiles.bibliography;
        check(
          "Four bibliography entries",
          bib.entries.length === target.bibliographyEntries ? "pass" : "issue",
          `${bib.entries.length} entries. This is the separate four-source assignment.`,
        );
        const matchedCopies = plan.bibliography.entries.flatMap((e) => {
          const source = e.referenceId ? sources.get(e.referenceId) : undefined;
          return source ? [source] : [];
        });
        const matched = [
          ...new Map(
            matchedCopies.map((s) => [
              citationWorkIdentity(s.metadata) || s.row.id,
              s,
            ]),
          ).values(),
        ];
        check(
          "Four full PDF links",
          matched.length === target.fullPdfs &&
            matched.every(
              (s) => s!.row.media_type === "application/pdf" && s!.metadata.url,
            )
            ? "manual"
            : "issue",
          "Verify that each submitted online link opens the complete PDF. A local file link is insufficient.",
        );
      }
      check(
        "Bibliography heading",
        bib.heading &&
          /^(?:works cited|bibliography)$/i.test(bib.heading.text.trim())
          ? "pass"
          : "issue",
        "Use Works Cited or Bibliography.",
      );
      check(
        "Original-document editing history",
        "manual",
        "The assignment requires writing in its original Google Doc and at least four hours of editing evidence. Proof cannot certify this history.",
      );
      check(
        "Font and spacing",
        "manual",
        "Verify Times New Roman and double spacing in the original document. Plain text cannot establish its typography.",
      );
      plan.audit.assignmentChecks = checks;
    }
    plan.warnings = [...new Set(plan.warnings)];
    try {
      plan.previewText = renderCitationPlan(
        version.text,
        plan,
        plan.operations.map((o) => o.id),
      );
    } catch {
      plan.operations = [];
      plan.warnings.push(
        "The proposed edits overlap. Review these citations individually.",
      );
    }
    const hash = fingerprint({
      versionId: version.id,
      input: run.input,
      findings,
      snapshots,
      profileVersion: plan.profileVersion,
    });
    const prior = (
      await tx.query(
        "SELECT data FROM citation_plans WHERE workspace_id=$1 AND run_id=$2 AND fingerprint=$3",
        [ws, runId, hash],
      )
    ).rows[0];
    if (prior) return prior.data;
    await tx.query(
      "INSERT INTO citation_plans(id,workspace_id,run_id,document_version_id,fingerprint,data,source_snapshots) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        plan.id,
        ws,
        runId,
        version.id,
        hash,
        JSON.stringify(plan),
        JSON.stringify(snapshots),
      ],
    );
    return plan;
  });
}

function validKey(key: string) {
  if (!key || key.length > 200)
    throw new HttpError(
      400,
      "Provide an Idempotency-Key header of 1 to 200 characters.",
    );
}
export async function editReceipt(
  tx: Sql,
  ws: string,
  documentId: string,
  key: string,
  hash: string,
) {
  validKey(key);
  const prior = (
    await tx.query(
      "SELECT * FROM document_edit_receipts WHERE workspace_id=$1 AND document_id=$2 AND idempotency_key=$3",
      [ws, documentId, key],
    )
  ).rows[0];
  if (prior && prior.request_hash !== hash)
    throw new HttpError(
      409,
      "This idempotency key was used for different edits.",
    );
  return prior?.result;
}
export async function saveEdit(
  tx: Sql,
  ws: string,
  documentId: string,
  versionId: string,
  text: string,
  key: string,
  hash: string,
) {
  if (!text || text.length > limits.draftCharacters)
    throw new HttpError(
      400,
      "The edited document exceeds the draft size limit.",
    );
  const id = randomUUID();
  await tx.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [id, ws, documentId, text],
  );
  await tx.query(
    "UPDATE documents SET current_version_id=$3 WHERE workspace_id=$1 AND id=$2",
    [ws, documentId, id],
  );
  await tx.query(
    "UPDATE runs SET invalidated=true WHERE workspace_id=$1 AND document_version_id=$2",
    [ws, versionId],
  );
  const result = { id, text };
  await tx.query(
    "INSERT INTO document_edit_receipts(workspace_id,document_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4,$5)",
    [ws, documentId, key, hash, JSON.stringify(result)],
  );
  return result;
}
export async function applyCitationPlan(
  db: Database,
  ws: string,
  documentId: string,
  planId: string,
  versionId: string,
  operationIds: string[],
  key: string,
) {
  validKey(key);
  if (
    !operationIds.length ||
    operationIds.length > 200 ||
    new Set(operationIds).size !== operationIds.length
  )
    throw new HttpError(
      400,
      "Select between 1 and 200 distinct proposed changes.",
    );
  const hash = fingerprint({
    kind: "citations",
    planId,
    versionId,
    operationIds: [...operationIds].sort(),
  });
  return db.transaction(async (tx) => {
    const doc = (
      await tx.query(
        "SELECT * FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
        [ws, documentId],
      )
    ).rows[0];
    if (!doc) throw notFound();
    const prior = await editReceipt(tx, ws, documentId, key, hash);
    if (prior) return prior;
    const row = (
      await tx.query(
        "SELECT * FROM citation_plans WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ws, planId],
      )
    ).rows[0];
    const plan: CitationPlan | undefined = row?.data;
    if (!plan || plan.documentId !== documentId) throw notFound();
    if (
      doc.current_version_id !== versionId ||
      plan.documentVersionId !== versionId ||
      plan.status !== "ready"
    )
      throw new HttpError(
        409,
        "The draft changed or this citation plan was already applied. Review a new check.",
      );
    const run = await ownedRun(tx, ws, plan.runId);
    if (
      run.invalidated ||
      plan.profile === "classroom" ||
      plan.profileVersion !==
        `${planVersion}:${run.input.citationProfile || "mla9"}:1`
    )
      throw new HttpError(
        409,
        "This citation plan is no longer valid for automatic changes.",
      );
    for (const [assetId, frozen] of Object.entries(row.source_snapshots) as [
      string,
      any,
    ][]) {
      const asset = (
        await tx.query(
          "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [ws, assetId],
        )
      ).rows[0];
      const extraction = (
        await tx.query(
          "SELECT * FROM extractions WHERE workspace_id=$1 AND id=$2 AND asset_id=$3",
          [ws, frozen.state.extractionId, assetId],
        )
      ).rows[0];
      if (
        !asset ||
        !extraction ||
        fingerprint(snapshot(asset, extraction)) !== fingerprint(frozen.state)
      )
        throw new HttpError(
          409,
          "A source or its metadata changed. Review the citations again.",
        );
      for (const [passageId, expected] of Object.entries(frozen.passages)) {
        const passage = (
          await tx.query(
            "SELECT p.*,g.label,g.label_status FROM source_passages p JOIN source_pages g ON g.workspace_id=p.workspace_id AND g.id=p.page_id WHERE p.workspace_id=$1 AND p.id=$2",
            [ws, passageId],
          )
        ).rows[0];
        if (
          !passage ||
          fingerprint({
            text: passage.text,
            start: passage.start_offset,
            end: passage.end_offset,
            label: passage.label,
            labelStatus: passage.label_status,
          }) !== expected
        )
          throw new HttpError(
            409,
            "The inspected source passage changed. Review the citations again.",
          );
      }
    }
    const version = (
      await tx.query(
        "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2 AND document_id=$3",
        [ws, versionId, documentId],
      )
    ).rows[0];
    if (!version) throw notFound();
    let text: string;
    try {
      text = renderCitationPlan(version.text, plan, operationIds);
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error
          ? error.message
          : "Citation edits could not be applied.",
      );
    }
    const result = await saveEdit(
      tx,
      ws,
      documentId,
      versionId,
      text,
      key,
      hash,
    );
    await tx.query(
      "UPDATE citation_plans SET data=$3 WHERE workspace_id=$1 AND id=$2",
      [
        ws,
        planId,
        JSON.stringify({
          ...plan,
          status: "applied",
          resultVersionId: result.id,
          previewText: text,
          appliedOperationIds: operationIds,
          deferredOperationIds: plan.operations
            .filter((op) => !operationIds.includes(op.id))
            .map((op) => op.id),
          gaps: [
            ...plan.gaps,
            ...plan.operations
              .filter((op) => !operationIds.includes(op.id))
              .map((op) => ({
                findingId: op.findingId || op.id,
                claim: op.original || "Bibliography entry",
                reason:
                  "This citation change was not applied. Run a new check to review it against the saved document.",
              })),
          ],
        }),
      ],
    );
    await event(tx, ws, plan.runId, "citations_applied", {
      versionId: result.id,
      operationIds,
    });
    return result;
  });
}

export async function applyVerifiedFixes(
  db: Database,
  ws: string,
  documentId: string,
  versionId: string,
  findingIds: string[],
  key: string,
) {
  validKey(key);
  if (
    !findingIds.length ||
    findingIds.length > 100 ||
    new Set(findingIds).size !== findingIds.length
  )
    throw new HttpError(
      400,
      "Select between 1 and 100 distinct verified fixes.",
    );
  const hash = fingerprint({
    kind: "fixes",
    versionId,
    findingIds: [...findingIds].sort(),
  });
  return db.transaction(async (tx) => {
    const doc = (
      await tx.query(
        "SELECT * FROM documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
        [ws, documentId],
      )
    ).rows[0];
    if (!doc) throw notFound();
    const prior = await editReceipt(tx, ws, documentId, key, hash);
    if (prior) return prior;
    if (doc.current_version_id !== versionId)
      throw new HttpError(
        409,
        "The draft changed. Review a new check before applying these edits.",
      );
    const version = (
      await tx.query(
        "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2 AND document_id=$3",
        [ws, versionId, documentId],
      )
    ).rows[0];
    if (!version) throw notFound();
    const fixes = [];
    for (const id of findingIds) {
      const row = (
        await tx.query(
          "SELECT f.data,r.document_version_id,r.invalidated,r.config FROM findings f JOIN runs r ON r.workspace_id=f.workspace_id AND r.id=f.run_id WHERE f.workspace_id=$1 AND f.id=$2",
          [ws, id],
        )
      ).rows[0];
      const fix = row?.data.fix;
      if (
        !fix ||
        row.invalidated ||
        row.document_version_id !== versionId ||
        fix.documentVersionId !== versionId ||
        row.data.processing !== "complete" ||
        row.data.citation === "ambiguous"
      )
        throw new HttpError(
          409,
          "A selected finding has no current verified edit.",
        );
      if (
        !Number.isInteger(fix.start) ||
        !Number.isInteger(fix.end) ||
        fix.start < 0 ||
        fix.end <= fix.start ||
        fix.end > version.text.length ||
        version.text.slice(fix.start, fix.end) !== fix.original
      )
        throw new HttpError(409, "An edit span no longer matches the draft.");
      await validateFixEvidence(tx, ws, row.data, row.config);
      fixes.push(fix);
    }
    fixes.sort((a, b) => a.start - b.start);
    for (let i = 1; i < fixes.length; i++)
      if (fixes[i - 1].end > fixes[i].start)
        throw new HttpError(409, "The selected verified edits overlap.");
    let text = version.text;
    for (const fix of [...fixes].reverse())
      text = text.slice(0, fix.start) + fix.replacement + text.slice(fix.end);
    return saveEdit(tx, ws, documentId, versionId, text, key, hash);
  });
}

export async function documentExport(
  db: Database,
  ws: string,
  documentId: string,
  versionId?: string,
) {
  const row = (
    await db.query(
      "SELECT v.*,d.title FROM documents d JOIN document_versions v ON v.workspace_id=d.workspace_id AND v.document_id=d.id AND v.id=COALESCE($3::uuid,d.current_version_id) WHERE d.workspace_id=$1 AND d.id=$2 AND d.archived_at IS NULL",
      [ws, documentId, versionId || null],
    )
  ).rows[0];
  if (!row) throw notFound();
  const applied = (
    await db.query(
      "SELECT data FROM citation_plans WHERE workspace_id=$1 AND data->>'documentId'=$2 AND data->>'resultVersionId'=$3 ORDER BY created_at DESC LIMIT 1",
      [ws, documentId, row.id],
    )
  ).rows[0]?.data as CitationPlan | undefined;
  const bib = bibliography(row.text);
  const body = row.text.slice(0, bib.heading?.start ?? row.text.length);
  const entries = bib.entries
    .map((entry) => {
      const reference = applied?.references.find((r) => r.text === entry.text);
      return `<li>${reference ? referenceHtml(reference.html) : escapeHtml(entry.text)}</li>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(row.title)}</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font:18px/2 Georgia,serif;color:#213c30}p{white-space:pre-wrap}li{list-style:none;padding-left:2em;text-indent:-2em;margin-bottom:1em}ul{padding:0}a{overflow-wrap:anywhere}</style></head><body>${body
    .split(/\n\s*\n/)
    .map((p: string) => `<p>${escapeHtml(p)}</p>`)
    .join(
      "",
    )}${bib.heading ? `<h2>${escapeHtml(bib.heading.text.trim())}</h2><ul>${entries}</ul>` : ""}</body></html>`;
  return { text: row.text as string, html, versionId: row.id as string };
}
