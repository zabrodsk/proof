import type { Audit, Finding, Mode, Source } from "../shared/types.js";
import {
  extractClaims,
  referenceLines,
  matchesCitation,
  dois,
} from "./parse.js";
import { getSource, resolveDOI, resolveReference } from "./sources.js";
import { judgeScholarlyClaim, resolveScholarly } from "./scholarly.js";
export async function auditDocument(
  text: string,
  mode: Mode,
  sourceIds: string[],
): Promise<Audit> {
  const sources = sourceIds.map(getSource).filter((s): s is Source => !!s);
  const notices: string[] = [];
  if (sourceIds.length !== sources.length)
    notices.push(
      "Some sources expired after a server restart. Add those sources again.",
    );
  const references = referenceLines(text);
  for (const ref of references.slice(0, 30)) {
    try {
      const source = await resolveReference(ref);
      if (source && !sources.some((s) => s.id === source.id))
        sources.push(source);
    } catch {
      notices.push(
        `Could not retrieve reference: ${ref.slice(0, 100)}. Add a DOI or upload its source text.`,
      );
    }
  }
  const claims = extractClaims(text, mode === "strict", sources);
  if (claims.length > 60)
    throw new Error(
      "This version handles up to 60 candidate claims per audit. Audit a shorter section.",
    );
  if (!claims.length)
    notices.push(
      mode === "audit"
        ? "No supported citation patterns found. Use author-year or MLA author-page citations with a Works cited section, or try Strict mode."
        : "No candidate factual claims found.",
    );
  const findings: Finding[] = [];
  // Small concurrency keeps provider load bounded without serializing a whole paper.
  for (let i = 0; i < claims.length; i += 3) {
    findings.push(
      ...(await Promise.all(
        claims.slice(i, i + 3).map(async (claim) => {
          if (!claim.citations.length)
            return {
              ...claim,
              status: "citation_missing",
              method: "deterministic",
              explanation:
                "This sentence looks like a factual claim but has no recognized citation. This is a heuristic suggestion; decide whether evidence is needed.",
            } as Finding;
          if (claim.citations.length > 1)
            return {
              ...claim,
              status: "uncertain",
              method: "unverified",
              explanation:
                "This sentence cites multiple sources. Split the claim or check each citation separately; this version does not judge combined evidence.",
            } as Finding;
          const citation = claim.citations[0];
          let matches = sources.filter((s) => matchesCitation(citation, s));
          if (!matches.length && dois(citation).length) {
            try {
              const s = await resolveDOI(citation);
              sources.push(s);
              matches = [s];
            } catch {
              /* Explicit unavailable result below. */
            }
          }
          if (matches.length !== 1)
            return {
              ...claim,
              status: matches.length ? "uncertain" : "source_unavailable",
              method: "unverified",
              explanation: matches.length
                ? "More than one source matches this citation. Remove the ambiguous match or use a DOI."
                : "No source could be matched reliably to this citation. Add its DOI or attach the source with the author and year.",
            } as Finding;
          const source = matches[0].doi
            ? await resolveScholarly(matches[0].doi)
            : matches[0];
          return judgeScholarlyClaim(claim, source);
        }),
      )),
    );
  }
  if (references.length > 30)
    notices.push("Only the first 30 bibliography entries were resolved.");
  const uniqueRefs = new Set<string>();
  for (const ref of references) {
    const key = dois(ref)[0] || ref.toLowerCase();
    if (uniqueRefs.has(key))
      notices.push("Duplicate bibliography entry: " + ref.slice(0, 90));
    uniqueRefs.add(key);
  }
  for (const source of sources) {
    if (
      !claims.some((c) =>
        c.citations.some((ref) => matchesCitation(ref, source)),
      )
    )
      notices.push(
        `No recognized citation for "${source.title}" in the document.`,
      );
  }
  return {
    findings,
    sources,
    createdAt: new Date().toISOString(),
    text,
    mode,
    notices: [...new Set(notices)],
  };
}
