import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PaperPage } from "../shared/classroom.js";
// Multipart libraries decode legacy filename headers as Latin-1. Recover valid
// UTF-8 without corrupting a filename that was already decoded correctly.
export function uploadFilename(name: string): string {
  if ([...name].some((c) => c.codePointAt(0)! > 255)) return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(name, "latin1"),
    );
  } catch {
    return name;
  }
}
export async function readPdfPages(buffer: Buffer): Promise<PaperPage[]> {
  if (!buffer.subarray(0, 1024).toString().includes("%PDF-"))
    throw new Error("Upload the full article as a PDF.");
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100)
      throw new Error("Use a PDF with 100 pages or fewer.");
    const labels = await pdf.getPageLabels();
    const pages: PaperPage[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let text = "";
      let lastY: number | undefined;
      for (const item of content.items)
        if ("str" in item) {
          const y = item.transform[5];
          text +=
            (text
              ? lastY !== undefined && Math.abs(lastY - y) > 2
                ? "\n"
                : " "
              : "") + item.str;
          lastY = y;
        }
      pages.push({
        index: i,
        label: labels?.[i - 1] || undefined,
        text: text.trim(),
      });
    }
    if (pages.every((p) => p.text.length < 30))
      throw new Error(
        "This PDF has no readable text. Use a text PDF or run OCR first.",
      );
    if (pages.reduce((n, p) => n + p.text.length, 0) > 500000)
      throw new Error("The article exceeds 500,000 characters.");
    return pages;
  } finally {
    await task.destroy();
  }
}
export async function parseDocument(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const extension = filename.toLowerCase().split(".").pop();
  let text = "";
  if (extension === "txt" || extension === "md") text = buffer.toString("utf8");
  else if (extension === "docx") {
    if (buffer.subarray(0, 2).toString() !== "PK")
      throw new Error("This file is not a valid Word document.");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (extension === "pdf") {
    if (!buffer.subarray(0, 1024).toString().includes("%PDF-"))
      throw new Error("This file is not a valid PDF.");
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > 100)
        throw new Error("Upload a PDF with 100 pages or fewer.");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        const lines: { text: string; y: number; height: number }[] = [];
        for (const item of content.items)
          if ("str" in item && item.str.trim()) {
            const y = item.transform[5];
            const height = Math.abs(item.transform[3]) || 12;
            const last = lines.at(-1);
            if (last && Math.abs(last.y - y) < 2) last.text += " " + item.str;
            else lines.push({ text: item.str, y, height });
          }
        let page = "";
        for (let n = 0; n < lines.length; n++) {
          const line = lines[n],
            previous = lines[n - 1];
          const heading = (t: string) =>
            /^(works cited|references|bibliography)$/i.test(t.trim());
          const paragraph =
            previous &&
            (Math.abs(previous.y - line.y) >
              Math.max(previous.height, line.height) * 1.7 ||
              previous.height > line.height * 1.15 ||
              line.height > previous.height * 1.15 ||
              heading(previous.text) ||
              heading(line.text));
          page += (n ? (paragraph ? "\n\n" : " ") : "") + line.text;
        }
        pages.push(page.trim());
      }
      text = pages.join("\n\n");
    } finally {
      await loadingTask.destroy();
    }
  } else throw new Error("Choose a .docx, .pdf, .txt, or .md file.");
  if (text.trim().length < 20)
    throw new Error(
      "No readable text found. Scanned PDFs need OCR before uploading.",
    );
  if (text.length > 150000)
    throw new Error(
      "The extracted text is too long. Upload a shorter section.",
    );
  return text.trim();
}
