import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractFile } from "../server/backend/extraction.js";
import { ocrUnreadable } from "../server/backend/ocr.js";
import { providerKey } from "../server/backend/providers.js";

// Only generated test pages leave the machine. Credentials are never printed.
const apiKey = providerKey("FIRECRAWL_API_KEY");
if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured.");
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const expected = new Map<number, number>();
for (let physical = 1; physical <= 6; physical++) {
  const page = pdf.addPage([612, 792]);
  if (physical === 1 || physical === 4) {
    page.drawText(
      "Native evidence stays local and is never sent for recognition.",
      { x: 40, y: 700, size: 13, font },
    );
    continue;
  }
  const participants = 216 + physical;
  expected.set(physical, participants);
  const canvas = createCanvas(1275, 1650);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "42px sans-serif";
  [
    "Synthetic batch recognition test",
    `Original physical page ${physical}.`,
    `The study included ${participants} participants.`,
    "Participants walked for 30 minutes daily.",
    "Generated test text only.",
  ].forEach((line, n) => context.fillText(line, 80, 140 + n * 90));
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  // Deliberately provide >30 native characters over the scan, so this also
  // exercises the header-only detection that used to miss the scanned body.
  page.drawText("Readable journal header does not contain the research body.", {
    x: 40,
    y: 750,
    size: 8,
    font,
  });
}
const buffer = Buffer.from(await pdf.save());
const native = await extractFile(buffer, "synthetic-batch.pdf");
assert.deepEqual(native.coverage.unreadablePages, [...expected.keys()]);
let requests = 0;
const started = Date.now();
const result = await ocrUnreadable(
  buffer,
  native,
  { allowExternalProcessing: true },
  {
    apiKey,
    fetch: async (url, init) => {
      requests++;
      return fetch(url, init);
    },
  },
);
assert.equal(requests, 1);
assert.deepEqual(result.parsed.coverage.unreadablePages, []);
for (const [physical, participants] of expected) {
  const page = result.parsed.pages[physical - 1];
  assert.match(page.text, new RegExp(`physical page ${physical}`, "i"));
  assert.match(page.text, new RegExp(`${participants} participants`, "i"));
  assert.equal(page.index, physical);
}
for (const physical of [1, 4])
  assert.deepEqual(
    result.parsed.pages[physical - 1],
    native.pages[physical - 1],
  );
console.log(
  JSON.stringify({
    requests,
    recognizedPages: [...expected.keys()],
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    readablePages: result.parsed.coverage.readablePages,
    passed: true,
  }),
);
