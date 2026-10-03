import test from "node:test";
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
