import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir: string;
};

// These are failure checks, not an estimate of recognition accuracy. Mathematics
// and non-Latin scripts are allowed; unmapped glyphs and missing bodies are not.
export function textQualityReasons(text: string, imageCoverage = 0): string[] {
  const compact = text.replace(/\s/g, "");
  const reasons: string[] = [];
  if (
    text.trim().length < 30 ||
    (compact.match(/[\p{L}\p{N}]/gu) || []).length < 15
  )
    reasons.push("too little readable text");
  const broken = compact.match(/[\uFFFD\u0000-\u001F\u007F]/g)?.length || 0;
  const unmapped = compact.match(/\p{Co}/gu)?.length || 0;
  if (
    (broken >= 3 && broken / compact.length > 0.05) ||
    (unmapped >= 5 && unmapped / compact.length > 0.2)
  )
    reasons.push("unmapped or corrupted text characters");
  if (imageCoverage >= 0.5 && compact.length < 500)
    reasons.push("large page image with only a small native text layer");
  return reasons;
}

// Measure raster image placement without rendering the page or running OCR.
// The common image operators draw a unit square under the current transform.
export function imageCoverage(
  list: { fnArray: number[]; argsArray: any[] },
  pageArea: number,
) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let area = 0;
  const transform = (other: number[]) => {
    const [a, b, c, d, e, f] = matrix;
    const [g, h, i, j, k, l] = other;
    matrix = [
      a * g + c * h,
      b * g + d * h,
      a * i + c * j,
      b * i + d * j,
      a * k + c * l + e,
      b * k + d * l + f,
    ];
  };
  for (let n = 0; n < list.fnArray.length; n++) {
    const op = list.fnArray[n],
      args = list.argsArray[n];
    if (op === OPS.save) stack.push([...matrix]);
    else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) transform(args);
    else if (op === OPS.paintFormXObjectBegin) {
      stack.push([...matrix]);
      if (args[0]) transform(args[0]);
    } else if (op === OPS.paintFormXObjectEnd) matrix = stack.pop() || matrix;
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject)
      area += Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
  }
  return pageArea > 0 ? Math.min(1, area / pageArea) : 0;
}

// Recover simple two-column prose from coordinates even if the content stream
// alternates left and right on each line. Wide headings delimit column bands.
// Keep the stream order for rotated/RTL text; complex tables need inspection.
export function nativeReadingOrder(items: TextItem[], pageWidth: number) {
  if (
    items.some(
      (i) =>
        i.dir !== "ltr" ||
        Math.abs(i.transform[1]) > 0.01 ||
        Math.abs(i.transform[2]) > 0.01,
    )
  )
    return { items, columns: false };
  const sorted = [...items].sort(
    (a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  );
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last[0].transform[5] - item.transform[5]) <= 2)
      last.push(item);
    else lines.push([item]);
  }
  const gaps: { left: number; right: number }[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.transform[4] - b.transform[4]);
    for (let n = 1; n < line.length; n++) {
      const left = line[n - 1].transform[4] + line[n - 1].width;
      const right = line[n].transform[4];
      if (
        right - left >= Math.max(24, pageWidth * 0.04) &&
        left < pageWidth * 0.65 &&
        right > pageWidth * 0.35
      )
        gaps.push({ left, right });
    }
  }
  let gutter: number | undefined;
  let votes = 0;
  for (const gap of gaps) {
    const candidate = (gap.left + gap.right) / 2;
    const count = gaps.filter(
      (g) => g.left < candidate && g.right > candidate,
    ).length;
    if (count > votes) {
      votes = count;
      gutter = candidate;
    }
  }
  if (gutter === undefined || votes < 3)
    return { items: sorted, columns: false };
  const cut = gutter;
  const side = (item: TextItem) =>
    item.transform[4] + item.width <= cut
      ? "left"
      : item.transform[4] >= cut
        ? "right"
        : "wide";
  const left = sorted.filter((i) => side(i) === "left");
  const right = sorted.filter((i) => side(i) === "right");
  // Short labels/numbers in tables must not be mistaken for prose columns.
  if (
    [left, right].some(
      (column) =>
        column
          .map((i) => i.str)
          .join(" ")
          .split(/\s+/)
          .filter(Boolean).length < 25,
    )
  )
    return { items: sorted, columns: false };
  const ordered: TextItem[] = [];
  let band: TextItem[] = [];
  const flush = () => {
    ordered.push(
      ...band.filter((i) => side(i) === "left"),
      ...band.filter((i) => side(i) === "right"),
    );
    band = [];
  };
  for (const line of lines) {
    if (line.some((i) => side(i) === "wide")) {
      flush();
      ordered.push(...line);
    } else band.push(...line);
  }
  flush();
  return { items: ordered, columns: true };
}
