import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { ocrUnreadable } from "../server/backend/ocr.js";
import type { ParsedFile } from "../server/backend/extraction.js";

async function fixture(
  count = 3,
): Promise<{ buffer: Buffer; parsed: ParsedFile }> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) pdf.addPage([200 + i, 300]);
  const pages: ParsedFile["pages"] = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    label: `label-${i}`,
    labelStatus: "embedded",
    text: "",
    status: "unreadable",
    blocks: [],
  }));
  return {
    buffer: Buffer.from(await pdf.save()),
    parsed: {
      pages,
      coverage: {
        totalPages: count,
        readablePages: 0,
        unreadablePages: pages.map((p) => p.index),
        omittedPages: [],
        warnings: [],
      },
    } satisfies ParsedFile,
  };
}
const success = () =>
  Response.json({
    success: true,
    data: {
      markdown:
        "The recovered source text describes a study with 218 participants.",
    },
  });

test("OCR never sends document bytes without consent or a configured key", async () => {
  const { buffer, parsed } = await fixture();
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return success();
  };
  for (const [allowExternalProcessing, apiKey] of [
    [false, "test"],
    [true, ""],
  ] as const) {
    const result = await ocrUnreadable(
      buffer,
      parsed,
      { allowExternalProcessing },
      { apiKey, fetch: request },
    );
    assert.equal(calls, 0);
    assert.deepEqual(result.parsed.coverage.unreadablePages, [1, 2, 3]);
    assert.equal(result.usage.length, 0);
    assert.ok(result.parsed.coverage.warnings.length);
  }
});

test("OCR uploads only isolated unreadable pages, preserving physical indices and labels", async () => {
  const { buffer, parsed } = await fixture();
  parsed.pages[0].status = "readable";
  parsed.pages[0].text =
    "Existing source text must be preserved without upload.";
  parsed.pages[2].status = "omitted";
  parsed.coverage = {
    ...parsed.coverage,
    readablePages: 1,
    unreadablePages: [2],
    omittedPages: [3],
  };
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.firecrawl.dev/v2/parse");
    assert.ok(init?.signal);
    const form = init?.body as FormData;
    assert.deepEqual(JSON.parse(form.get("options") as string), {
      formats: ["markdown"],
      parsers: [{ type: "pdf", mode: "ocr", maxPages: 1, pages: true }],
      timeout: 60_000,
    });
    const file = form.get("file") as File;
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getPage(0).getWidth(), 201);
    return success();
  };
  const result = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    { apiKey: "test", fetch: request },
  );
  assert.equal(calls, 1);
  assert.equal(result.parsed.pages[1].index, 2);
  assert.equal(result.parsed.pages[1].label, "label-1");
  assert.equal(result.parsed.pages[1].labelStatus, "embedded");
  assert.equal(result.parsed.pages[1].status, "readable");
  assert.deepEqual(result.parsed.pages[0], parsed.pages[0]);
  assert.deepEqual(result.parsed.pages[2], parsed.pages[2]);
  assert.equal(parsed.pages[1].status, "unreadable");
  assert.deepEqual(result.parsed.coverage.unreadablePages, []);
  assert.deepEqual(result.parsed.coverage.omittedPages, [3]);
  assert.equal(result.usage[0].estimatedUsd, null);
  assert.equal(result.usage[0].charge, "unknown");
});

test("OCR uses the isolated physical page and rejects mismatched provider page maps", async () => {
  const { buffer, parsed } = await fixture(1);
  const text = "The recovered source study included 218 participants.";
  const result = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    {
      apiKey: "test",
      fetch: async () =>
        Response.json({
          success: true,
          data: {
            markdown:
              "Document-level text has a different layout and must not replace the physical page.",
            pages: [{ pageNumber: 1, markdown: text }],
          },
        }),
    },
  );
  assert.equal(result.parsed.pages[0].text, text);
  assert.equal(result.parsed.pages[0].label, "label-0");
  assert.deepEqual(result.parsed.pages[0].blocks, [
    { start: 0, end: text.length },
  ]);

  for (const pages of [
    [],
    [{ pageNumber: 2, markdown: text }],
    [
      { pageNumber: 1, markdown: text },
      { pageNumber: 2, markdown: text },
    ],
    [{ pageNumber: 1 }],
    "invalid",
  ]) {
    const failed = await ocrUnreadable(
      buffer,
      parsed,
      { allowExternalProcessing: true },
      {
        apiKey: "test",
        fetch: async () =>
          Response.json({ success: true, data: { markdown: text, pages } }),
      },
    );
    assert.equal(failed.usage[0].status, "invalid_page_map");
    assert.equal(failed.parsed.pages[0].text, "");
    assert.deepEqual(failed.parsed.coverage.unreadablePages, [1]);
  }
});

test("OCR keeps short output and provider errors unverified", async () => {
  const { buffer, parsed } = await fixture(1);
  for (const payload of [
    {
      success: false,
      data: {
        markdown:
          "This is error-body text and must never become source evidence.",
      },
    },
    {
      data: {
        markdown: "This response does not confirm successful document parsing.",
      },
    },
    { success: true, data: { pages: [{ pageNumber: 1, markdown: "page 1" }] } },
  ]) {
    const result = await ocrUnreadable(
      buffer,
      parsed,
      { allowExternalProcessing: true },
      { apiKey: "test", fetch: async () => Response.json(payload) },
    );
    assert.equal(result.usage[0].status, "unreadable");
    assert.deepEqual(result.parsed.coverage.unreadablePages, [1]);
    assert.equal(result.parsed.pages[0].status, "unreadable");
  }
});

test("OCR retries transient failures at most once and records each attempt", async () => {
  const { buffer, parsed } = await fixture(1);
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 503 }) : success();
  };
  const result = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    { apiKey: "test", fetch: request },
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.usage.map((p) => p.status),
    ["http_503", "complete"],
  );
  const failed = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    {
      apiKey: "test",
      fetch: async () => {
        throw new Error("network");
      },
    },
  );
  assert.equal(failed.usage.length, 2);
  assert.deepEqual(failed.parsed.coverage.unreadablePages, [1]);
});

test("OCR stops on denied provider access and enforces the hard twenty-page cap", async () => {
  const { buffer, parsed } = await fixture(22);
  const capped = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true, maxPages: 500 },
    {
      apiKey: "test",
      fetch: async (_url, init) => {
        const { parsers } = JSON.parse(
          (init!.body as FormData).get("options") as string,
        );
        return Response.json({
          success: true,
          data: {
            pages: Array.from({ length: parsers[0].maxPages }, (_, n) => ({
              pageNumber: n + 1,
              markdown:
                "The recovered study included 218 participants and lasted twelve weeks.",
            })),
          },
        });
      },
    },
  );
  assert.equal(capped.usage.length, 20);
  assert.deepEqual(capped.parsed.coverage.unreadablePages, [21, 22]);
  const denied = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    { apiKey: "test", fetch: async () => new Response(null, { status: 401 }) },
  );
  assert.equal(denied.usage.length, 4);
  assert.equal(new Set(denied.usage.map((u) => u.requestId)).size, 1);
  assert.equal(denied.parsed.coverage.unreadablePages.length, 22);
});

test("OCR batches only unreadable pages and restores noncontiguous physical page identities", async () => {
  const { buffer, parsed } = await fixture(9);
  for (const index of [2, 5, 8]) {
    parsed.pages[index - 1].status = "readable";
    parsed.pages[index - 1].text =
      "Native page text is preserved and never uploaded.";
  }
  const requests: number[][] = [];
  const ledger: { page: number; status: string; request: string }[] = [];
  const result = await ocrUnreadable(
    buffer,
    parsed,
    {
      allowExternalProcessing: true,
      onUsage: async (u) => {
        ledger.push({
          page: u.pageIndex,
          status: u.status,
          request: u.requestId,
        });
      },
    },
    {
      apiKey: "test",
      fetch: async (_url, init) => {
        const form = init!.body as FormData;
        const pdf = await PDFDocument.load(
          await (form.get("file") as File).arrayBuffer(),
        );
        const originalPages = pdf.getPages().map((p) => p.getWidth() - 199);
        requests.push(originalPages);
        const options = JSON.parse(form.get("options") as string);
        assert.equal(options.parsers[0].maxPages, originalPages.length);
        // Providers can return an array in any order. Page numbers, not array
        // positions, must decide which original page receives the evidence.
        return Response.json({
          success: true,
          data: {
            pages: originalPages
              .map((physical, n) => ({
                pageNumber: n + 1,
                markdown: `Recovered evidence from original physical page ${physical} reports 218 participants.`,
              }))
              .reverse(),
          },
        });
      },
    },
  );
  assert.deepEqual(requests, [
    [1, 3, 4, 6],
    [7, 9],
  ]);
  assert.equal(new Set(result.usage.map((u) => u.requestId)).size, 2);
  assert.equal(result.usage.length, 6);
  assert.equal(ledger.filter((u) => u.status === "started").length, 6);
  assert.equal(ledger.filter((u) => u.status === "complete").length, 6);
  for (const p of result.parsed.pages) {
    assert.equal(p.label, `label-${p.index - 1}`);
    if ([2, 5, 8].includes(p.index))
      assert.deepEqual(p, parsed.pages[p.index - 1]);
    else assert.match(p.text, new RegExp(`physical page ${p.index} reports`));
  }
  assert.deepEqual(result.parsed.coverage.unreadablePages, []);
});

test("OCR rejects ambiguous, incomplete, or duplicate page maps for batches", async () => {
  const { buffer, parsed } = await fixture(3);
  const text = "Recovered evidence describes a sample with 218 participants.";
  for (const pages of [
    undefined,
    [
      { pageNumber: 1, markdown: text },
      { pageNumber: 2, markdown: text },
    ],
    [1, 1, 3].map((pageNumber) => ({ pageNumber, markdown: text })),
    [1, 2, 4].map((pageNumber) => ({ pageNumber, markdown: text })),
  ]) {
    const result = await ocrUnreadable(
      buffer,
      parsed,
      { allowExternalProcessing: true },
      {
        apiKey: "test",
        fetch: async () =>
          Response.json({ success: true, data: { markdown: text, pages } }),
      },
    );
    assert.deepEqual(result.parsed.coverage.unreadablePages, [1, 2, 3]);
    assert.ok(result.usage.every((u) => u.status === "invalid_page_map"));
    assert.ok(result.parsed.pages.every((p) => p.text === ""));
  }
});

test("OCR retains per-page failures within a successful batch", async () => {
  const { buffer, parsed } = await fixture(3);
  const text = "Recovered evidence describes a sample with 218 participants.";
  const result = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    {
      apiKey: "test",
      fetch: async () =>
        Response.json({
          success: true,
          data: {
            pages: [
              { pageNumber: 1, markdown: text },
              { pageNumber: 2, markdown: "page 2" },
              { pageNumber: 3, markdown: "\uFFFD".repeat(100) },
            ],
          },
        }),
    },
  );
  assert.deepEqual(result.parsed.coverage.unreadablePages, [2, 3]);
  assert.deepEqual(
    result.usage.map((u) => u.status),
    ["complete", "unreadable", "unreadable"],
  );
});

test("OCR performs no upload when a batch page fails its preflight ledger check", async () => {
  const { buffer, parsed } = await fixture(3);
  let requests = 0;
  const statuses: string[] = [];
  await assert.rejects(
    ocrUnreadable(
      buffer,
      parsed,
      {
        allowExternalProcessing: true,
        onUsage: async (u) => {
          if (u.pageIndex === 2 && u.status === "started")
            throw new Error("page budget exhausted");
          statuses.push(`${u.pageIndex}:${u.status}`);
        },
      },
      {
        apiKey: "test",
        fetch: async () => {
          requests++;
          return success();
        },
      },
    ),
    /page budget exhausted/,
  );
  assert.equal(requests, 0);
  assert.deepEqual(statuses, ["1:started", "1:not_sent"]);
});
