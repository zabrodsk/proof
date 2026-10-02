import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  allSentences,
  citationRefs,
  assignmentChecks,
  inspectPaper,
  reviewClass,
} from "../server/classroom.js";
import {
  classMla,
  locatorPages,
  pageRange,
  type ClassPaper,
} from "../shared/classroom.js";
import { readPdfPages } from "../server/documents.js";
import { publicIPv4, remoteFile } from "../server/remote.js";
import { blankMlaSource } from "../shared/mla.js";

function paper(): ClassPaper {
  return {
    id: "p1",
    metadata: {
      id: "p1",
      title: "Evidence for classroom research",
      authors: ["Jane Smith", "Robert Jones"],
      authorDetails: [
        { given: "Jane", family: "Smith" },
        { given: "Robert", family: "Jones" },
      ],
      year: "2024",
      doi: "10.1000/example",
      journal: "Research Journal",
      volume: "4",
      issue: "2",
      pages: "325-329",
      publicationType: "Journal article",
      provider: "Crossref",
      access: "metadata",
      passages: [],
      retrievedAt: "2026-09-29",
    },
    mla: {
      ...blankMlaSource,
      authors: "Smith, Jane\nJones, Robert",
      title: "Evidence for Classroom Research",
      journal: "Research Journal",
      volume: "4",
      issue: "2",
      year: "2024",
      pages: "325-329",
      doi: "10.1000/example",
    },
    url: "https://example.org/paper.pdf",
    accessed: "2026-09-29",
    firstPage: 325,
    pages: [
      {
        index: 1,
        text: "Evidence for classroom research. Jane Smith and Robert Jones. doi:10.1000/example. Study text.",
      },
    ],
    checks: [],
  };
}

test("class MLA follows the supplied two-author convention and includes the actual access date", () => {
  const entry = classMla(paper());
  assert.match(entry, /^Smith, Jane and Jones, Robert\./);
  assert.match(entry, /, Vol\. 4, no\. 2, 2024, pp\. 325-329/);
  assert.match(entry, /Accessed 29 Sept\. 2026\.$/);
});
test("shortened MLA ranges expand within the correct century", () => {
  assert.deepEqual(pageRange("325–29"), [325, 329]);
  assert.deepEqual(pageRange("199-203"), [199, 203]);
  assert.deepEqual(locatorPages("325–27, 329"), [325, 326, 327, 329]);
  assert.deepEqual(locatorPages("e123"), []);
  assert.deepEqual(locatorPages("1-99"), []);
});
test("every body sentence keeps exact offsets, including short sentences and et al citations", () => {
  const text =
    "A title\nIt works. Why? Results were mixed (Smith et al. 325).\n\nWorks Cited\nSmith, Jane. A book.";
  const sentences = allSentences(text);
  assert.equal(sentences.length, 4);
  for (const s of sentences) assert.equal(text.slice(s.start, s.end), s.text);
  assert.match(sentences[3].text, /Smith et al\. 325/);
});
test("citation counting preserves repetitions and supports narrative and combined page citations", () => {
  const p = paper();
  let refs = citationRefs(
    "One finding (Smith and Jones 325). Another (Smith and Jones 325).",
    [p],
  );
  assert.equal(refs.length, 2);
  assert.ok(refs.every((r) => r.sourceId === p.id));
  refs = citationRefs("Smith and Jones report a result (326).", [p]);
  assert.equal(refs[0].sourceId, p.id);
  assert.equal(refs[0].locator, "326");
  assert.equal(citationRefs("Sample size (n = 50).", [p]).length, 0);
  refs = citationRefs("A result (Unknown 325; Smith and Jones 326).", [p]);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].sourceId, undefined);
});
test("same-author ambiguity never chooses a paper arbitrarily", () => {
  const p = paper();
  const second = {
    ...paper(),
    id: "p2",
    mla: { ...paper().mla, title: "Another research article" },
  };
  assert.equal(
    citationRefs("A result (Smith and Jones 325).", [p, second])[0].sourceId,
    undefined,
  );
});
test("the draft and earlier four-source assignment have different requirements", () => {
  const p = paper();
  const text =
    "A finding (Smith and Jones 325).\n\nBibliography\n" + classMla(p);
  const draft = assignmentChecks(text, [p], "draft");
  assert.equal(draft.citationCount, 1);
  assert.equal(
    draft.checks.find((c) => c.label === "Bibliography heading")?.status,
    "pass",
  );
  assert.equal(
    draft.checks.find((c) => c.label === "Three different academic articles")
      ?.status,
    "issue",
  );
  const earlier = assignmentChecks(text, [p], "bibliography");
  assert.ok(!earlier.checks.some((c) => c.label.includes("600")));
  assert.equal(
    earlier.checks.find((c) => c.label === "Four bibliography entries")?.status,
    "issue",
  );
});
test("PDF and source checks flag wrong, incomplete and unreadable papers without claiming peer review", () => {
  const p = paper();
  p.pages = [
    { index: 1, text: "A completely different paper about coral reefs." },
  ];
  const checks = inspectPaper(p);
  assert.equal(checks.find((c) => c.label === "PDF identity")?.status, "issue");
  assert.equal(
    checks.find((c) => c.label === "PDF completeness")?.status,
    "issue",
  );
  assert.equal(
    checks.find((c) => c.label === "Scholarly quality and relevance")?.status,
    "manual",
  );
  assert.equal(
    checks.find((c) => c.label === "Printed page mapping")?.status,
    "manual",
  );
});
test("real PDF parsing preserves page boundaries", async () => {
  const pages = await readPdfPages(
    await readFile(new URL("./fixtures/research.pdf", import.meta.url)),
  );
  assert.ok(pages.length > 0);
  assert.equal(pages[0].index, 1);
  assert.ok(pages[0].text.length > 30);
  await assert.rejects(() => readPdfPages(Buffer.from("not a pdf")), /PDF/);
});
test("document downloads reject private, loopback, metadata and non-HTTPS targets", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.31.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  await assert.rejects(() => remoteFile("http://example.org/a.pdf"), /HTTPS/);
  await assert.rejects(
    () => remoteFile("https://user:pass@example.org/a.pdf"),
    /HTTPS/,
  );
});
test("provider failure leaves every sentence explicitly incomplete", async () => {
  process.env.TYPESAFE_API_KEY = "test";
  const stub = mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  try {
    const r = await reviewClass(
      "Dušan Zábrodský\nIoanna Mavridou\n4G2 English\n14 January 2026\nThis is one claim. Is this another claim?",
      [],
      "draft",
    );
    assert.equal(r.coverage.total, 2);
    assert.equal(r.coverage.skipped, 4);
    assert.equal(r.coverage.completed, 0);
    assert.deepEqual(
      r.sentences.map((s) => s.text),
      ["This is one claim.", "Is this another claim?"],
    );
    assert.ok(r.sentences.every((s) => !s.completed));
  } finally {
    stub.mock.restore();
  }
});

test("public document DNS admits globally routable 192.0 addresses while rejecting special-purpose blocks", () => {
  assert.equal(publicIPv4("192.0.66.161"), true);
  assert.equal(publicIPv4("169.154.128.121"), true);
  for (const ip of [
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.2",
    "198.51.100.1",
    "203.0.113.1",
  ])
    assert.equal(publicIPv4(ip), false);
});
