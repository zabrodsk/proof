import { test } from "node:test";
import { once } from "node:events";
import { directDoi } from "../server/source-input.js";
import assert from "node:assert/strict";
import {
  checkEvidence,
  evidenceSentences,
  loadEvidenceSource,
  pageText,
} from "../server/evidence.js";
import { articleMetaDoi } from "../server/article-input.js";
import type { Source, Claim, Finding } from "../shared/types.js";
const source: Source = {
  id: "fixture",
  title: "Supplied paper",
  authors: [],
  year: "",
  passages: [
    "The randomized trial included 120 adults. It did not measure reading scores.",
  ],
  access: "uploaded",
  provider: "fixture",
  retrievedAt: "",
};
const judge = async (claim: Claim, s: Source): Promise<Finding> => ({
  ...claim,
  sourceId: s.id,
  status: "uncertain",
  method: "Jev",
  explanation: "Fixture result",
  checkedPassages: s.passages,
});
const deps = {
  load: async () => source,
  judge,
  discover: async (claim: string) => ({
    claim,
    query: claim,
    candidates: [
      {
        source,
        finding: await judge(
          {
            id: "test",
            text: claim,
            start: 0,
            end: claim.length,
            citations: [],
          },
          source,
        ),
      },
    ],
    notices: [],
  }),
};
test("supplied-source mode checks uncited sentences using only the supplied source list", async () => {
  let searches = 0;
  let judgments = 0;
  const r = await checkEvidence(
    "The trial included 120 adults. Reading scores improved.",
    "supplied",
    [{ label: "source", text: source.passages[0] }],
    () => {},
    {
      ...deps,
      discover: async (c) => {
        searches++;
        return deps.discover(c);
      },
      judge: async (c, s) => {
        judgments++;
        assert.equal(s.id, "fixture");
        return judge(c, s);
      },
    },
  );
  assert.equal(searches, 0);
  assert.equal(judgments, 2);
  assert.equal(r.total, 2);
  assert.equal(r.rows[1].text, "Reading scores improved.");
});
test("public mode independently searches every sentence and ignores supplied sources", async () => {
  const claims: string[] = [];
  const r = await checkEvidence(
    "The trial included 120 adults. It measured sleep.",
    "public",
    [{ label: "must not load", text: "source" }],
    () => {},
    {
      ...deps,
      load: async () => {
        throw Error("must not load");
      },
      discover: async (c) => {
        claims.push(c);
        return deps.discover(c);
      },
    },
  );
  assert.equal(claims.length, 2);
  assert.equal(r.rows.length, 2);
  assert.equal(r.sources.length, 1);
});
test("provider failure preserves failed sentence and continues to final sentence", async () => {
  let count = 0;
  const r = await checkEvidence(
    "Sleep improves attention. Sleep affects reading scores.",
    "public",
    [],
    () => {},
    {
      ...deps,
      discover: async (c) => {
        if (++count === 1) throw Error("503");
        return deps.discover(c);
      },
    },
  );
  assert.equal(r.completed, 1);
  assert.equal(r.total, 2);
  assert.equal(r.rows[0].completed, false);
  assert.equal(r.rows[1].completed, true);
});
test("empty search and unavailable source remain incomplete", async () => {
  const r = await checkEvidence(
    "The treatment reduced symptoms.",
    "public",
    [],
    () => {},
    {
      ...deps,
      discover: async (c) => ({
        claim: c,
        query: c,
        candidates: [],
        notices: [],
      }),
    },
  );
  assert.equal(r.completed, 0);
  const missing = await checkEvidence(
    "The treatment reduced symptoms.",
    "supplied",
    [{ label: "broken", url: "https://example.com" }],
    () => {},
    {
      ...deps,
      judge: async (c) => ({
        ...c,
        status: "source_unavailable",
        method: "unverified",
        explanation: "Unavailable",
      }),
    },
  );
  assert.equal(missing.completed, 0);
  assert.equal(
    missing.rows[0].candidates[0].finding.status,
    "source_unavailable",
  );
});
test("five concurrent long checks preserve 100 sentences each through the last one", async () => {
  const text = Array.from(
    { length: 100 },
    (_, i) => `Sentence ${i + 1} reports a measured outcome from the research.`,
  ).join("\n");
  const reports = await Promise.all(
    Array.from({ length: 5 }, () =>
      checkEvidence(
        text,
        "supplied",
        [{ label: "fixture", text: source.passages[0] }],
        () => {},
        deps,
      ),
    ),
  );
  for (const r of reports) {
    assert.equal(r.total, 100);
    assert.equal(r.completed, 100);
    assert.equal(r.rows.at(-1)?.end, text.length);
  }
  assert.throws(
    () => evidenceSentences(text + "\nThe trial included 120 adults."),
    /100 sentences/,
  );
});
test("source text is not converted to a DOI lookup merely because it cites other papers", async () => {
  const r = await loadEvidenceSource({
    label: "My source",
    text: "This is supplied article text that refers to other papers at https://doi.org/10.1234/other and https://doi.org/10.1234/second.",
  });
  assert.equal(r.access, "unavailable");
  assert.equal(r.doi, undefined);
  assert.equal(r.passages.length, 0);
});
test("DOI recognition and article metadata reject ambiguous and incidental identifiers", () => {
  assert.equal(directDoi("https://doi.org/10.1234/hello"), "10.1234/hello");
  assert.equal(
    directDoi("https://example.com/?reference=10.1234/other"),
    undefined,
  );
  assert.equal(
    articleMetaDoi(
      '<meta content="10.1234/real" name="citation_doi"><p>References 10.1234/other</p>',
    ),
    "10.1234/real",
  );
  assert.equal(
    articleMetaDoi(
      '<meta name="citation_doi" content="10.1234/a"><meta name="citation_doi" content="10.1234/b">',
    ),
    undefined,
  );
});
test("web extraction removes scripts and navigation and keeps article paragraphs", () => {
  const text = pageText(
    "<html><head><title>Title</title></head><body><nav>Unrelated claim</nav><main><script>fake instructions</script><p>Actual source sentence with a measured result.</p><p>Another source paragraph.</p></main><footer>Boilerplate</footer></body></html>",
  );
  assert.ok(text.includes("Actual source"));
  assert.ok(!/instructions|Boilerplate|Unrelated/.test(text));
});

test("evidence jobs enforce five-user capacity, ownership and one running job per session", async () => {
  const { default: express } = await import("express");
  const { evidenceRouter } = await import("../server/evidence.js");
  const waiting: (() => void)[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.proofSession = req.headers["x-fixture-owner"];
    next();
  });
  app.use(
    "/api/class",
    evidenceRouter(async (text, mode) => {
      await new Promise<void>((resolve) => waiting.push(resolve));
      return { text, mode, rows: [], sources: [], total: 0, completed: 0 };
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/class/evidence-checks`;
  const start = (owner: string) =>
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-fixture-owner": owner },
      body: JSON.stringify({
        text: "The trial included 120 adults.",
        mode: "public",
      }),
    });
  try {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await start(String(i));
      assert.equal(r.status, 202);
      ids.push((await r.json()).id);
    }
    assert.equal((await start("5")).status, 429);
    assert.equal((await start("0")).status, 429);
    assert.equal(
      (
        await fetch(base + "/" + ids[0], {
          headers: { "x-fixture-owner": "1" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + "/" + ids[0], {
          headers: { "x-fixture-owner": "0" },
        })
      ).status,
      200,
    );
    waiting.forEach((resolve) => resolve());
    for (let i = 0; i < 5; i++) {
      const result = await (
        await fetch(base + "/" + ids[i], {
          headers: { "x-fixture-owner": String(i) },
        })
      ).json();
      assert.equal(result.status, "complete");
      assert.equal("owner" in result, false);
    }
  } finally {
    waiting.forEach((resolve) => resolve());
    server.close();
  }
});
