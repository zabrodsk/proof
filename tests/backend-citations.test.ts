import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatReference, toCslItem } from "../server/backend/citations.js";
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
  }
});
