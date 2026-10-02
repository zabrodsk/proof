import { evidenceRoute, type EvidenceRoute } from "../../shared/claims.js";

const stop = new Set(
  "the a an is are was were has have had this that these those of in on at to for from with by and but or not does do can could would will study research included reported found results".split(
    " ",
  ),
);
const terms = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter(
      (word) => !stop.has(word),
    ),
  );
export function planResearch(
  claims: { text: string; context: string; start: number }[],
  matched: boolean,
) {
  const groups: {
    route: EvidenceRoute;
    claims: typeof claims;
    words: Set<string>;
  }[] = [];
  for (const claim of claims) {
    const route = matched
      ? evidenceRoute(claim.text, claim.context)
      : "academic";
    const words = terms(claim.text);
    const existing = groups.find(
      (group) =>
        group.route === route &&
        group.claims.length < 4 &&
        group.claims.reduce((n, c) => n + c.text.length, 0) +
          claim.text.length <
          1000 &&
        (group.claims.some((c) => c.text === claim.text) ||
          [...words].filter((word) => group.words.has(word)).length >= 2),
    );
    if (existing) {
      existing.claims.push(claim);
      for (const word of words) existing.words.add(word);
    } else groups.push({ route, claims: [claim], words });
  }
  return new Map(
    groups.flatMap((group) => {
      const query = [...new Set(group.claims.map((c) => c.text))].join(" ");
      return group.claims.map(
        (claim) =>
          [
            claim.start,
            { query, route: group.route, size: group.claims.length },
          ] as const,
      );
    }),
  );
}
