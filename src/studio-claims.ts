import { citationRequirement, claimContext } from "../shared/claims";

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
            citationRequirement: citationRequirement(
              content.slice(start, end),
              claimContext(content, start, end),
              manual,
            ),
          }),
    };
  });
}
