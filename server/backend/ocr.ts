import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { limits } from "./config.js";
import {
  passageSpans,
  type ParsedFile,
  type ParsedPage,
} from "./extraction.js";
import { textQualityReasons } from "./pdf-native.js";
import { providerKey } from "./providers.js";

export interface OcrUsage {
  provider: "firecrawl";
  operation: "/v2/parse";
  pageIndex: number;
  attempt: number;
  status: string;
  estimatedUsd: null;
  charge: "unknown";
  // One ledger entry per billed page. Shared request IDs distinguish network
  // requests from page usage when several pages travel together.
  requestId: string;
  batchPages: number[];
}
interface OcrDependencies {
  apiKey?: string;
  fetch?: typeof fetch;
}

/** Native extraction has already failed for these pages. Upload only those
 * pages in batches of at most four, map physical output back to the original,
 * and never infer page boundaries from document-level markdown.
 * API contract: https://docs.firecrawl.dev/features/parse
 */
export async function ocrUnreadable(
  buffer: Buffer,
  input: ParsedFile,
  options: {
    allowExternalProcessing: boolean;
    maxPages?: number;
    onUsage?: (usage: OcrUsage) => Promise<void>;
  },
  dependencies: OcrDependencies = {},
): Promise<{ parsed: ParsedFile; usage: OcrUsage[] }> {
  const parsed = structuredClone(input);
  const usage: OcrUsage[] = [];
  const warnings = parsed.coverage.warnings;
  const unreadable = parsed.pages.filter(
    (page) =>
      page.status === "unreadable" && page.recognitionRequired !== false,
  );
  if (!unreadable.length) return { parsed, usage };
  if (!options.allowExternalProcessing) {
    warnings.push(
      "OCR was not attempted because external document processing is disabled. Unreadable pages still need readable text.",
    );
    return { parsed, usage };
  }
  const key = dependencies.apiKey ?? providerKey("FIRECRAWL_API_KEY");
  if (!key) {
    warnings.push(
      "OCR was not attempted because FIRECRAWL_API_KEY is not configured. Unreadable pages still need readable text.",
    );
    return { parsed, usage };
  }
  if (!buffer.subarray(0, 1024).toString().includes("%PDF-")) {
    warnings.push("OCR fallback supports PDF uploads only.");
    return { parsed, usage };
  }
  const requested = options.maxPages ?? 20;
  const maximum = Number.isFinite(requested)
    ? Math.min(20, Math.max(0, Math.floor(requested)))
    : 20;
  if (unreadable.length > maximum)
    warnings.push(
      `OCR is limited to ${maximum} unreadable pages per extraction. Remaining pages were not sent for OCR.`,
    );
  if (!maximum) return { parsed, usage };
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(buffer);
  } catch {
    warnings.push(
      "PDF pages could not be isolated for OCR. Unreadable pages still need readable text.",
    );
    return { parsed, usage };
  }
  const request = dependencies.fetch ?? fetch;
  const deadline = AbortSignal.timeout(180_000);
  let characters = parsed.pages.reduce(
    (sum, page) => sum + page.text.length,
    0,
  );
  let halt = false;
  const batches: ParsedPage[][] = [];
  const selected = unreadable.slice(0, maximum);
  for (let n = 0; n < selected.length; n += 4)
    batches.push(selected.slice(n, n + 4));
  while (batches.length && !deadline.aborted && !halt) {
    const batch = batches.shift()!;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const isolated = await PDFDocument.create();
      const copies = await isolated.copyPages(
        document,
        batch.map((p) => p.index - 1),
      );
      copies.forEach((copy) => isolated.addPage(copy));
      bytes = new Uint8Array(await isolated.save());
    } catch {
      warnings.push(
        `File pages ${batch.map((p) => p.index).join(", ")} could not be isolated for OCR.`,
      );
      continue;
    }
    if (bytes.length > 50 * 1024 * 1024) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        batches.unshift(batch.slice(0, middle), batch.slice(middle));
      } else
        warnings.push(
          `File page ${batch[0].index} exceeds the OCR upload limit and remains unreadable.`,
        );
      continue;
    }
    for (let attempt = 1; attempt <= 2 && !deadline.aborted; attempt++) {
      const requestId = randomUUID();
      const records: OcrUsage[] = batch.map((page) => ({
        provider: "firecrawl",
        operation: "/v2/parse",
        pageIndex: page.index,
        attempt,
        status: "started",
        estimatedUsd: null,
        charge: "unknown",
        requestId,
        batchPages: batch.map((p) => p.index),
      }));
      // Persist permission/budget/deletion checks for every page before upload.
      const started: OcrUsage[] = [];
      try {
        for (const record of records) {
          await options.onUsage?.(record);
          usage.push(record);
          started.push(record);
        }
      } catch (error) {
        for (const record of started) {
          record.status = "not_sent";
          await options.onUsage?.(record);
        }
        throw error;
      }
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: "application/pdf" }),
        "pages.pdf",
      );
      form.append(
        "options",
        JSON.stringify({
          formats: ["markdown"],
          parsers: [
            { type: "pdf", mode: "ocr", maxPages: batch.length, pages: true },
          ],
          timeout: 60_000,
        }),
      );
      const status = (value: string) =>
        records.forEach((record) => {
          record.status = value;
        });
      try {
        const response = await request("https://api.firecrawl.dev/v2/parse", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.any([deadline, AbortSignal.timeout(65_000)]),
        });
        if (!response.ok) {
          status(`http_${response.status}`);
          await response.body?.cancel();
          if (response.status === 401 || response.status === 403) halt = true;
          if (
            (response.status === 429 || response.status >= 500) &&
            attempt < 2
          )
            continue;
          break;
        }
        const payload = await response.json();
        const data = payload.success === true ? payload.data : undefined;
        if (!data) {
          status("unreadable");
          break;
        }
        const providerPages = data.pages;
        const validPages =
          Array.isArray(providerPages) &&
          providerPages.length === batch.length &&
          providerPages.every(
            (p: any) =>
              Number.isInteger(p?.pageNumber) &&
              p.pageNumber >= 1 &&
              p.pageNumber <= batch.length &&
              typeof p.markdown === "string",
          ) &&
          new Set(providerPages.map((p: any) => p.pageNumber)).size ===
            batch.length;
        // Single-page legacy responses are unambiguous. Multi-page responses
        // MUST supply a complete physical page map, even if markdown exists.
        if (
          !validPages &&
          !(batch.length === 1 && providerPages === undefined)
        ) {
          status("invalid_page_map");
          warnings.push(
            `OCR returned an unexpected page map for file pages ${batch.map((p) => p.index).join(", ")}. Its text was not indexed.`,
          );
          break;
        }
        for (let n = 0; n < batch.length; n++) {
          const page = batch[n],
            record = records[n];
          const markdown = validPages
            ? providerPages.find((p: any) => p.pageNumber === n + 1).markdown
            : data.markdown;
          const text = typeof markdown === "string" ? markdown.trim() : "";
          if (textQualityReasons(text).length) {
            record.status = "unreadable";
            continue;
          }
          if (characters - page.text.length + text.length > limits.characters) {
            record.status = "character_limit";
            warnings.push(
              `OCR text for file page ${page.index} exceeds the extraction character limit and was not indexed.`,
            );
            continue;
          }
          characters += text.length - page.text.length;
          page.text = text;
          page.status = "readable";
          page.blocks = passageSpans(text).map(({ start, end }) => ({
            start,
            end,
          }));
          record.status = "complete";
          warnings.push(
            `File page ${page.index} was recovered with OCR. Review recognition errors; its page label remains unchanged.`,
          );
        }
        break;
      } catch {
        status(deadline.aborted ? "deadline" : "failed");
        if (attempt === 2 || deadline.aborted) break;
      } finally {
        for (const record of records) await options.onUsage?.(record);
      }
    }
    for (const page of batch)
      if (page.status === "unreadable")
        warnings.push(
          `OCR did not recover readable text for file page ${page.index}.`,
        );
  }
  if (deadline.aborted)
    warnings.push(
      "OCR reached its three-minute time limit. Remaining unreadable pages were not processed.",
    );
  if (halt)
    warnings.push(
      "OCR stopped because Firecrawl rejected its credentials or access. Remaining unreadable pages were not processed.",
    );
  parsed.coverage.readablePages = parsed.pages.filter(
    (page) => page.status === "readable",
  ).length;
  parsed.coverage.unreadablePages = parsed.pages
    .filter((page) => page.status === "unreadable")
    .map((page) => page.index);
  return { parsed, usage };
}
