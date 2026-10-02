import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatReference,
  formatCitation,
  formatBibliography,
  toCslItem,
  citationWorkIdentity,
} from "../server/backend/citations.js";
import assets from "../shared/citation-style-assets.json";
import { parseReference } from "../server/backend/references.js";
import manifest from "../server/backend/styles/manifest.json";

const article = {
  type: "article-journal",
  title: "Evidence and Its Limits",
  authors: ["Smith, Jane"],
  year: 2024,
  containerTitle: "Journal of Examples",
  volume: 12,
  issue: 3,
  pages: "101-115",
  doi: "10.1234/example",
};

test("MLA formats books with editions and publisher rather than journal structure", () => {
  const original =
    "Smith, Jane. The Example Book. 2nd ed., Example Press, 2020.";
  const parsed = parseReference(original);
  const result = formatReference(parsed, {
    original,
    overrides: { metadata: { publisher: "Example Press" } },
  });
  assert.equal(result.original, original);
  assert.equal(
    result.text,
    "Smith, Jane. The Example Book. 2nd ed., Example Press, 2020.",
  );
  assert.match(result.html, /<i>The Example Book<\/i>/);
  assert.equal(result.csl.type, "book");
  assert.equal(result.csl.edition, "2");
  assert.deepEqual(result.missingMetadata, []);
  assert.equal(parsed.edition, "2nd ed.");
});

test("MLA article punctuation and journal italics come from the pinned CSL style", () => {
  const result = formatReference(article);
  assert.equal(
    result.text,
    "Smith, Jane. “Evidence and Its Limits.” Journal of Examples, vol. 12, no. 3, 2024, pp. 101–15, https://doi.org/10.1234/example.",
  );
  assert.match(result.html, /<i>Journal of Examples<\/i>/);
  assert.deepEqual(result.missingMetadata, []);
  assert.equal(
    result.style.commit,
    manifest["modern-language-association.csl"].commit,
  );
});

test("missing fields remain missing and provisional citations are flagged", () => {
  const result = formatReference({
    type: "book",
    title: "Unidentified Book",
    edition: "Revised edition",
  });
  assert.deepEqual(result.missingMetadata, ["authors", "year", "publisher"]);
  assert.equal(result.csl.edition, "Revised edition");
  assert.equal(result.csl.author, undefined);
  assert.equal(result.csl.issued, undefined);
  assert.equal(result.csl.publisher, undefined);
  assert.match(result.warnings.join(" "), /provisional/);
  assert.doesNotMatch(result.text, /Unknown Author|Unknown Publisher|2026/);
  assert.deepEqual(
    toCslItem({
      type: "article-journal",
      title: "Study",
      authors: ["Smith, Jane"],
      year: 2024,
    }).missingMetadata,
    ["containerTitle"],
  );
});

test("class-specific punctuation and DOI rules are explicit and do not mutate source metadata", () => {
  const before = structuredClone(article);
  const overridden = formatReference(article, {
    overrides: { punctuationInQuote: false, includeDoi: false },
  });
  assert.match(overridden.text, /“Evidence and Its Limits”\./);
  assert.doesNotMatch(overridden.text, /doi\.org/);
  assert.equal(overridden.csl.DOI, article.doi);
  assert.deepEqual(overridden.overrides, {
    punctuationInQuote: false,
    includeDoi: false,
  });
  assert.deepEqual(article, before);
  assert.match(formatReference(article).text, /Limits\.”/);
  assert.match(formatReference(article).text, /doi\.org/);
});

test("structured translator names, ISBN, and edition distinguish book versions", () => {
  const { item } = toCslItem({
    type: "book",
    title: "Book",
    authors: [{ family: "García Márquez", given: "Gabriel" }],
    translators: [{ family: "Grossman", given: "Edith" }],
    year: 2003,
    edition: 3,
    isbn: "9781400034680",
    publisher: "Vintage",
  });
  assert.deepEqual(item.author, [
    { family: "García Márquez", given: "Gabriel" },
  ]);
  assert.deepEqual(item.translator, [{ family: "Grossman", given: "Edith" }]);
  assert.equal(item.ISBN, "9781400034680");
  assert.equal(item.edition, "3");
});

test("unstructured names and unknown source types are retained and flagged", () => {
  const result = toCslItem({
    title: "A source",
    authors: ["World Health Organization"],
    year: "in press",
  });
  assert.equal(result.item.type, "document");
  assert.deepEqual(result.item.author, [
    { literal: "World Health Organization" },
  ]);
  assert.equal(result.item.issued, undefined);
  assert.match(result.warnings.join(" "), /unknown/);
  assert.match(result.warnings.join(" "), /literally/);
});

test("vendored citation assets match their pinned SHA-256 hashes", () => {
  for (const [filename, metadata] of Object.entries(manifest)) {
    const content = readFileSync(
      new URL(`../server/backend/styles/${filename}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      metadata.sha256,
    );
    assert.match(metadata.commit, /^[a-f0-9]{40}$/);
    assert.equal(metadata.license, "CC-BY-SA-3.0");
    assert.equal(
      assets[filename as keyof typeof assets],
      content.toString("utf8"),
    );
  }
});

test("in-text and bibliography output share MLA source identity and verified locators", () => {
  const result = formatCitation(article, {
    id: "article",
    locator: { kind: "page", value: "104-105", verified: true },
  });
  assert.equal(result.inText, "(Smith 104–05)");
  assert.equal(result.text, formatReference(article).text);
  assert.equal(result.profile.id, "mla9");
  assert.equal(result.csl.id, "article");
  assert.equal(
    formatCitation(article, {
      narrative: true,
      locator: { kind: "page", value: "104", verified: true },
    }).inText,
    "(104)",
  );
  assert.equal(formatCitation(article, { narrative: true }).inText, "");
});

test("CSL disambiguates multiple works by the same author instead of picking one", () => {
  const second = { ...article, title: "Another Study", doi: "10.1234/another" };
  const result = formatCitation(article, {
    id: "one",
    references: [{ id: "two", metadata: second }],
    locator: { kind: "page", value: "104", verified: true },
  });
  assert.equal(result.inText, "(Smith, “Evidence and Its Limits” 104)");
  assert.equal(
    formatCitation(article, { distinguishTitle: true }).inText,
    "(Smith, “Evidence and Its Limits”)",
  );
  const bibliography = formatBibliography([
    { id: "one", metadata: article },
    { id: "two", metadata: second },
  ]);
  assert.deepEqual(
    bibliography.entries.map((entry) => entry.id),
    ["two", "one"],
  );
  assert.match(bibliography.entries[1].text, /Evidence and Its Limits/);
});

test("classroom CSL applies verified examples without changing source metadata", () => {
  const metadata = {
    ...article,
    authors: [
      { family: "Smith", given: "Jane" },
      { family: "Jones", given: "Robert" },
    ],
    accessed: "2026-09-29",
  };
  const original = structuredClone(metadata);
  const result = formatCitation(metadata, {
    profile: "classroom",
    locator: { kind: "page", value: "104", verified: true },
  });
  assert.equal(
    result.text,
    "Smith, Jane and Jones, Robert. “Evidence and Its Limits”. Journal of Examples, Vol. 12, no. 3, 2024, pp. 101–115, https://doi.org/10.1234/example. Accessed 29 Sept. 2026.",
  );
  assert.match(result.html, /<i>Journal of Examples<\/i>/);
  const many = formatReference(
    {
      ...metadata,
      authors: [...metadata.authors, { family: "Adams", given: "Abby" }],
    },
    { profile: "classroom" },
  );
  assert.match(many.text, /^Smith et al\./);
  assert.deepEqual(metadata, original);
});

test("unverified locators and impossible dates are omitted with actionable warnings", () => {
  const result = formatCitation(
    { ...article, accessed: "2026-02-30" },
    {
      profile: "classroom",
      locator: { kind: "page", value: "104", verified: false } as never,
    },
  );
  assert.equal(result.inText, "(Smith)");
  assert.equal(result.csl.accessed, undefined);
  assert.equal(result.locator, undefined);
  assert.doesNotMatch(result.text, /Accessed/);
  assert.match(result.warnings.join(" "), /invalid|unverified/);
  assert.match(result.warnings.join(" "), /recorded access date/);
  assert.match(result.warnings.join(" "), /printed page/);
});

test("title-based, literal organizational and Unicode author citations do not guess identities", () => {
  const anonymous = formatCitation({ ...article, authors: [] });
  assert.equal(anonymous.inText, "(“Evidence and Its Limits”)");
  const organization = formatCitation({
    ...article,
    authors: [{ literal: "World Health Organization" }],
  });
  assert.equal(organization.inText, "(World Health Organization)");
  const unicode = formatCitation({
    ...article,
    authors: [{ family: "García Márquez", given: "Gabriel" }],
  });
  assert.equal(unicode.inText, "(García Márquez)");
});

test("verified work identity ignores duplicate upload IDs and supports works without DOI", () => {
  assert.equal(
    citationWorkIdentity(article),
    citationWorkIdentity({
      ...article,
      doi: `https://doi.org/${article.doi.toUpperCase()}`,
    }),
  );
  const withoutDoi = { ...article, doi: undefined };
  assert.equal(
    citationWorkIdentity(withoutDoi),
    citationWorkIdentity({
      ...withoutDoi,
      authors: [{ family: "Smith", given: "Jane" }],
    }),
  );
  assert.notEqual(
    citationWorkIdentity(withoutDoi),
    citationWorkIdentity({ ...withoutDoi, title: "Another Work" }),
  );
  assert.equal(citationWorkIdentity({ authors: ["Smith, Jane"] }), undefined);
});

test("separate bibliography lines with non-inverted authors are not merged", async () => {
  const { reconstructReferences } =
    await import("../server/backend/references.js");
  const entries = reconstructReferences(
    'Huxley, Aldous. Brave New World. 1932.\nTest Author. "Synthetic source." 2026.',
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].parsed.title, "Brave New World");
  assert.equal(entries[1].parsed.title, "Synthetic source.");
});
