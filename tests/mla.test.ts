import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMlaEntry,
  applyCitationEdit,
  blankMlaSource,
  formatMla,
  mlaFromSource,
  reviewMla,
  type MlaSource,
} from "../shared/mla.js";
import { extractClaims } from "../server/parse.js";
import { demoText } from "../shared/demo.js";
import type { Source } from "../shared/types.js";

const source: MlaSource = {
  ...blankMlaSource,
  authors: "Noetel, Michael\nSanders, Taren\nGallardo-Gómez, Daniel",
  title:
    "Effect of Exercise for Depression: Systematic Review and Network Meta-analysis of Randomised Controlled Trials",
  journal: "BMJ",
  volume: "384",
  year: "2024",
  doi: "10.1136/bmj-2023-075847",
};
const article: Source = {
  id: "one",
  title: source.title,
  authors: ["Michael Noetel", "Taren Sanders", "Daniel Gallardo-Gómez"],
  authorDetails: [
    { given: "Michael", family: "Noetel" },
    { given: "Taren", family: "Sanders" },
    { given: "Daniel", family: "Gallardo-Gómez" },
  ],
  journal: "BMJ",
  volume: "384",
  year: "2024",
  doi: source.doi,
  access: "metadata",
  passages: [],
  provider: "fixture",
  retrievedAt: "",
};

test("MLA journal entry uses first author et al, quoted title, italic journal, and DOI", () => {
  assert.equal(
    formatMla(source).entry,
    'Noetel, Michael, et al. "Effect of Exercise for Depression: Systematic Review and Network Meta-analysis of Randomised Controlled Trials." *BMJ*, vol. 384, 2024, https://doi.org/10.1136/bmj-2023-075847.',
  );
  assert.equal(formatMla(source).inText, "(Noetel et al.)");
  assert.equal(formatMla(source, "pp. 42-45").inText, "(Noetel et al. 42-45)");
});
test("two authors invert only the first name and include both in text", () => {
  const two = {
    ...source,
    authors: "Dorris, Michael\nErdrich, Louise",
    pages: "12-18",
    issue: "2",
  };
  assert.ok(
    formatMla(two).entry.startsWith("Dorris, Michael, and Louise Erdrich."),
  );
  assert.ok(formatMla(two).entry.includes("vol. 384, no. 2, 2024, pp. 12-18"));
  assert.equal(formatMla(two, "14").inText, "(Dorris and Erdrich 14)");
});
test("single, organization and absent authors do not invent surnames", () => {
  assert.ok(
    formatMla({
      ...source,
      authors: "World Health Organization",
    }).entry.startsWith("World Health Organization."),
  );
  assert.ok(
    formatMla({ ...source, authors: "Noetel, M." }).entry.startsWith(
      'Noetel, M. "',
    ),
  );
  assert.ok(formatMla({ ...source, authors: "" }).entry.startsWith('"Effect'));
  assert.ok(
    formatMla({ ...source, authors: "" }).inText.startsWith('("Effect'),
  );
});
test("electronic article identifiers are not treated as page numbers", () => {
  assert.equal(
    formatMla({ ...source, pages: "e075847" }).entry,
    formatMla(source).entry,
  );
});
test("structured metadata preserves compound family names and English title case", () => {
  const result = mlaFromSource({
    ...article,
    title: "effects of exercise: a review of MRI studies",
    authorDetails: [{ given: "Maria", family: "de la Cruz" }],
  });
  assert.equal(result.authors, "de la Cruz, Maria");
  assert.equal(result.title, "Effects of Exercise: A Review of MRI Studies");
});
test("adding an entry creates Works Cited and preserves document body", () => {
  const body = "My title\n\nA paragraph that needs its source.";
  const result = addMlaEntry(body, source);
  assert.ok(result.startsWith(body + "\n\nWorks Cited\n"));
  assert.equal(addMlaEntry(result, source), result);
});
test("existing DOI entries are updated rather than duplicated", () => {
  const result = addMlaEntry(demoText, source);
  assert.equal((result.match(/https:\/\/doi.org/g) || []).length, 1);
  assert.equal(
    result.split("Works cited")[0],
    demoText.split("Works cited")[0],
  );
  assert.ok(result.includes("*BMJ*"));
});
test("new references are inserted alphabetically without changing existing lines", () => {
  const doc =
    'A factual sentence.\n\nWorks Cited\nAdams, A. "One." Journal.\n\nZane, Z. "Two." Journal.\n';
  const next = addMlaEntry(doc, source);
  assert.ok(next.indexOf("Adams") < next.indexOf("Noetel"));
  assert.ok(next.indexOf("Noetel") < next.indexOf("Zane"));
  assert.ok(next.includes('Zane, Z. "Two." Journal.\n'));
});
test("review finds all five sample in-text years and bibliography fixes", () => {
  const issues = reviewMla(demoText, [source]);
  assert.equal(
    issues.filter((i) => i.title === "Use an MLA in-text citation").length,
    5,
  );
  assert.equal(
    issues.filter((i) => i.title === "Review Works Cited formatting").length,
    1,
  );
  assert.equal(
    issues.filter((i) => i.title === "Use the MLA heading").length,
    1,
  );
  const fix = issues.find(
    (i) => i.title === "Use an MLA in-text citation",
  )!.edit!;
  const result = applyCitationEdit(demoText, fix);
  assert.equal((result.match(/\(Noetel et al\. 2024\)/g) || []).length, 4);
  assert.ok(
    result.includes("300 studies and 14,170 participants (Noetel et al.)."),
  );
});
test("review preserves a supplied locator when converting author-year style", () => {
  const doc =
    "Exercise was associated with reduced symptoms (Noetel et al., 2024, p. 42).\n\nWorks Cited\n" +
    formatMla(source).entry;
  const issue = reviewMla(doc, [source]).find(
    (i) => i.title === "Use an MLA in-text citation",
  );
  assert.equal(issue?.edit?.replacement, "(Noetel et al. 42)");
});
test("unknown and ambiguous source references do not get invented corrections", () => {
  const issues = reviewMla(
    'The review was published recently (Noetel et al. 2024).\nWorks Cited\n"Unresolved paper."',
    [source, { ...source, doi: "10.1000/other", title: "Another Review" }],
  );
  assert.ok(
    issues.some(
      (i) => i.title === "Distinguish works by the same author" && !i.edit,
    ),
  );
  assert.ok(issues.some((i) => i.title === "Check source details" && !i.edit));
});
test("stale edits cannot replace unrelated text", () => {
  const edit = reviewMla(demoText, [source]).find((i) => i.edit)!.edit!;
  assert.throws(
    () => applyCitationEdit("Changed\n" + demoText, edit),
    /text changed/,
  );
});
test("duplicate bibliography entries have explicit removable spans", () => {
  const entry = formatMla(source).entry;
  const doc = `Works Cited\n${entry}\n\n${entry}`;
  const fix = reviewMla(doc, [source]).find(
    (i) => i.title === "Duplicate entry",
  )!.edit!;
  assert.equal(
    (applyCitationEdit(doc, fix).match(/https:\/\/doi.org/g) || []).length,
    1,
  );
});
test("pasted entry review does not treat publication year as an in-text citation", () => {
  const entry = formatMla(source).entry;
  assert.deepEqual(reviewMla(entry, [source], true), []);
});
test("generated author-only MLA references remain recognized by the evidence audit", () => {
  const doc =
    "Walking reduced depressive symptoms compared with active controls (Noetel et al.).";
  const claims = extractClaims(doc, false, [article]);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].citations, ["Noetel et al."]);
  assert.equal(
    extractClaims("The outcomes varied considerably (Context).", false, [
      article,
    ]).length,
    0,
  );
});
test("same-author works can include a title to make generated citations unambiguous", () => {
  assert.equal(
    formatMla({ ...source, title: "Another Review" }, "42", true).inText,
    '(Noetel et al., "Another Review" 42)',
  );
});
test("each repeated in-text issue includes the paragraph it belongs to", () => {
  const issues = reviewMla(demoText, [source]).filter(
    (i) => i.title === "Use an MLA in-text citation",
  );
  assert.ok(issues[0].context?.startsWith("A 2024 systematic review"));
  assert.ok(issues[1].context?.startsWith("Walking or jogging"));
});
test("an unmatched author-page reference stays flagged for manual matching", () => {
  const issues = reviewMla(
    "This claim has an unknown author (Unknown 42).\n\nWorks Cited\n" +
      formatMla(source).entry,
    [source],
  );
  assert.ok(
    issues.some((i) => i.title === "Check the in-text source" && !i.edit),
  );
});
