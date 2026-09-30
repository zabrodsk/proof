import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { judgeClaim, parseAnswer } from "../server/judge.js";
import { resolveDOI, recordPublicationNotice } from "../server/sources.js";
import {
  citationRefs,
  assignmentChecks,
  inspectPaper,
  reviewClass,
  reconcileEvidence,
} from "../server/classroom.js";
import type { Source, Claim } from "../shared/types.js";
import type { ClassPaper } from "../shared/classroom.js";
import { blankMlaSource } from "../shared/mla.js";
process.env.TYPESAFE_API_KEY = "fixture-not-real";
const passage =
  "A randomized trial of adults found a small improvement in reading scores after tutoring. The study did not include children.";
const source: Source = {
  id: "reliability-source",
  title: "Tutoring among adults",
  authors: ["Jane Li"],
  year: "2024",
  doi: "10.1000/reliability",
  access: "full_text",
  provider: "Fixture",
  passages: [passage],
  retrievedAt: new Date().toISOString(),
};
const claim: Claim = {
  id: "claim",
  text: "Tutoring slightly improved reading scores among adults.",
  start: 0,
  end: 55,
  citations: ["Li 1"],
};
function answer(
  criteria: Record<string, unknown>,
  choice: string,
  confidence = 0.99,
) {
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: Object.fromEntries(
      Object.keys(criteria).map((k) => [
        k,
        k === choice
          ? confidence
          : (1 - confidence) / (Object.keys(criteria).length - 1),
      ]),
    ),
  };
}
async function judged(
  change: (a: any) => void = () => {},
  s = source,
  supplied?: string[],
) {
  const stub = mock.method(
    globalThis,
    "fetch",
    async (_u: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const defaults: Record<string, string> = {
        verdict: "supported",
        passage: "p0",
        reason: "aligns",
        replacement: "none",
        numbers: "none",
      };
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([k, q]: [string, any]) => [
          k,
          answer(q.criteria, defaults[k] || Object.keys(q.criteria)[0]),
        ]),
      );
      change(answers);
      return Response.json({
        answers,
        model: "fixture",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  );
  try {
    return await judgeClaim(claim, s, supplied);
  } finally {
    stub.mock.restore();
  }
}
test("rejects invalid distributions, inherited choices, and a choice that is not most likely", () => {
  for (const v of [
    { choice: "yes", probabilities: { yes: 1, no: 1 } },
    { choice: "yes", probabilities: { yes: 0.1, no: 0.9 } },
    { choice: "yes", probabilities: { yes: 0.9, no: 0.1, invented: 0 } },
    { choice: "toString", probabilities: { yes: 0.9, no: 0.1 } },
  ])
    assert.throws(() =>
      parseAnswer(
        { type: "choice", confidence: 0.99, ...v },
        { yes: "Yes", no: "No" },
      ),
    );
  assert.equal(
    parseAnswer(
      {
        type: "choice",
        choice: "yes",
        confidence: 0.99,
        probabilities: { yes: 0.55, no: 0.45 },
      },
      { yes: "Yes", no: "No" },
    ).confidence,
    0.55,
  );
});
test("a valid supported finding cites only verbatim retrieved text", async () => {
  const result = await judged();
  assert.equal(result.status, "supported");
  assert.equal(result.evidence, passage);
  assert.equal(result.fix, undefined);
});
test("conflicting reasoning vetoes a supported verdict", async () => {
  const result = await judged((a) => {
    const criteria = Object.fromEntries(
      Object.keys(a.reason.probabilities).map((k) => [k, k]),
    );
    a.reason = answer(criteria, "conflict");
  });
  assert.equal(result.status, "uncertain");
  assert.equal(result.fix, undefined);
});
test("weak selected-passage probability vetoes a supported verdict", async () => {
  const result = await judged((a) => {
    a.passage.confidence = 0.6;
    a.passage.probabilities = { p0: 0.6, none: 0.4 };
  });
  assert.equal(result.status, "uncertain");
});
test("unknown or fabricated passage identifiers fail closed", async () => {
  const result = await judged((a) => {
    a.passage.choice = "p99";
  });
  assert.equal(result.method, "unverified");
  assert.equal(result.evidence, undefined);
});
test("fabricated caller-supplied evidence cannot be substituted for retrieved text", async () => {
  const result = await judged(() => {}, source, [
    "Invented evidence says all students benefit.",
  ]);
  assert.equal(result.method, "unverified");
  assert.equal(result.status, "uncertain");
});
test("metadata-only access cannot be promoted by stray passages", async () => {
  const result = await judged(
    () => {
      throw Error("Provider must not be called");
    },
    { ...source, access: "metadata" },
  );
  assert.equal(result.status, "source_unavailable");
});
test("known publication notices block positive clearance and generated fixes", async () => {
  const result = await judged(() => {}, {
    ...source,
    publicationWarning: true,
  });
  assert.equal(result.status, "uncertain");
  assert.equal(result.fix, undefined);
  assert.match(result.explanation, /publication notice/);
});
test("a selected quotation from a different passage is not offered as a fix", async () => {
  const other =
    "Different research examined employment outcomes among retired adults.";
  const result = await judged(
    (a) => {
      a.verdict = answer(
        Object.fromEntries(
          Object.keys(a.verdict.probabilities).map((k) => [k, k]),
        ),
        "overstated",
      );
      a.replacement = answer(
        Object.fromEntries(
          Object.keys(a.replacement.probabilities).map((k) => [k, k]),
        ),
        "s1",
      );
    },
    { ...source, passages: [passage, other] },
    [passage, other],
  );
  assert.equal(result.fix, undefined);
});
test("DOI lookup rejects a registry response for a different paper", async () => {
  const stub = mock.method(globalThis, "fetch", async () =>
    Response.json({
      message: { DOI: "10.1000/wrong-paper", type: "journal-article" },
    }),
  );
  try {
    await assert.rejects(
      resolveDOI("10.1000/requested-paper"),
      /different DOI/,
    );
  } finally {
    stub.mock.restore();
  }
});
const paper: ClassPaper = {
  id: "li",
  metadata: source,
  mla: {
    ...blankMlaSource,
    authors: "Li, Jane",
    title: source.title,
    doi: source.doi!,
  },
  url: "",
  accessed: "2026-09-29",
  firstPage: 1,
  pages: [{ index: 1, text: source.title + ". " + passage }],
  checks: [],
};
test("narrative citations use author boundaries, never a surname substring", () => {
  assert.equal(
    citationRefs("Valid research reports improvement (1).", [paper]).length,
    0,
  );
  assert.equal(
    citationRefs("Li reports improvement (1).", [paper])[0].sourceId,
    "li",
  );
});
test("rearranged title words cannot pass PDF identity and uploaded length is not completeness", () => {
  const checks = inspectPaper({
    ...paper,
    pages: [
      {
        index: 1,
        text: "Adults among tutoring. Another paper with similar title words.",
      },
    ],
  });
  assert.equal(checks.find((c) => c.label === "PDF identity")?.status, "issue");
  assert.equal(checks.find((c) => c.label === "Full PDF")?.status, "manual");
});
test("metadata refresh failure blocks page evidence judgments even with a previously valid source", async () => {
  let evidenceCalls = 0;
  const stub = mock.method(
    globalThis,
    "fetch",
    async (u: any, init?: RequestInit) => {
      if (!String(u).includes("typesafe")) throw Error("Registry unavailable");
      const body = JSON.parse(String(init?.body));
      if (body.questions.verdict) evidenceCalls++;
      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([k, q]: [string, any]) => [
            k,
            answer(q.criteria, Object.keys(q.criteria)[0]),
          ]),
        ),
      });
    },
  );
  try {
    const report = await reviewClass(
      "Tutoring improved adult reading scores (Li 1).",
      [structuredClone(paper)],
      "draft",
    );
    assert.equal(evidenceCalls, 0);
    assert.equal(report.sentences[0].citations[0].pageCheck.status, "issue");
    assert.equal(report.sentences[0].citations[0].finding, undefined);
  } finally {
    stub.mock.restore();
  }
});

test("a wider-article conflict or failed context check cannot leave a supported page verdict", () => {
  const page = {
    ...claim,
    status: "supported" as const,
    method: "Jev" as const,
    evidence: passage,
    explanation: "Supported",
  };
  for (const status of [
    "contradicted",
    "overstated",
    "partial",
    "not_addressed",
    "uncertain",
  ] as const) {
    assert.equal(
      reconcileEvidence(page, { ...page, status }).status,
      "uncertain",
    );
  }
  assert.equal(
    reconcileEvidence({ ...page, status: "not_addressed" }, page).status,
    "not_addressed",
  );
  assert.equal(reconcileEvidence(page, page).status, "supported");
});

test("three edited copies of one DOI never count as three academic articles", () => {
  const papers = ["Li", "Smith", "Jones"].map((author, i) => ({
    ...structuredClone(paper),
    id: "copy" + i,
    metadata: { ...paper.metadata, publicationType: "Journal article" },
    mla: { ...paper.mla, authors: author + ", Jane" },
  }));
  const result = assignmentChecks(
    "One result (Li 1). Another (Smith 1). A third (Jones 1).",
    papers,
    "draft",
  );
  assert.equal(
    result.checks.find((c) => c.label === "Three different academic articles")
      ?.status,
    "issue",
  );
});

test("publication notices found in discovery survive a fresh DOI lookup for class citation checks", async () => {
  const doi = "10.1000/notice-propagation";
  recordPublicationNotice(doi);
  const stub = mock.method(globalThis, "fetch", async (u: any) =>
    String(u).includes("crossref")
      ? Response.json({
          message: {
            DOI: doi,
            type: "journal-article",
            title: ["Notice propagation fixture"],
          },
        })
      : Response.json({ resultList: { result: [] } }),
  );
  try {
    assert.equal((await resolveDOI(doi, true)).publicationWarning, true);
  } finally {
    stub.mock.restore();
  }
});
