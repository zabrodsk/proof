import type { Finding } from "../shared/types.js";
import { quantities, quantityMismatches } from "./parse.js";

type NumericPair = ReturnType<typeof quantityMismatches>[number];

export function numericCorrection(claim: string, pair: NumericPair) {
  // Only replace an unambiguous quantity at its original span, never every matching number.
  const candidates = quantities(
    claim.replace(/\([^()]+\)/g, (part) => " ".repeat(part.length)),
  ).filter((q) => q.value === pair.stated.value && q.unit === pair.stated.unit);
  if (
    candidates.length !== 1 ||
    claim.slice(pair.stated.start, pair.stated.end) !== pair.stated.raw
  )
    return;
  const correction: NonNullable<Finding["numericCorrection"]> = {
    from: pair.stated.raw,
    to: pair.actual.raw,
    unit: pair.stated.unit,
    start: pair.stated.start,
    end: pair.stated.end,
  };
  return {
    correction,
    fix:
      claim.slice(0, correction.start) +
      correction.to +
      claim.slice(correction.end),
  };
}

export function evidenceExcerpt(evidence: string, numberOffset?: number) {
  const sentences = [
    ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(evidence),
  ];
  if (numberOffset !== undefined) {
    const sentence = sentences.find(
      (s) =>
        s.index <= numberOffset && s.index + s.segment.length > numberOffset,
    );
    if (sentence) return sentence.segment.trim();
  }
  if (evidence.length <= 450) return evidence;
}
