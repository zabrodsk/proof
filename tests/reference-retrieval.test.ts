import test from "node:test";

test("publisher HTML remains usable full text when its PDF link fails", async () => {
  const article = "https://www.science.org/doi/10.1234/html";
  const title = "An exact reference title";
  const body =
    "The study found a lower recall rate in the tested population. ".repeat(25);
  const result = await retrieveNamedReference(
    { title, year: "2024", doi: "10.1234/html" },
    {
      search: async () => [{ url: article, title }] as any,
      download: async (target) => {
        if (target.endsWith(".pdf")) throw Error("PDF unavailable");
        return {
          url: target,
          type: "text/html",
          buffer: Buffer.from(
            `<meta name="citation_pdf_url" content="/paper.pdf"><meta name="citation_doi" content="10.1234/html"><article><h1>${title}</h1><p>2024</p><section id="article-body">${body}</section></article>`,
          ),
        };
      },
      extract: extractFile,
    },
  );
  assert.equal(result.source.access, "full_text");
  assert.ok(result.source.passages.join(" ").includes(body.trim()));
});

test("a conflicting publisher DOI cannot provide evidence for a selected reference", async () => {
  const article = "https://www.science.org/doi/10.1234/wrong";
  await assert.rejects(
    retrieveNamedReference(
      { title: "Memory study", year: "2024", doi: "10.1234/right" },
      {
        search: async () => [{ url: article, title: "Memory study" }] as any,
        download: async (url) => ({
          url,
          type: "text/html",
          buffer: Buffer.from(
            `<meta name="citation_doi" content="10.1234/wrong"><h1>Memory study 2024</h1><section id="abstract">${"A finding about memory in the tested population. ".repeat(10)}</section>`,
          ),
        }),
        extract: extractFile,
      },
    ),
    /different DOI/,
  );
});
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  originalReferenceUrl,
  retrieveNamedReference,
} from "../server/backend/reference-retrieval.js";
import { extractFile } from "../server/backend/extraction.js";

const reference = {
  title: "Updating the Liability Regime in Outer Space",
  authors: ["Reinhart, Alexander P."],
  authorDetails: [{ family: "Reinhart", given: "Alexander P." }],
  year: "2020",
  containerTitle: "William & Mary Law Review",
};
const url = "https://scholarship.example.edu/article.pdf";
async function pdf(title = reference.title) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  for (const [i, text] of [
    title,
    "Alexander P. Reinert",
    "William & Mary Law Review, 2020",
    ...Array.from(
      { length: 17 },
      (_, n) =>
        `Section ${n}: The original paper discusses liability for private space objects and international law.`,
    ),
  ].entries())
    page.drawText(text, { x: 30, y: 790 - 30 * i, font, size: 10 });
  return Buffer.from(await doc.save());
}
test("named reference retrieval retains original PDF and flags an author spelling mismatch", async () => {
  const body = await pdf();
  let searches = 0,
    downloads = 0;
  const result = await retrieveNamedReference(reference, {
    search: async (query) => {
      searches++;
      assert.equal(query, `"${reference.title}"`);
      return [{ url, title: reference.title }] as any;
    },
    download: async (target) => {
      downloads++;
      assert.equal(target, url);
      return { buffer: body, type: "application/pdf", url };
    },
    extract: extractFile,
  });
  assert.equal(searches, 1);
  assert.equal(downloads, 1);
  assert.equal(result.source.access, "full_text");
  assert.deepEqual(result.file?.buffer, body);
  assert.ok(result.identityWarnings.some((w) => w.includes("Reinert")));
  assert.deepEqual(result.source.authorDetails, [
    { family: "Reinert", given: "Alexander P." },
  ]);
});
test("an exact-title repository preview cannot become full-text evidence", async () => {
  await assert.rejects(
    retrieveNamedReference(reference, {
      search: async () =>
        [
          {
            url: "https://scholarship.example.edu/vol62/iss1/7/",
            title: reference.title,
          },
        ] as any,
      download: async (url) => ({
        url,
        type: "text/html",
        buffer: Buffer.from(
          `<html><h1>${reference.title}</h1><p>William &amp; Mary Law Review 2020</p>${"abstract description ".repeat(200)}</html>`,
        ),
      }),
      extract: extractFile,
    }),
    /complete article body/,
  );
});
test("similar papers and non-original hosts cannot establish selected-work evidence", async () => {
  assert.equal(
    originalReferenceUrl("https://random.example.com/paper.pdf"),
    false,
  );
  assert.equal(originalReferenceUrl("http://example.edu/paper.pdf"), false);
  await assert.rejects(
    retrieveNamedReference(reference, {
      search: async () => [{ url, title: "A Different Article" }] as any,
      download: async (url) => ({
        url,
        type: "application/pdf",
        buffer: await pdf("A different article about space law"),
      }),
      extract: extractFile,
    }),
    /different work/,
  );
});

test("a failed publisher PDF preserves its identified abstract as evidence", async () => {
  const abstract =
    "When people expect to have future access to information, they have lower rates of recall of the information itself and enhanced recall instead for where to access it.";
  const title = "Google effects on memory";
  const article = "https://www.science.org/doi/10.1126/science.1207745";
  const result = await retrieveNamedReference(
    { title, year: "2011", doi: "10.1126/science.1207745" },
    {
      search: async () => [{ url: article, title }] as any,
      download: async (target) => {
        if (target.endsWith(".pdf")) throw Error("PDF unavailable");
        return {
          url: target,
          type: "text/html",
          buffer: Buffer.from(
            `<html><meta name="citation_title" content="${title}"><meta name="citation_pdf_url" content="/paper.pdf"><h1>${title}</h1><p>Science 2011</p><section id="abstract"><h2>Abstract</h2><p>${abstract}</p></section></html>`,
          ),
        };
      },
      extract: extractFile,
    },
  );
  assert.equal(result.source.access, "abstract");
  assert.deepEqual(result.source.passages, [abstract]);
  assert.equal(result.source.url, article);
  assert.equal(result.source.doi, "10.1126/science.1207745");
  assert.equal(result.file, undefined);
});

test("readable pages from an incomplete PDF retain partial evidence without claiming full text", async () => {
  const text = `${reference.title}\n2020\n${"The source reports a narrowly scoped finding about liability. ".repeat(25)}`;
  const result = await retrieveNamedReference(reference, {
    search: async () => [{ url, title: reference.title }] as any,
    download: async () => ({
      url,
      type: "application/pdf",
      buffer: Buffer.from("%PDF-fixture"),
    }),
    extract: async () =>
      ({
        pages: [{ text }],
        coverage: { unreadablePages: [2], omittedPages: [], totalPages: 2 },
      }) as any,
  });
  assert.equal(result.source.access, "partial_text");
  assert.ok(
    result.source.passages.join(" ").includes("narrowly scoped finding"),
  );
  assert.equal(result.file, undefined);
});
