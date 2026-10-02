import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  neutralResearchQuery,
  researchQueries,
  deduplicateCandidates,
  research,
  resolveSelectedReferences,
  type ResearchCandidate,
} from "../server/backend/research.js";
import { providerContext } from "../server/backend/providers.js";
import type { Database } from "../server/backend/db.js";
import type { BlobStore } from "../server/backend/storage.js";

const blobs: BlobStore = {
  async get() {
    throw new Error("No asset was expected.");
  },
  async put() {
    throw new Error("No asset was expected.");
  },
  async delete() {},
};
function fixture(mode: string = "fact_check", snapshot?: any) {
  const saved = new Map<string, any>();
  let cancelled = false,
    calls = 0;
  const db: Database = {
    async query(sql, values = []) {
      if (sql.startsWith("SELECT * FROM proof_connector_submissions"))
        return { rows: [] };
      if (sql.startsWith("SELECT input,cancel_requested,invalidated"))
        return {
          rows:
            values[0] === "workspace" && values[1] === "run"
              ? [
                  {
                    input: {
                      mode,
                      externalAccess:
                        mode === "source_check"
                          ? "resolve_selected_references"
                          : "research",
                      allowProviderProcessing: true,
                      sourcePolicy: "academic",
                    },
                    cancel_requested: cancelled,
                  },
                ]
              : [],
        };
      if (sql.startsWith("SELECT cancel_requested,input"))
        return {
          rows: [
            {
              cancel_requested: cancelled,
              input: { mode, allowProviderProcessing: true },
            },
          ],
        };
      if (sql.startsWith("SELECT count(*)::int AS n FROM provider_calls"))
        return { rows: [{ n: calls }] };
      if (sql.startsWith("INSERT INTO provider_calls")) {
        calls++;
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE provider_calls")) return { rows: [] };
      if (sql.startsWith("SELECT data FROM research_results"))
        return {
          rows: saved.has(values[2])
            ? [{ data: structuredClone(saved.get(values[2])) }]
            : [],
        };
      if (sql.startsWith("INSERT INTO research_results")) {
        saved.set(values[3], JSON.parse(values[4]));
        return { rows: [] };
      }
      if (sql.startsWith("SELECT a.id,a.metadata,a.eligibility,a.access"))
        return { rows: snapshot ? [structuredClone(snapshot)] : [] };
      if (sql.startsWith("SELECT e.coverage FROM extractions"))
        return { rows: [{ coverage: { totalPages: 1 } }] };
      if (sql.startsWith("SELECT id FROM source_assets"))
        return { rows: snapshot ? [{ id: snapshot.id }] : [] };
      if (sql.startsWith("UPDATE source_assets SET metadata")) {
        snapshot.metadata = JSON.parse(values[2]);
        snapshot.eligibility = values[3];
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async transaction(fn) {
      return fn(db);
    },
    async close() {},
  };
  return {
    db,
    saved,
    cancel() {
      cancelled = true;
    },
    get calls() {
      return calls;
    },
    run: <T>(fn: () => Promise<T>) =>
      providerContext.run(
        {
          db,
          ws: "workspace",
          run: "run",
          signal: new AbortController().signal,
          maxCalls: 40,
          model: "fixture",
        },
        fn,
      ),
  };
}

test("neutral research keeps negations and scope and adds a conflict search", () => {
  assert.equal(
    neutralResearchQuery(
      "Prove that tutoring does NOT improve adult scores in 2024.",
    ),
    "tutoring does not improve adult scores in 2024.",
  );
  const searches = researchQueries(
    "Tutoring improves adult scores",
    "fact_check",
  );
  assert.equal(searches.length, 2);
  assert.match(searches[1].query, /conflicting evidence/);
  assert.equal(
    researchQueries("Tutoring improves adult scores", "discover").length,
    1,
  );
});

test("candidate deduplication merges DOI and URL copies without discarding conflicting works", () => {
  const candidate = (
    url: string,
    intent: string,
    doi?: string,
  ): ResearchCandidate => ({
    title: url,
    url,
    doi,
    status: "promising",
    eligibility: "unknown",
    searchIntents: [intent],
  });
  const results = deduplicateCandidates([
    candidate("https://doi.org/10.1234/ONE", "relevance"),
    candidate(
      "https://publisher.test/paper",
      "qualifications_and_conflicts",
      "10.1234/one",
    ),
    candidate(
      "https://publisher.test/conflicting?utm_source=search",
      "qualifications_and_conflicts",
    ),
    candidate("https://publisher.test/conflicting#section", "relevance"),
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].searchIntents, [
    "relevance",
    "qualifications_and_conflicts",
  ]);
  assert.equal(results[1].status, "promising");
});

test("research persists both search intentions and reuses a finished stage after restart", async () => {
  const f = fixture();
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture-not-real";
  const searches: string[] = [];
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (input: any, init?: RequestInit) => {
      if (String(input).includes("api.exa.ai")) {
        const body = JSON.parse(String(init?.body));
        searches.push(body.query);
        const conflict = body.query.includes("conflicting evidence");
        return Response.json({
          results: [
            {
              title: conflict ? "Contradictory result" : "Supportive result",
              url: `https://publisher.test/${conflict ? "against" : "for"}`,
            },
            { title: "Duplicate", url: "https://publisher.test/duplicate" },
          ],
        });
      }
      assert.match(String(input), /api.crossref.org\/works\?query.title=/);
      return Response.json({ message: { items: [] } });
    },
  );
  try {
    const result = await f.run(() =>
      research(
        f.db,
        blobs,
        "workspace",
        "run",
        "Tutoring improves scores",
        "fact_check",
        2,
      ),
    );
    assert.equal(searches.length, 2);
    assert.deepEqual(
      result.candidates.map((c) => c.title),
      ["Supportive result", "Contradictory result"],
    );
    assert.equal(result.selections.length, 0);
    assert.ok(result.candidates.every((c) => c.status === "promising"));
    const count = f.calls;
    assert.deepEqual(
      await f.run(() =>
        research(
          f.db,
          blobs,
          "workspace",
          "run",
          "  TUTORING improves scores ",
          "fact_check",
          2,
        ),
      ),
      result,
    );
    assert.equal(f.calls, count);
    assert.equal(
      [...f.saved.values()].filter(
        (state: any) => state.kind !== "candidate_resolution",
      ).length,
      1,
    );
  } finally {
    fetch.mock.restore();
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});

test("independent research rejects source-check runs and wrong workspaces before providers", async () => {
  const f = fixture("source_check");
  await assert.rejects(
    f.run(() =>
      research(f.db, blobs, "workspace", "run", "claim", "discover", 4),
    ),
    /does not permit independent/,
  );
  await assert.rejects(
    f.run(() => research(f.db, blobs, "other", "run", "claim", "discover", 4)),
    /Record not found/,
  );
  assert.equal(f.calls, 0);
});

test("ambiguous supplied references stay unresolved without searching unrelated works", async () => {
  const f = fixture("source_check");
  const result = await f.run(() =>
    resolveSelectedReferences(f.db, blobs, "workspace", "run", [
      {
        id: "reference",
        status: "ambiguous",
        parsed: { title: "Title" },
        candidates: [{ doi: "10.1234/one" }, { doi: "10.1234/two" }],
      },
    ]),
  );
  assert.equal(result.selections.length, 0);
  assert.equal(result.candidates.length, 0);
  assert.match(result.notices[0], /unambiguous DOI/);
  assert.equal(f.calls, 0);
});

test("cancellation after a provider response prevents research-result persistence", async () => {
  const f = fixture();
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture-not-real";
  const fetch = mock.method(globalThis, "fetch", async () => {
    f.cancel();
    return Response.json({ results: [] });
  });
  try {
    await assert.rejects(
      f.run(() =>
        research(f.db, blobs, "workspace", "run", "claim", "fact_check", 4),
      ),
      /cancelled/,
    );
    assert.equal(f.saved.size, 0);
  } finally {
    fetch.mock.restore();
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});

test("cached text gets a new publication-status check without re-extraction", async () => {
  for (const retracted of [false, true]) {
    const snapshot = {
      id: "asset",
      extraction_id: "extraction",
      access: "full_text",
      eligibility: "eligible",
      metadata: {
        title: "Cached study",
        doi: "10.1234/cached",
        lastPublicationCheckRunId: "old-run",
      },
    };
    const f = fixture("discover", snapshot);
    const previous = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = "fixture-not-real";
    let registryCalls = 0;
    const fetch = mock.method(globalThis, "fetch", async (input: any) => {
      if (String(input).includes("api.exa.ai"))
        return Response.json({
          results: [
            { title: "Cached study", url: "https://doi.org/10.1234/cached" },
          ],
        });
      assert.match(String(input), /api.crossref.org\/works\/10.1234%2Fcached/);
      registryCalls++;
      return Response.json({
        message: {
          DOI: "10.1234/cached",
          title: ["Cached study"],
          ...(retracted ? { "update-to": [{ type: "retraction" }] } : {}),
        },
      });
    });
    try {
      const result = await f.run(() =>
        research(
          f.db,
          blobs,
          "workspace",
          "run",
          "Cached study finding",
          "discover",
          2,
        ),
      );
      assert.equal(registryCalls, 1);
      assert.equal(result.selections.length, retracted ? 0 : 1);
      assert.equal(
        result.candidates[0].eligibility,
        retracted ? "ineligible" : "eligible",
      );
      assert.equal(snapshot.metadata.lastPublicationCheckRunId, "run");
      if (!retracted)
        assert.deepEqual(result.selections[0], {
          assetId: "asset",
          extractionId: "extraction",
          pageRanges: [],
        });
    } finally {
      fetch.mock.restore();
      if (previous === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previous;
    }
  }
});

test("a permanently unresolved candidate is looked up once across different research queries", async () => {
  const f = fixture("discover");
  const old = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture-not-real";
  let identityRequests = 0;
  const stub = mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("api.exa.ai"))
      return Response.json({
        results: [
          {
            title: "Unidentified paper",
            url: "https://publisher.test/same-paper",
          },
        ],
      });
    identityRequests++;
    return Response.json({ message: { items: [] } });
  });
  try {
    for (const query of [
      "Tutoring improves adult scores",
      "Tutoring reduces adult stress",
    ])
      await f.run(() =>
        research(f.db, blobs, "workspace", "run", query, "discover", 2),
      );
    assert.equal(identityRequests, 1);
  } finally {
    stub.mock.restore();
    if (old === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = old;
  }
});
