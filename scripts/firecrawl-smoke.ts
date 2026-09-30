import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { extractFile } from "../server/backend/extraction.js";
import { ocrUnreadable } from "../server/backend/ocr.js";
import { providerKey } from "../server/backend/providers.js";

// This live check sends only generated test text. It never reads user files.
const key = providerKey("FIRECRAWL_API_KEY");
if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");

const canvas = createCanvas(1275, 1650);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "black";
context.font = "42px sans-serif";
const lines = [
  "Synthetic OCR research source",
  "The study included 218 participants.",
  "Participants walked for 30 minutes daily.",
  "The trial lasted twelve weeks.",
  "This page contains generated test text only.",
];
lines.forEach((line, index) => context.fillText(line, 80, 140 + index * 90));

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const nativePage = pdf.addPage([612, 792]);
nativePage.drawText(
  "Native source text stays unchanged and is never sent for OCR.",
  {
    x: 50,
    y: 700,
    font,
    size: 14,
  },
);
const scan = pdf.addPage([612, 792]);
const image = await pdf.embedPng(canvas.toBuffer("image/png"));
scan.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
pdf.catalog.set(
  PDFName.of("PageLabels"),
  pdf.context.obj({
    Nums: [0, { P: PDFString.of("intro") }, 1, { P: PDFString.of("scan-7") }],
  }),
);
const buffer = Buffer.from(await pdf.save());
const parsed = await extractFile(buffer, "synthetic-scan.pdf");
assert.deepEqual(parsed.coverage.unreadablePages, [2]);
assert.equal(parsed.pages[1].label, "scan-7");

const started = Date.now();
const { parsed: recovered, usage } = await ocrUnreadable(
  buffer,
  parsed,
  { allowExternalProcessing: true, maxPages: 1 },
  { apiKey: key },
);
// Print only synthetic text and status. Never print request headers or keys.
console.log(
  JSON.stringify(
    {
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      originalUnreadablePages: parsed.coverage.unreadablePages,
      recoveredCoverage: recovered.coverage,
      page: {
        index: recovered.pages[1].index,
        label: recovered.pages[1].label,
        status: recovered.pages[1].status,
        text: recovered.pages[1].text,
      },
      usage,
    },
    null,
    2,
  ),
);
assert.deepEqual(recovered.pages[0], parsed.pages[0]);
assert.equal(recovered.pages[1].index, 2);
assert.equal(recovered.pages[1].label, "scan-7");
assert.equal(recovered.pages[1].labelStatus, "embedded");
assert.deepEqual(recovered.coverage.unreadablePages, []);
assert.match(recovered.pages[1].text, /218 participants/i);
assert.match(recovered.pages[1].text, /30 minutes daily/i);
assert.equal(
  usage.filter((attempt) => attempt.status === "complete").length,
  1,
);
