import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { extractFile } from "../server/backend/extraction.js";
import { textQualityReasons } from "../server/backend/pdf-native.js";
import { ocrUnreadable } from "../server/backend/ocr.js";

test("native extraction reads regular PDFs without any recognition request", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const text = "The review included 218 studies and 14,170 participants.";
  pdf.addPage().drawText(text, { x: 30, y: 700, size: 12, font });
  const buffer = Buffer.from(await pdf.save());
  const native = await extractFile(buffer, "native.pdf");
  assert.equal(native.pages[0].status, "readable");
  assert.equal(native.pages[0].text, text);
  const recovered = await ocrUnreadable(
    buffer,
    native,
    { allowExternalProcessing: true },
    {
      apiKey: "test",
      fetch: async () => {
        throw new Error("Native PDF must not be uploaded");
      },
    },
  );
  assert.deepEqual(recovered.parsed, native);
  assert.deepEqual(recovered.usage, []);
});

test("physically empty PDF pages do not trigger paid recognition", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const buffer = Buffer.from(await pdf.save());
  const parsed = await extractFile(buffer, "empty.pdf");
  const result = await ocrUnreadable(
    buffer,
    parsed,
    { allowExternalProcessing: true },
    {
      apiKey: "test",
      fetch: async () => {
        throw new Error("An empty page must not be uploaded");
      },
    },
  );
  assert.equal(parsed.pages[0].recognitionRequired, false);
  assert.equal(result.usage.length, 0);
  assert.equal(result.parsed.pages[0].text, "");
});

test("native extraction orders interleaved prose columns and keeps headings and exact block spans", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([650, 800]);
  const title = "Study methods and findings across the full width of the page";
  page.drawText(title, { x: 40, y: 740, size: 18, font });
  for (const [n, ordinal] of ["one", "two", "three", "four"].entries()) {
    page.drawText(
      `Left section row ${ordinal} describes the research sample.`,
      { x: 40, y: 690 - n * 18, size: 9, font },
    );
    page.drawText(
      `Right section row ${ordinal} explains the observed result.`,
      { x: 350, y: 690 - n * 18, size: 9, font },
    );
  }
  const footer =
    "This concluding paragraph extends across the page beneath both columns.";
  page.drawText(footer, { x: 40, y: 560, size: 14, font });
  const result = await extractFile(
    Buffer.from(await pdf.save()),
    "columns.pdf",
  );
  const text = result.pages[0].text;
  assert.equal(result.pages[0].status, "readable");
  assert.ok(
    text.indexOf("Left section row four") <
      text.indexOf("Right section row one"),
  );
  assert.ok(text.startsWith(title));
  assert.ok(text.endsWith(footer));
  assert.match(result.coverage.warnings.join("\n"), /two prose columns/);
  for (const block of result.pages[0].blocks) {
    assert.ok(text.slice(block.start, block.end).trim());
    assert.equal(block.coordinates?.length, 4);
  }
});

test("native extraction detects scan bodies behind readable headers and preserves normal illustrated text", async () => {
  const canvas = createCanvas(400, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 400, 500);
  context.fillStyle = "black";
  context.font = "18px sans-serif";
  context.fillText("This image contains the study body.", 20, 100);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  const text =
    "Research journal header with enough text to fool a length-only check.";
  const scan = pdf.addPage([400, 500]);
  scan.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
  scan.drawText(text, { x: 20, y: 460, size: 8, font });
  const native = pdf.addPage([400, 500]);
  native.drawImage(image, { x: 300, y: 400, width: 40, height: 50 });
  native.drawText(text, { x: 20, y: 350, size: 8, font });
  const result = await extractFile(Buffer.from(await pdf.save()), "mixed.pdf");
  assert.deepEqual(result.coverage.unreadablePages, [1]);
  assert.equal(result.pages[0].text, "");
  assert.deepEqual(result.pages[0].blocks, []);
  assert.match(result.coverage.warnings.join("\n"), /large page image/);
  assert.equal(result.pages[1].text, text);
  assert.equal(result.pages[1].status, "readable");
});

test("quality checks reject unmapped text without excluding non-Latin scripts or mathematics", () => {
  assert.match(
    textQualityReasons("Useful text " + "\uFFFD".repeat(40)).join(),
    /corrupted/,
  );
  assert.match(
    textQualityReasons("Useful text " + "\uE000".repeat(40)).join(),
    /unmapped/,
  );
  assert.deepEqual(
    textQualityReasons(
      "研究には二百十八人の参加者が含まれ、十二週間にわたって観察されました。",
    ),
    [],
  );
  assert.deepEqual(
    textQualityReasons(
      "The estimate is α + β = 12.5 and the study observed 218 participants.",
    ),
    [],
  );
  assert.deepEqual(
    textQualityReasons(
      "The evidence remains readable despite a single missing glyph \uFFFD.",
    ),
    [],
  );
});

test("native extraction does not join separate table labels into prose columns", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([650, 800]);
  page.drawText("Reported measurements by group and sample size", {
    x: 40,
    y: 740,
    size: 12,
    font,
  });
  for (let n = 0; n < 4; n++) {
    page.drawText(`Group ${n + 1}`, { x: 40, y: 700 - n * 20, size: 12, font });
    page.drawText(String(218 + n), { x: 350, y: 700 - n * 20, size: 12, font });
  }
  const result = await extractFile(Buffer.from(await pdf.save()), "table.pdf");
  assert.ok(
    result.pages[0].text.indexOf("218") <
      result.pages[0].text.indexOf("Group 2"),
  );
  assert.ok(
    !result.coverage.warnings.some((w) => w.includes("two prose columns")),
  );
});
