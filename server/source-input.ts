import { dois } from "./parse.js";

// Never infer the identity of an article from DOIs listed in its references.
export function directDoi(input: string): string | undefined {
  const value = input.trim();
  if (/^10\.\d{4,9}\/\S+$/i.test(value)) return dois(value)[0];
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return;
    if (["doi.org", "dx.doi.org"].includes(url.hostname))
      return dois(decodeURIComponent(url.pathname))[0];
  } catch {
    /* ordinary source text */
  }
}
