import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import { pageText } from "../evidence.js";
import { limits } from "./config.js";
import {
  imageCoverage,
  nativeReadingOrder,
  textQualityReasons,
} from "./pdf-native.js";
export interface ParsedPage {
  index: number;
  label?: string;
  labelStatus: "embedded" | "unknown";
  text: string;
  status: "readable" | "unreadable" | "omitted";
  // A physically empty PDF page has no pixels or text for recognition to read.
  recognitionRequired?: boolean;
  blocks: { start: number; end: number; coordinates?: number[] }[];
}
export interface ParsedFile {
  pages: ParsedPage[];
  coverage: {
    totalPages: number;
    readablePages: number;
    unreadablePages: number[];
    omittedPages: number[];
    warnings: string[];
  };
}
export function passageSpans(text: string, maximum = 1400) {
  const spans: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maximum, text.length);
    if (end < text.length) {
      const stop = text.lastIndexOf(" ", end);
      if (stop > start + maximum / 2) end = stop;
    }
    const raw = text.slice(start, end),
      leading = raw.length - raw.trimStart().length;
    if (raw.trim())
      spans.push({
        start: start + leading,
        end: start + raw.trimEnd().length,
        text: raw.trim(),
      });
    start = end;
  }
  return spans;
}
export async function extractFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedFile> {
  if (buffer.length > limits.fileBytes) throw new Error("File exceeds 64 MB.");
  const pages: ParsedPage[] = [];
  const warnings: string[] = [];
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    if (!buffer.subarray(0, 1024).toString().includes("%PDF-"))
      throw new Error("File contents do not match PDF type.");
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    try {
      const pdf = await task.promise;
      const labels = await pdf.getPageLabels();
      let characters = 0;
      for (let index = 1; index <= pdf.numPages; index++) {
        const page: ParsedPage = {
          index,
          label: labels?.[index - 1] || undefined,
          labelStatus: labels?.[index - 1] ? "embedded" : "unknown",
          text: "",
          status: "unreadable",
          blocks: [],
        };
        pages.push(page);
        if (index > limits.pages || characters >= limits.characters) {
          page.status = "omitted";
          continue;
        }
        try {
          const handle = await pdf.getPage(index);
          const content = await handle.getTextContent();
          const viewport = handle.getViewport({ scale: 1 });
          const native = content.items.filter(
            (item) => "str" in item && item.str.trim(),
          );
          const ordered = nativeReadingOrder(native as any, viewport.width);
          if (ordered.columns)
            warnings.push(
              `File page ${index}: native text was ordered by its two prose columns.`,
            );
          let lastY: number | undefined;
          for (const item of ordered.items)
            if ("str" in item && item.str) {
              const y = item.transform[5];
              const separator = page.text
                ? lastY !== undefined && Math.abs(lastY - y) > 2
                  ? "\n"
                  : " "
                : "";
              page.text += separator;
              const start = page.text.length;
              page.text += item.str;
              page.blocks.push({
                start,
                end: page.text.length,
                coordinates: [item.transform[4], y, item.width, item.height],
              });
              lastY = y;
            }
          if (characters + page.text.length > limits.characters) {
            page.text = "";
            page.blocks = [];
            page.status = "omitted";
          } else {
            let images = 0;
            if (page.text.replace(/\s/g, "").length < 500) {
              const operators = await handle.getOperatorList();
              if (!page.text.trim() && operators.fnArray.length === 0)
                page.recognitionRequired = false;
              images = imageCoverage(
                operators,
                viewport.width * viewport.height,
              );
            }
            const reasons = textQualityReasons(page.text, images);
            page.status = reasons.length ? "unreadable" : "readable";
            if (reasons.length) {
              warnings.push(
                `File page ${index}: ${reasons.join("; ")}. Native text was not indexed.`,
              );
              // Partial headers and corrupt glyphs cannot become evidence.
              page.text = "";
              page.blocks = [];
            } else characters += page.text.length;
          }
          handle.cleanup();
        } catch {
          page.text = "";
          page.blocks = [];
          page.status = "unreadable";
          warnings.push(`Could not extract file page ${index}.`);
        }
      }
    } finally {
      await task.destroy();
    }
    warnings.push(
      "Embedded labels are file metadata, not confirmed printed page numbers. Figures and image text need review.",
    );
  } else {
    let text: string;
    if (ext === "docx") {
      if (buffer.subarray(0, 2).toString() !== "PK")
        throw new Error("Invalid DOCX contents.");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      warnings.push(...result.messages.map((m) => m.message));
    } else if (["txt", "md", "html", "xml"].includes(ext || "")) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (text.includes("\0"))
        throw new Error("Binary contents are not source text.");
    } else throw new Error("Use PDF, DOCX, TXT, or Markdown.");
    if (ext === "html") text = pageText(text);
    if (text.length > limits.characters)
      throw new Error(
        "Text exceeds extraction limit; no partial file was indexed.",
      );
    pages.push({
      index: 1,
      labelStatus: "unknown",
      text,
      status: text.trim().length >= 30 ? "readable" : "unreadable",
      blocks: passageSpans(text).map(({ start, end }) => ({ start, end })),
    });
    warnings.push(
      "This format has no reliable physical pagination. Location 1 identifies the text snapshot.",
    );
  }
  return {
    pages,
    coverage: {
      totalPages: pages.length,
      readablePages: pages.filter((p) => p.status === "readable").length,
      unreadablePages: pages
        .filter((p) => p.status === "unreadable")
        .map((p) => p.index),
      omittedPages: pages
        .filter((p) => p.status === "omitted")
        .map((p) => p.index),
      warnings,
    },
  };
}
