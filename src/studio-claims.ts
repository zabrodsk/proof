import { citationRequirementForSpan } from "../shared/claims";
import type { selectClaims } from "../shared/claims";
import type { BackendFinding } from "../shared/backend";

export type ClaimReviewRow = {
  start: number;
  end: number;
  text: string;
  citationRequirement: CitationRequirement;
  unsure?: boolean;
  finding?: BackendFinding;
};

export function claimReviewRows(
  content: string,
  preview: ReturnType<typeof selectClaims>,
  findings: BackendFinding[],
  stale: boolean,
  citationOverrides: ReadonlyMap<number, CitationRequirement> = new Map(),
): ClaimReviewRow[] {
  return [
    ...preview.candidates,
    ...preview.skipped.map((claim) => ({ ...claim, unsure: true })),
  ]
    .sort((a, b) => a.start - b.start)
    .map((claim) => ({
      start: claim.start,
      end: claim.end,
      text: content.slice(claim.start, claim.end),
      unsure: "unsure" in claim,
      citationRequirement: citationRequirementForSpan(
        content,
        claim.start,
        claim.end,
        citationOverrides.get(claim.start),
      ),
      finding: stale
        ? undefined
        : findings.find(
            (f) =>
              f.claim.start === claim.start &&
              f.claim.end === claim.end &&
              f.claim.text === content.slice(claim.start, claim.end),
          ),
    }));
}

export type CitationRequirement = "required" | "common_knowledge";
export type CitationOverrides = {
  content: string;
  choices: Map<number, CitationRequirement>;
};

export function currentCitationOverrides(
  state: CitationOverrides,
  content: string,
) {
  return state.content === content
    ? state.choices
    : new Map<number, CitationRequirement>();
}

export function setCitationOverride(
  state: CitationOverrides,
  content: string,
  start: number,
  requirement: CitationRequirement,
): CitationOverrides {
  const choices = new Map(currentCitationOverrides(state, content));
  choices.set(start, requirement);
  return { content, choices };
}

export function approvedClaimSpans(
  claims: { start: number; end: number }[],
  content: string,
  overrides: CitationOverrides,
) {
  const choices = currentCitationOverrides(overrides, content);
  return claims.map(({ start, end }) => {
    const manual = choices.get(start);
    return {
      start,
      end,
      ...(manual === undefined
        ? {}
        : {
            citationRequirement: citationRequirementForSpan(
              content,
              start,
              end,
              manual,
            ),
          }),
    };
  });
}
