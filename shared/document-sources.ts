import { bibliography } from "./mla.js";

export function sourceLinks(text: string): string[] {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"\])]+/gi) || []).map((url) =>
        url.replace(/[.,;:]+$/, ""),
      ),
    ),
  ];
}

/** Extract supplied references, never infer a work from an author-only citation. */
export function documentReferences(text: string): string {
  const section = bibliography(text);
  const references = section.heading
    ? text
        .slice(section.heading.end)
        .split(/\n\s*(?:#{1,6}\s+|Appendix\b|Appendices\b)/i)[0]
        .trim()
    : "";
  const extras: string[] = [];
  const body = section.heading ? text.slice(0, section.heading.start) : text;
  for (const line of body.split("\n")) {
    // Numbered notes must contain bibliographic detail, not just numbered prose.
    if (
      /^\s*(?:\[\d+\]|\d+[.)])\s+/.test(line) &&
      /[“"][^”"]+[”"]/.test(line) &&
      /\b(?:1[5-9]|20)\d{2}\b/.test(line)
    )
      extras.push(line.trim());
  }
  for (const url of sourceLinks(text)) {
    if (!(references + extras.join("\n")).includes(url)) extras.push(url);
  }
  for (const match of text.matchAll(/10\.\d{4,9}\/[\w.();/:+-]+/gi)) {
    const doi = match[0].replace(/[.,;:)]+$/, "").toLowerCase();
    if (!(references + extras.join("\n")).toLowerCase().includes(doi))
      extras.push(`https://doi.org/${doi}`);
  }
  // Blank lines keep standalone identifiers separate from wrapped bibliography entries.
  return [references, ...extras].filter(Boolean).join("\n\n");
}
