import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveScholarly } from "../server/scholarly.js";
import { resolveDOI } from "../server/sources.js";

test("academic eligibility rejects before full-text retrieval without poisoning the compatibility cache", async () => {
  const doi = "10.1234/source-efficiency";
  let registry = 0,
    articleLookups = 0;
  const stub = mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.crossref.org/works/")) {
      registry++;
      return Response.json({
        message: {
          DOI: doi,
          type: "journal-article",
          title: ["Controlled source efficiency study"],
        },
      });
    }
    if (url.includes("europepmc/webservices/rest/search")) {
      articleLookups++;
      return Response.json({
        resultList: {
          result: [
            {
              doi,
              abstractText:
                "An available abstract describing the population, outcomes and limitations of the controlled study.",
            },
          ],
        },
      });
    }
    throw Error("An unexpected lookup escaped the eligibility gate.");
  });
  try {
    const strict = await resolveScholarly(doi, true);
    assert.equal(strict.scholarly?.eligible, false);
    assert.equal(strict.access, "unavailable");
    assert.equal(registry, 1);
    assert.equal(articleLookups, 0);
    const compatibility = await resolveDOI(doi);
    assert.equal(compatibility.access, "abstract");
    assert.equal(registry, 2);
    assert.equal(articleLookups, 1);
  } finally {
    stub.mock.restore();
  }
});

test("a temporary academic registry failure remains retryable and is never cached as an exclusion", async () => {
  const doi = "10.1234/temporary-registry";
  let journalCalls = 0;
  const stub = mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.crossref.org/works/"))
      return Response.json({
        message: {
          DOI: doi,
          type: "journal-article",
          ISSN: ["1932-6203"],
          title: ["Controlled temporary registry study"],
        },
      });
    if (url.startsWith("https://doaj.org/api/"))
      return ++journalCalls === 1
        ? new Response("Temporary outage", { status: 503 })
        : Response.json({ results: [] });
    throw Error("No article download should occur before eligibility.");
  });
  try {
    const unavailable = await resolveScholarly(doi);
    assert.equal(unavailable.access, "unavailable");
    assert.equal(unavailable.scholarly?.retryable, true);
    const retried = await resolveScholarly(doi);
    assert.equal(journalCalls, 2);
    assert.equal(retried.scholarly?.eligible, false);
    assert.equal(retried.scholarly?.retryable, false);
  } finally {
    stub.mock.restore();
  }
});
