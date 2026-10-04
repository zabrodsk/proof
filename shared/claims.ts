import { bibliography } from "./mla.js";

export type SkipReason =
  | "metadata"
  | "heading"
  | "question"
  | "instruction"
  | "preference"
  | "formatting"
  | "not_assertion";

// Require a subject and a recognizable predicate. Unsupported wording remains
// available for manual selection; punctuation, numbers and quotes alone do not
// establish an assertion. This selects claims, not whether they are true.
const predicate = new RegExp(
  "(?<!\\p{L})(?:" +
    [
      "is|are|was|were|has|have|had|can|could|will|would|should|must|may|might|did|does|do",
      "causes?|caused|found|shows?|showed|reports?|reported|increases?|increased|reduces?|reduced|improves?|improved|includes?|included|contains?|contained|suggests?|suggested",
      "died|lived|born|wrote|published|became|measured|affects?|affected|supports?|supported|teaches|taught|represents?|represented|symboli[sz](?:es?|ed)|states?|stated",
      "needs?|needed|requires?|required|depends?|depended|allows?|allowed|describes?|described|provides?|provided|establish(?:es|ed)?|remains?|remained|offers?|offered|examines?|examined|concerns?|concerned",
      "distinguish(?:es|ed)?|separates?|separated|places?|placed|makes?|made|leaves?|left|returns?|returned|follows?|followed|sounds?|sounded|supplies|supply|supplied|matters?|mattered|credits?|credited|turns?|turned|reflects?|reflected",
      "retains?|retained|acknowledges?|acknowledged|points?|pointed|visits?|visited|experiences?|experienced|observes?|observed|tests?|tested|addresses?|addressed|compares?|compared|explains?|explained|identif(?:ies|y|ied)|records?|recorded|attends?|attended",
      "generates?|generated|absorbs?|absorbed|freezes?|froze|falls?|fell|orbits?|orbited|ends?|ended|grows?|grew|declines?|declined|proves?|proved|cures?|cured|uses?|used",
      "involves?|involved|adjusts?|adjusted|funds?|funded|changes?|changed|permits?|permitted",
      "est|sont|était|étaient|a\\s+(?:recruté|montré|réduit|augmenté|inclus|publié)|ont|je|jsou|byl|byla|bylo|byli|má|mají|sn[ií]žil[aoiy]?|zvyšuje|snižuje|způsobuje",
    ].join("|") +
    ")(?!\\p{L})",
  "giu",
);
const intransitive =
  /^(?:died|lived|improved|increased|reduced|fell|falls?|grew|grows?|declines?|declined|ended|changes?|changed)$/i;
const subjective =
  /\b(?:beautiful|ugly|nice|nicer|lovely|boring|favorite|favourite)\b/i;
const empirical = /\b(?:study|research|evidence|participants|percent)\b|\d/i;
function hasAssertion(text: string) {
  const value = text.replace(/<[^>]+>/g, "").replace(/\([^()]*\)/g, " ");
  // Japanese topic-marked assertions do not use space-delimited predicates.
  if (
    /\p{Script=Han}.*[はが].+(?:する|した|させる|される|している|である|です|ます)[。.!]?$/u.test(
      value.trim(),
    )
  )
    return true;
  for (const match of value.matchAll(predicate)) {
    const subject = value.slice(0, match.index).match(/[\p{L}]+/gu) || [];
    const object = value.slice(match.index! + match[0].length).trim();
    if (
      subject.some(
        (word) =>
          !/^(?:a|an|the|and|or|but|of|to|in|is|are|was|were|be|been|has|have|had|can|could|will|would|should|must|may|might|did|does|do)$/i.test(
            word,
          ),
      ) &&
      (/\p{L}|\p{N}/u.test(object) || intransitive.test(match[0]))
    )
      return true;
  }
  return false;
}

export function skipReason(text: string): SkipReason | undefined {
  const value = text
    .replace(/<\/?(?:u|b|i|strong|em|span)(?:\s[^>]*)?>/gi, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim();
  if (
    /^(?:`{3,}|~{3,}|\|)|^(?:const|let|var|function|import|export)\s|^[-*_]{3,}$|^\[[ xX]\]\s/.test(
      value,
    )
  )
    return "formatting";
  if (/\n\s*(?:={3,}|-{3,})\s*$/.test(value)) return "heading";
  if (/\?\s*["”']?$/.test(value) || /\bbut is it worth\b/i.test(value))
    return "question";
  if (
    /^(?:name|student|teacher|instructor|professor|class|course|date|due date|student id|word count|email|phone)\s*:\s*[^\n]+$/i.test(
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
    /^(?:please\s+)?(?:write|submit|upload|answer|discuss|compare|explain|read|choose|click|remember|save|add)\b/i.test(
      value,
    ) &&
    !/\([^()]*\d[^()]*\)/.test(value)
  )
    return "instruction";
  // Bare names and section titles usually have no sentence punctuation or
  // assertion verb. Short facts such as "John died." remain candidates.
  if (/^(?:I|we)\s+(?:prefer|like|love|hate|enjoy|recommend)\b/i.test(value)) {
    const basis = value.split(/\b(?:because|since)\b/i)[1];
    if (
      !basis ||
      !hasAssertion(basis) ||
      (subjective.test(basis) && !empirical.test(basis))
    )
      return "preference";
  }
  if (
    /^(?:I|we)\s+(?:think|believe|feel)\b/i.test(value) &&
    subjective.test(value) &&
    !empirical.test(value)
  )
    return "preference";
  const bare = value.replace(/[.!]+$/, "").trim();
  const assertion = hasAssertion(value);
  if (
    !/[.!?]/.test(bare) &&
    !assertion &&
    (/^(?:introduction|conclusion|abstract|results|discussion|literary analysis|methodology|methods|background|acknowledgments)$/i.test(
      value,
    ) ||
      (bare.split(/\s+/).length <= 8 &&
        bare
          .split(/\s+/)
          .every(
            (word) =>
              /^[\p{Lu}\d][\p{L}\p{N}'’.-]*$/u.test(word) ||
              /^(?:de|van|von|der|den|of|the|and|da|di)$/i.test(word),
          )))
  )
    return "heading";
  if (!assertion) return "not_assertion";
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

export type CitationAssessment = {
  requirement: CitationRequirement;
  category: "general_fact" | "evidence_claim" | "needs_review";
  reason: string;
  canExempt: boolean;
};

function citationText(text: string) {
  return (
    text
      // Remove an author/locator citation, never a factual parenthetical aside.
      .replace(
        /\s+\(\p{Lu}[\p{L}'’-]*(?:\s+(?:and\s+)?\p{Lu}[\p{L}'’-]*|\s+et al\.)*(?:,\s*|\s+)(?:pp?\.\s*)?\d{1,4}(?:[–-]\d{1,4})?\)\s*\.?$/u,
        "",
      )
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/’/g, "'")
      .trim()
      .replace(/[.!]+$/, "")
      .replace(/\s+/g, " ")
  );
}

// Whole-assertion matches prevent a familiar topic from exempting an added
// quantity, interpretation or disputed claim. These are citation heuristics,
// not proof that a statement is true, nor an exhaustive knowledge database.
const generalFacts: { pattern: RegExp; reason: string }[] = [
  {
    pattern:
      /^(?:Paris is (?:the )?capital(?: city)? of France|France's capital(?: city)? is Paris|(?:the )?capital(?: city)? of France is Paris|Paris is France's capital(?: city)?)$/i,
    reason: "This is familiar geographical background for a general audience.",
  },
  {
    pattern:
      /^(?:Prague is (?:the )?capital of (?:the )?(?:Czech Republic|Czechia)|(?:the )?capital of (?:the )?(?:Czech Republic|Czechia) is Prague)$/i,
    reason: "This is familiar geographical background for a general audience.",
  },
  {
    pattern:
      /^(?:London is (?:the )?capital of (?:the )?United Kingdom|(?:the )?capital of (?:the )?United Kingdom is London)$/i,
    reason: "This is familiar geographical background for a general audience.",
  },
  {
    pattern:
      /^(?:the )?Earth (?:is a planet|orbits (?:the )?Sun|revolves around (?:the )?Sun)$/i,
    reason: "This is basic astronomical background for a general audience.",
  },
  {
    pattern: /^(?:the )?Sun is a star$/i,
    reason: "This is basic astronomical background for a general audience.",
  },
  {
    pattern:
      /^(?:(?:a )?week (?:has|contains|consists of) (?:seven|7) days|there are (?:seven|7) days in a week|(?:a )?year (?:has|contains|consists of) (?:twelve|12) months|there are (?:twelve|12) months in a year)$/i,
    reason:
      "This is a conventional calendar fact; its number is not a research statistic.",
  },
  {
    pattern:
      /^(?:(?:a )?triangle (?:has|contains) (?:three|3) sides|(?:a )?square (?:has|contains) (?:four|4) (?:equal )?sides)$/i,
    reason: "This is a basic geometrical definition, not an empirical finding.",
  },
  {
    pattern: /^(?:humans|human beings) are mammals$/i,
    reason: "This is basic biological background for a general audience.",
  },
  {
    pattern:
      /^(?:(?:William )?Shakespeare wrote Hamlet|Hamlet was written by (?:William )?Shakespeare)$/i,
    reason:
      "This is widely known authorship, rather than an interpretation of the work.",
  },
  {
    pattern: /^World War (?:II|Two|2) (?:ended|came to an end) in 1945$/i,
    reason: "This is a widely known historical date, not a research statistic.",
  },
];

function evidenceRequirementReason(text: string, context: string) {
  if (hasQuotedText(text))
    return "Quoted wording needs attribution to its source.";
  if (claimKind(text, context) === "interpretive")
    return "This interpretation or inference needs evidence from the relevant source.";
  if (
    /\baccording to\b|\b(?:stud(?:y|ies)|research|survey|experiment|data|findings|results|report|paper|author|textbook)\b[^.!?;]{0,120}\b(?:states?|reports?|says?|said|found|shown|shows?|suggests?|indicates?|demonstrates?)\b/i.test(
      text,
    )
  )
    return "This reports a source's findings or wording and needs attribution.";
  // A follow-on sentence can rely on study results without repeating "study".
  const index = context.indexOf(text);
  const before = index >= 0 ? context.slice(0, index).slice(-1200) : context;
  if (
    /^(?:this|these|that|those|it|they|such|the (?:benefit|effect|finding|result)s?)\b/i.test(
      text.trim(),
    ) &&
    /\b(?:stud(?:y|ies)|research|survey|experiment|participants|findings|results)\b/i.test(
      before,
    )
  )
    return "This sentence refers back to research or findings in its paragraph.";
  return undefined;
}

export function citationAssessment(
  text: string,
  context = "",
  override?: CitationRequirement,
): CitationAssessment {
  const value = citationText(text);
  let protectedReason = evidenceRequirementReason(text, context);
  // Recognize a complete elementary fact before treating dates or counts as
  // statistics. Source attribution and quoted language still take precedence.
  const general =
    !protectedReason && generalFacts.find(({ pattern }) => pattern.test(value));
  if (!protectedReason && !general) {
    if (
      /\d|\b(?:percent|percentage|statistics?|survey|million|billion|thousand|hundred|half|majority|most|many|often|usually|regularly)\b/i.test(
        value,
      )
    )
      protectedReason =
        "This gives a quantity, frequency or population claim that needs supporting evidence.";
    else if (
      /\b(?:increasingly|becoming|currently|recent(?:ly)?|nowadays|rising|declining|more common|less common|growing)\b/i.test(
        value,
      )
    )
      protectedReason =
        "This describes a trend or changing condition, rather than stable common knowledge.";
    else if (
      /\b(?:caus(?:e[sd]?|ing)|leads? to|results? in|improv(?:e[sd]?|ing)|reduc(?:e[sd]?|ing)|prevent\w*|linked to|associated with|inevitably|because|therefore)\b/i.test(
        value,
      )
    )
      protectedReason =
        "This asserts a cause, effect or association that needs supporting evidence.";
    else if (evidenceRoute(text, context) === "academic")
      protectedReason =
        "This is a study-specific or specialist claim that needs research evidence.";
  }
  if (protectedReason)
    return {
      requirement: "required",
      category: "evidence_claim",
      reason: protectedReason,
      canExempt: false,
    };
  if (override === "required")
    return {
      requirement: "required",
      category: "evidence_claim",
      reason: "You chose to require a citation for this claim.",
      canExempt: true,
    };
  if (general)
    return {
      requirement: "common_knowledge",
      category: "general_fact",
      reason: general.reason,
      canExempt: true,
    };
  if (override === "common_knowledge")
    return {
      requirement: "common_knowledge",
      category: "general_fact",
      reason: "You marked this as common knowledge for your intended audience.",
      canExempt: true,
    };
  return {
    requirement: "required",
    category: "needs_review",
    canExempt: true,
    reason:
      "Proof cannot confidently identify this as common knowledge. Keep the citation requirement unless it is widely known to your intended audience.",
  };
}

export function commonKnowledgeReason(text: string): string | undefined {
  const assessment = citationAssessment(text);
  return assessment.requirement === "common_knowledge"
    ? assessment.reason
    : undefined;
}

export function citationRequirement(
  text: string,
  context = "",
  override?: CitationRequirement,
): CitationRequirement {
  return citationAssessment(text, context, override).requirement;
}

/** Preserve quotation membership across sentence and paragraph boundaries. */
export function citationAssessmentForSpan(
  document: string,
  start: number,
  end: number,
  override?: CitationRequirement,
): CitationAssessment {
  for (const quote of document.matchAll(
    /“[^”]+”|"[^"]+"|‘(?:[^’]|(?<=\p{L})’(?=\p{L}))+’|(?:^|[\s,:])'(?:[^']|(?<=\p{L})'(?=\p{L}))+'(?=\s|[.!?,;:]|$)/gu,
  )) {
    if (quote.index! < end && quote.index! + quote[0].length > start)
      return {
        requirement: "required",
        category: "evidence_claim",
        canExempt: false,
        reason:
          "This statement is part of a quotation and needs attribution to its source.",
      };
  }
  return citationAssessment(
    document.slice(start, end),
    claimContext(document, start, end),
    override,
  );
}

export function citationRequirementForSpan(
  document: string,
  start: number,
  end: number,
  override?: CitationRequirement,
): CitationRequirement {
  return citationAssessmentForSpan(document, start, end, override).requirement;
}

export function documentSentences(text: string) {
  const body = text.slice(0, bibliography(text).heading?.start ?? text.length);
  const sentences: { id: string; text: string; start: number; end: number }[] =
    [];
  const lines = [...body.matchAll(/[^\r\n]+/g)];
  const add = (start: number, end: number) => {
    const value = text.slice(start, end);
    start += value.length - value.trimStart().length;
    end -= value.length - value.trimEnd().length;
    if (end > start)
      sentences.push({
        id: `sentence-${start}`,
        text: text.slice(start, end),
        start,
        end,
      });
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let end = line.index! + line[0].length;
    const fence = /^\s*(`{3,}|~{3,})/.exec(line[0]);
    if (fence) {
      while (++index < lines.length) {
        const next = lines[index];
        end = next.index! + next[0].length;
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(next[0]);
        if (
          close &&
          close[1][0] === fence[1][0] &&
          close[1].length >= fence[1].length
        )
          break;
      }
      add(line.index!, end);
      continue;
    }
    if (
      lines[index + 1] &&
      /^\s*(?:={3,}|-{3,})\s*$/.test(lines[index + 1][0])
    ) {
      const underline = lines[++index];
      add(line.index!, underline.index! + underline[0].length);
      continue;
    }
    // Join only clear continuations, never a new assertion, header, or blank
    // paragraph. Slice the original text so offsets and CRLF remain exact.
    while (
      lines[index + 1] &&
      /(?:\b(?:included|reported|found|contains?|of|with|to|by|in|a|an|the|and|that)|,)\s*$/i.test(
        text.slice(line.index!, end),
      )
    ) {
      const next = lines[index + 1];
      const previousReason = skipReason(text.slice(line.index!, end));
      const reason = skipReason(next[0]);
      if (
        (previousReason && previousReason !== "not_assertion") ||
        !/^\r?\n$/.test(text.slice(end, next.index!)) ||
        hasAssertion(next[0]) ||
        (reason && reason !== "not_assertion")
      )
        break;
      end = next.index! + next[0].length;
      index++;
    }
    const value = body.slice(line.index!, end);
    const reason = skipReason(value);
    if (
      reason === "metadata" ||
      reason === "heading" ||
      reason === "formatting"
    ) {
      add(line.index!, end);
      continue;
    }
    const protectedText = value
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
    for (const part of protectedText.matchAll(
      /[^.!?。！？]+(?:[.!?。！？]+["”'’]?|$)/g,
    )) {
      const start =
        line.index! + part.index! + part[0].length - part[0].trimStart().length;
      const end = line.index! + part.index! + part[0].trimEnd().length;
      add(start, end);
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
  if (hasAssertion(text)) return "factual";
  return "uncertain";
}
export const routeLabels: Record<EvidenceRoute, string> = {
  academic: "Academic research",
  authoritative: "Authoritative public sources",
  primary_text: "Original work or supplied text",
  private: "Your supplied evidence",
};
