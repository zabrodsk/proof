import { bibliography } from "./mla.js";

export type SkipReason =
  "metadata" | "heading" | "question" | "instruction" | "preference";
// This is a conservative selection rule, not a factual judgment. Keep prose
// when its role is unclear. Manual claim spans bypass automatic selection.
export function skipReason(text: string): SkipReason | undefined {
  const value = text
    .replace(/<\/?(?:u|b|i|strong|em|span)(?:\s[^>]*)?>/gi, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim();
  if (/\?\s*["”']?$/.test(value) || /\bbut is it worth\b/i.test(value))
    return "question";
  if (
    /^(?:name|student|teacher|instructor|professor|class|course|date|due date|student id|word count)\s*:\s*[^\n]+$/i.test(
      value,
    ) ||
    /^(?:\d{1,2}\s+[\p{L}.]+\s+\d{4}|[\p{L}.]+\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{4})\.?$/u.test(
      value,
    ) ||
    /^(?:page\s+)?\d+(?:\s+of\s+\d+)?$/i.test(value) ||
    /^(?:[\p{L}\d-]*\d[\p{L}\d-]*\s+)?(?:English|French|History|Biology|Mathematics|Science)(?:\s+[\p{L}\d-]+)?$/iu.test(
      value,
    )
  )
    return "metadata";
  if (/^#{1,6}\s+/.test(value)) return "heading";
  if (
    /^(?:please\s+)?(?:write|submit|upload|answer|discuss|compare|explain)\b/i.test(
      value,
    ) &&
    !/\([^()]*\d[^()]*\)/.test(value)
  )
    return "instruction";
  // Bare names and section titles usually have no sentence punctuation or
  // assertion verb. Short facts such as "John died." remain candidates.
  if (
    /^(?:I|we)\s+(?:prefer|like|love|hate|enjoy|recommend)\b/i.test(value) &&
    !/\b(?:because|since|study|research|evidence|participants|percent|\d+)\b/i.test(
      value,
    )
  )
    return "preference";
  const bare = value.replace(/[.!]+$/, "").trim();
  const assertion =
    /\b(?:is|are|was|were|be|been|has|have|had|can|could|will|would|did|does|do|causes?|caused|found|shows?|showed|reports?|reported|increases?|increased|reduces?|reduced|improves?|improved|includes?|included|contains?|contained|suggests?|suggested|died|lived|born|wrote|published|became|measured|affects?|affected|supports?|supported)\b/i;
  if (
    !/[.!?]/.test(bare) &&
    !assertion.test(value) &&
    (/^(?:introduction|conclusion|abstract|results|discussion|literary analysis|methodology|methods|background|acknowledgments)$/i.test(
      value,
    ) ||
      (bare.split(/\s+/).length <= 8 &&
        bare
          .split(/\s+/)
          .every(
            (word) =>
              /^[\p{Lu}\d][\p{L}\p{N}'’-]*$/u.test(word) ||
              /^(?:de|van|von|der|den|of|the|and|da|di)$/i.test(word),
          )))
  )
    return "heading";
  return undefined;
}

export function selectClaims(text: string) {
  const candidates = [],
    skipped = [];
  for (const sentence of documentSentences(text)) {
    const reason = skipReason(sentence.text);
    if (reason)
      skipped.push({ start: sentence.start, end: sentence.end, reason });
    else candidates.push(sentence);
  }
  return { candidates, skipped };
}

export type CitationRequirement = "required" | "common_knowledge";

function hasQuotedText(text: string) {
  return (
    /["“][^"”]+["”]/.test(text) ||
    /(?:^|[\s,:])['‘][^'\n’]{2,}['’](?=\s|[.!?,;:]|$)/.test(text)
  );
}

/** A narrow default. Audience-specific common knowledge stays reviewable. */
export function commonKnowledgeReason(text: string): string | undefined {
  if (hasQuotedText(text)) return;
  const value = text
    // Strip only a recognizable author-and-locator citation. Factual asides
    // remain part of the assertion and cannot inherit a basic-fact exemption.
    .replace(
      /\s+\(\p{Lu}[\p{L}'’-]*(?:\s+(?:and\s+)?\p{Lu}[\p{L}'’-]*|\s+et al\.)*(?:,\s*|\s+)(?:pp?\.\s*)?\d{1,4}(?:[–-]\d{1,4})?\)\s*\.?$/u,
      "",
    )
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ");
  const basicFacts = [
    /^(?:Paris is (?:the )?capital of France|France's capital is Paris)$/i,
    /^(?:Prague is (?:the )?capital of (?:the )?(?:Czech Republic|Czechia))$/i,
    /^(?:London is (?:the )?capital of (?:the )?United Kingdom)$/i,
    /^(?:the )?Earth (?:is a planet|orbits (?:the )?Sun|revolves around (?:the )?Sun)$/i,
    /^(?:the )?Sun is a star$/i,
    /^(?:a )?week has seven days$/i,
    /^(?:there are seven days in a week|there are twelve months in a year)$/i,
    /^(?:William )?Shakespeare wrote Hamlet$/i,
    /^World War (?:II|Two|2) ended in 1945$/i,
  ];
  if (basicFacts.some((pattern) => pattern.test(value)))
    return "This is a broadly known, stable fact. A citation is not required.";
}

export function citationRequirement(
  text: string,
  context = "",
  override?: CitationRequirement,
): CitationRequirement {
  // Quotes and interpretations depend on a source even when their subject is familiar.
  const kind = claimKind(text, context);
  if (hasQuotedText(text) || kind === "quotation" || kind === "interpretive")
    return "required";
  if (override === "required") return "required";
  if (commonKnowledgeReason(text)) return "common_knowledge";
  // Study results, specialist assertions and statistical quantities remain source-dependent.
  if (
    evidenceRoute(text, context) === "academic" ||
    /\d|\b(?:percent|percentage|statistics?|survey|according to|million|billion|thousand|hundred)\b/i.test(
      text,
    )
  )
    return "required";
  return override === "common_knowledge" ? "common_knowledge" : "required";
}

/** Preserve quotation membership across sentence and paragraph boundaries. */
export function citationRequirementForSpan(
  document: string,
  start: number,
  end: number,
  override?: CitationRequirement,
): CitationRequirement {
  for (const quote of document.matchAll(
    /“[^”]+”|"[^"]+"|‘(?:[^’]|(?<=\p{L})’(?=\p{L}))+’|(?:^|[\s,:])'(?:[^']|(?<=\p{L})'(?=\p{L}))+'(?=\s|[.!?,;:]|$)/gu,
  )) {
    if (quote.index! < end && quote.index! + quote[0].length > start)
      return "required";
  }
  return citationRequirement(
    document.slice(start, end),
    claimContext(document, start, end),
    override,
  );
}

export function documentSentences(text: string) {
  const body = text.slice(0, bibliography(text).heading?.start ?? text.length);
  const sentences: { id: string; text: string; start: number; end: number }[] =
    [];
  for (const line of body.matchAll(/[^\r\n]+/g)) {
    const protectedText = line[0]
      .replace(/[.!?](?=["”'’]?\s*\([^()]+\))/g, "∯")
      .replace(/\([^()]*\)/g, (s) => s.replace(/[.!?]/g, "∯"))
      .replace(/\b(?:[A-Z]\.){2,}/g, (abbr, offset, line) => {
        const next = line.slice(offset + abbr.length).trimStart();
        // Keep the final period only at an actual sentence boundary. Internal
        // acronym periods and initials must never create fragment claims.
        const boundary =
          !next ||
          /^(?:It|They|This|That|The|These|Those|He|She|We|However|Furthermore|According|Along|Though)\b/.test(
            next,
          );
        return abbr.slice(0, -1).replace(/\./g, "∯") + (boundary ? "." : "∯");
      })
      .replace(
        /\bet al\.|\b(?:Dr|Mr|Mrs|Prof|vs)\.|(?<![\p{L}.∯])[A-Z]\.(?=\s+[A-Z])/gu,
        (s) => s.replace(/\./g, "∯"),
      )
      .replace(/(?:https?:\/\/|10\.\d{4,9}\/)[^\s)]+/g, (s) =>
        s.replace(/\.(?!$)/g, "∯"),
      )
      .replace(/\b(?:e\.g|i\.e)\./g, (s) => s.replace(/\./g, "∯"))
      .replace(/(\d)\.(?=\d)/g, "$1∯");
    for (const part of protectedText.matchAll(/[^.!?]+(?:[.!?]+["”'’]?|$)/g)) {
      const start =
        line.index! + part.index! + part[0].length - part[0].trimStart().length;
      const end = line.index! + part.index! + part[0].trimEnd().length;
      if (end > start)
        sentences.push({
          id: `sentence-${start}`,
          text: text.slice(start, end),
          start,
          end,
        });
    }
  }
  return sentences;
}

export type EvidenceRoute =
  "academic" | "authoritative" | "primary_text" | "private";
export function claimContext(text: string, start: number, end: number) {
  const before = text.lastIndexOf("\n\n", start),
    after = text.indexOf("\n\n", end);
  return text
    .slice(before < 0 ? 0 : before + 2, after < 0 ? text.length : after)
    .slice(0, 6000);
}
export function evidenceRoute(text: string, context = ""): EvidenceRoute {
  const assertion = text.replace(
    /^(?:I (?:think|believe)|in my opinion)[, ]+/i,
    "",
  );
  if (
    /\b(?:I|we)\s+(?:visited|went|saw|bought|ate|felt|experienced|remember|met|live|lived|work|worked)\b|\b(?:my|our)\s+(?:family|friend|teacher|school|experience|childhood)\b/i.test(
      assertion,
    )
  )
    return "private";
  if (
    /\b(?:novel|poem|poetry|play|narrator|protagonist|character|symboli[sz](?:es|ed)|metaphor|rebellious|Brave New World|World State|Huxley)\b/i.test(
      text + " " + context,
    )
  )
    return "primary_text";
  if (
    /\b(?:trial|study|research|scientific|clinical|patients|participants|symptoms|treatment|vaccin|depress|sleep|scores|causes?|causality|correlat|experiment|systematic review|meta-analysis)\w*\b/i.test(
      assertion,
    )
  )
    return "academic";
  return "authoritative";
}
export function claimKind(text: string, context = "") {
  if (evidenceRoute(text, context) === "private") return "personal";
  if (
    /\b(?:symboli[sz]\w*|suggests?|interpreta\w*|metaphor|could be described|represents?|rebellious)\b/i.test(
      text,
    )
  )
    return "interpretive";
  if (hasQuotedText(text)) return "quotation";
  if (
    /\b(?:is|are|was|were|has|have|had|can|could|will|did|does|causes?|caused|found|shows?|showed|reports?|reported|increases?|increased|reduces?|reduced|includes?|included|improves?|improved|died|born|teaches|published|est|je)\b/i.test(
      text,
    )
  )
    return "factual";
  return "uncertain";
}
export const routeLabels: Record<EvidenceRoute, string> = {
  academic: "Academic research",
  authoritative: "Authoritative public sources",
  primary_text: "Original work or supplied text",
  private: "Your supplied evidence",
};
