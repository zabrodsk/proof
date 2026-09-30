import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  citations,
  dois,
  extractClaims,
  matchesCitation,
  numbers,
  relevantPassages,
} from "../server/parse.js";
import {
  clean,
  resolveDOI,
  saveSource,
  splitPassages,
} from "../server/sources.js";
import { parseAnswer, judgeClaim } from "../server/judge.js";
import { auditDocument } from "../server/audit.js";
import { parseDocument } from "../server/documents.js";
import { demoText } from "../shared/demo.js";
import type { Claim, Source } from "../shared/types.js";
const source: Source = {
  id: "test-source",
  title: "Exercise and mood",
  authors: ["Michael Noetel"],
  year: "2024",
  access: "abstract",
  provider: "Test",
  passages: [
    "218 unique studies with a total of 495 arms and 14,170 participants were included.",
  ],
  retrievedAt: new Date().toISOString(),
};
const claim: Claim = {
  id: "c1",
  text: "The review included 300 studies (Noetel 2024).",
  start: 0,
  end: 45,
  citations: ["Noetel 2024"],
};
function answer(choice: string, choices: string[]) {
  return {
    type: "choice",
    choice,
    confidence: 0.97,
    probabilities: Object.fromEntries(
      choices.map((k) => [
        k,
        k === choice ? 0.97 : 0.03 / (choices.length - 1),
      ]),
    ),
  };
}
const verdicts = [
  "supported",
  "partial",
  "overstated",
  "contradicted",
  "not_addressed",
  "numeric_mismatch",
  "uncertain",
];
const reasons = [
  "aligns",
  "scope",
  "causality",
  "certainty",
  "numbers",
  "conflict",
  "outcome",
  "incomplete",
];
function response(verdict = "numeric_mismatch", confidence = 0.97) {
  return {
    model: "jev-test",
    answers: {
      verdict: { ...answer(verdict, verdicts), confidence },
      passage: answer("p0", ["p0", "none"]),
      reason: answer(verdict === "supported" ? "aligns" : "numbers", reasons),
      replacement: answer("s0", ["s0", "none"]),
      numbers: answer("none", ["n0", "none"]),
    },
  };
}

test("extracts all five cited example claims with exact source offsets", () => {
  const claims = extractClaims(demoText);
  assert.equal(claims.length, 5);
  for (const claim of claims)
    assert.equal(demoText.slice(claim.start, claim.end), claim.text);
  assert.match(claims[0].text, /300 studies/);
  assert.equal(claims[0].citations[0], "Noetel et al. 2024");
});
test("strict mode includes factual uncited sentences but not headings or bibliography", () => {
  const claims = extractClaims(demoText, true);
  assert.ok(
    claims.some(
      (c) =>
        c.text ===
        "Regular exercise also improves long-term academic performance.",
    ),
  );
  assert.ok(!claims.some((c) => c.text.includes("https://doi.org")));
  assert.ok(!claims.some((c) => c.text.endsWith("?")));
});
test("recognizes MLA author-page, semicolon references, and narrative citations", () => {
  assert.deepEqual(citations("Research shows an effect (Smith 42)."), [
    "Smith 42",
  ]);
  assert.deepEqual(citations("Smith (2024) reported an effect."), [
    "Smith 2024",
  ]);
  assert.deepEqual(
    citations("The claim is supported (Smith 2024; Jones 2023)."),
    ["Smith 2024", "Jones 2023"],
  );
});
test("does not treat parenthetical sample size as an author citation", () => {
  assert.deepEqual(citations("The intervention included adults (n=120)."), []);
});
test("preserves repeated identical sentence offsets", () => {
  const sentence = "The trial included 30 people (Smith 2024).";
  const text = sentence + "\n\n" + sentence;
  const claims = extractClaims(text);
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].id, claims[1].id);
  assert.equal(claims[1].start, sentence.length + 2);
});
test("normalizes a DOI URL with trailing punctuation", () => {
  assert.deepEqual(dois("https://doi.org/10.1136/bmj-2023-075847."), [
    "10.1136/bmj-2023-075847",
  ]);
});
test("citation matching requires both author and supplied year", () => {
  assert.equal(matchesCitation("Noetel 2024", source), true);
  assert.equal(matchesCitation("Noetel 2023", source), false);
  assert.equal(matchesCitation("Other 2024", source), false);
});
test("matches accented names without changing identity", () => {
  assert.equal(
    matchesCitation("Gomez 2024", { ...source, authors: ["David Gómez"] }),
    true,
  );
});
test("ranking chooses the claim-relevant passage instead of just the first passage", () => {
  assert.equal(
    relevantPassages(
      "Exercise reduces depressive symptoms",
      [
        "The paper discusses blood pressure and cholesterol.",
        "Exercise reduced depressive symptoms in adults.",
      ],
      1,
    )[0],
    "Exercise reduced depressive symptoms in adults.",
  );
});
test("number parser preserves percentages and thousands separators", () => {
  assert.deepEqual(
    numbers("14,170 participants and 12.4% improved.").map((n) => [
      n.value,
      n.percent,
    ]),
    [
      [14170, false],
      [12.4, true],
    ],
  );
});
test("XML cleaning and passage splitting preserve text without markup", () => {
  assert.equal(clean("<p>Study &amp; results</p>"), "Study & results");
  assert.equal(
    splitPassages(
      "The participants in this intervention completed a full questionnaire.\n\nThe comparison group completed the same questionnaire.",
    ).length,
    2,
  );
});
test("invalid Jev choices and missing probabilities fail closed", () => {
  assert.throws(() =>
    parseAnswer(
      {
        type: "choice",
        choice: "invented",
        confidence: 1,
        probabilities: { yes: 1 },
      },
      { yes: "Yes" },
    ),
  );
  assert.throws(() =>
    parseAnswer(
      { type: "choice", choice: "yes", confidence: 0.99, probabilities: {} },
      { yes: "Yes" },
    ),
  );
  assert.throws(() =>
    parseAnswer(
      {
        type: "choice",
        choice: "yes",
        confidence: 4,
        probabilities: { yes: 1 },
      },
      { yes: "Yes" },
    ),
  );
});
test("metadata-only sources never produce semantic judgments", async () => {
  const result = await judgeClaim(claim, {
    ...source,
    passages: [],
    access: "metadata",
  });
  assert.equal(result.status, "source_unavailable");
  assert.equal(result.method, "unverified");
});
test("real audit orchestration fails safely for ambiguous and missing sources", async () => {
  const first = saveSource({
      ...source,
      authors: ["Identity Test"],
      year: "2025",
    }),
    second = saveSource({
      ...source,
      authors: ["Identity Test"],
      year: "2025",
    });
  const result = await auditDocument(
    "The research found a substantial outcome (Test 2025).",
    "audit",
    [first.id, second.id],
  );
  assert.equal(result.findings[0].status, "uncertain");
  const missing = await auditDocument(
    "The research found a substantial outcome (Unknown 2025).",
    "audit",
    [],
  );
  assert.equal(missing.findings[0].status, "source_unavailable");
});
test("combined citations remain unverified instead of evaluating only one source", async () => {
  const result = await auditDocument(
    "The research found a substantial outcome (Smith 2024; Jones 2023).",
    "audit",
    [],
  );
  assert.equal(result.findings[0].status, "uncertain");
  assert.match(result.findings[0].explanation, /multiple sources/);
});
test("semantic adapter preserves exact evidence and exposes abstract-only scope", async () => {
  process.env.TYPESAFE_API_KEY = "test-only-not-a-key";
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(response())),
  );
  try {
    const result = await judgeClaim(claim, source);
    assert.equal(result.status, "numeric_mismatch");
    assert.equal(result.evidence, source.passages[0]);
    assert.match(result.explanation, /abstract only/);
    assert.match(result.fix || "", /218 unique studies/);
    assert.equal(result.method, "Jev");
  } finally {
    fetchMock.mock.restore();
  }
});
test("low-confidence model responses remain uncertain with no fix", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(response("supported", 0.52))),
  );
  try {
    const result = await judgeClaim(claim, source);
    assert.equal(result.status, "uncertain");
    assert.equal(result.fix, undefined);
  } finally {
    fetchMock.mock.restore();
  }
});
test("Jev failure does not fall back to fabricated support", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 503 }),
  );
  try {
    const result = await judgeClaim(claim, source);
    assert.equal(result.status, "uncertain");
    assert.equal(result.method, "unverified");
    assert.match(result.explanation, /HTTP 503/);
  } finally {
    fetchMock.mock.restore();
  }
});
test("a numeric verdict is rejected when numbers do not differ", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(response())),
  );
  try {
    const result = await judgeClaim(
      { ...claim, text: "The review included 218 studies (Noetel 2024)." },
      source,
    );
    assert.equal(result.status, "uncertain");
  } finally {
    fetchMock.mock.restore();
  }
});
test("preprints and other non-journal DOI types are not admitted as journal evidence", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ message: { type: "posted-content" } })),
  );
  try {
    await assert.rejects(
      resolveDOI("10.1234/preprint-test"),
      /not registered as a journal article/,
    );
  } finally {
    fetchMock.mock.restore();
  }
});
test("parses text files and rejects disguised or unsupported files", async () => {
  const text =
    "This is a sample research document with enough content for parsing.";
  assert.equal(await parseDocument(Buffer.from(text), "research.txt"), text);
  await assert.rejects(
    parseDocument(Buffer.from(text), "fake.pdf"),
    /not a valid PDF/,
  );
  await assert.rejects(
    parseDocument(Buffer.from(text), "fake.docx"),
    /not a valid Word/,
  );
  await assert.rejects(
    parseDocument(Buffer.from(text), "legacy.doc"),
    /Choose a/,
  );
  await assert.rejects(
    parseDocument(Buffer.from("tiny"), "tiny.txt"),
    /No readable text/,
  );
});

test("DOI links in a cited claim preserve sentence boundaries", () => {
  const text =
    "The intervention reduced depressive symptoms (https://doi.org/10.1136/bmj-2023-075847).";
  const claims = extractClaims(text);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].text, text);
  assert.deepEqual(claims[0].citations, ["10.1136/bmj-2023-075847"]);
});
test("numeric result passages outrank generic methodological descriptions", () => {
  const passages = [
    "We included studies that met our definition for exercise. Participants were included in a systematic review of studies.",
    "Results: 218 unique studies with a total of 495 arms and 14,170 participants were included.",
    "Design: Systematic review and network meta-analysis.",
  ];
  assert.match(
    relevantPassages(
      "A systematic review included 300 studies and 14,170 participants.",
      passages,
      1,
    )[0],
    /218 unique studies/,
  );
});
test("ordered XML parser keeps mixed inline evidence in source order", async () => {
  const { collectParagraphs } = await import("../server/sources.js");
  const result = collectParagraphs(
    "<article><body><sec><p>The study included <italic>218</italic> trials and <bold>14,170</bold> participants.</p></sec></body><back><p>This bibliography content is not primary evidence.</p></back></article>",
  );
  assert.deepEqual(result, [
    "The study included 218 trials and 14,170 participants.",
  ]);
});

test("Word and PDF imports extract a real cited sentence", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const ext of ["docx", "pdf"]) {
    const data = await readFile(
      new URL(`./fixtures/research.${ext}`, import.meta.url),
    );
    const text = await parseDocument(data, `research.${ext}`);
    assert.match(text, /218 trials and 14,170 participants/);
    assert.equal(extractClaims(text).length, 1);
  }
});

test("numeric candidates compare equal units and leave matching values alone", async () => {
  const { quantityMismatches } = await import("../server/parse.js");
  assert.equal(
    quantityMismatches("The review has 300 studies.", [
      "The review has 218 studies.",
    ])[0].actual.value,
    218,
  );
  assert.deepEqual(
    quantityMismatches("The review has 300 studies.", [
      "The study included 218 participants.",
    ]),
    [],
  );
  assert.deepEqual(
    quantityMismatches("The review has 218 studies.", [
      "The review has 218 studies.",
    ]),
    [],
  );
});
test("independent high-confidence quantity check can identify a split semantic verdict", async () => {
  const body = response("partial", 0.65);
  body.answers.numbers = answer("n0", ["n0", "none"]);
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(body)),
  );
  try {
    const result = await judgeClaim(claim, source);
    assert.equal(result.status, "numeric_mismatch");
    assert.equal(result.confidence, 0.97);
    assert.equal(result.evidence, source.passages[0]);
  } finally {
    fetchMock.mock.restore();
  }
});

test("a source quotation stays attached to its trailing citation when audited again", () => {
  const text =
    'The source states, "Only one study met the criteria for low risk of bias." (Noetel et al. 2024).';
  const claims = extractClaims(text);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].text, text);
  assert.deepEqual(claims[0].citations, ["Noetel et al. 2024"]);
});
