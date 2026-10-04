import { createFixtureRun as createRun } from "./fixtures/work-sources.js";
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { ownedRun } from "../server/backend/service.js";
import { processRun } from "../server/backend/engine.js";
import { research } from "../server/backend/research.js";
import {
  reserveProviderRequest,
  recordProviderRequest,
} from "../server/backend/providers.js";
import { checksum } from "../server/backend/library.js";
import { runInput } from "../shared/backend.js";
import type { BlobStore } from "../server/backend/storage.js";

let db: Database;
const oldExa = process.env.EXA_API_KEY;
const oldEmbeddings = process.env.PROOF_EMBEDDINGS;
function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) return { rows: (await connection.query(sql, values)).rows };
      return { rows: (await connection.exec(sql)).at(-1)?.rows || [] };
    },
  };
}
before(async () => {
  process.env.EXA_API_KEY = "controlled-fixture";
  process.env.PROOF_EMBEDDINGS = "false";
  const pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
});
after(async () => {
  await db.close();
  if (oldExa === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = oldExa;
  if (oldEmbeddings === undefined) delete process.env.PROOF_EMBEDDINGS;
  else process.env.PROOF_EMBEDDINGS = oldEmbeddings;
});
async function draft(ws: string) {
  const document = randomUUID(),
    version = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,'Public fact',$3)",
    [document, ws, version],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [version, ws, document, "Paris is the capital of France."],
  );
  return version;
}
test("public web evidence is inspected, frozen by content version, reused only within its work and never labeled academic", async () => {
  const ws = await workspace(db, randomUUID());
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    async put(key, body) {
      files.set(key, Buffer.from(body));
    },
    async get(key) {
      return files.get(key)!;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  const version = await draft(ws);
  const url = "https://example.org/city-guide?edition=1";
  let content =
    "Paris is the capital of France. This controlled public page describes the city and its administrative role. It includes enough complete text for inspection without relying on a search snippet, a publication count, or academic eligibility. The source must retain its public provenance.";
  let searches = 0,
    downloads = 0;
  const fetch = mock.method(
    globalThis,
    "fetch",
    async (input: any, options: RequestInit) => {
      assert.match(String(input), /api.exa.ai\/search/);
      const body = JSON.parse(String(options.body));
      assert.equal(body.category, undefined);
      assert.equal(body.includeDomains, undefined);
      searches++;
      return Response.json({ results: [{ title: "City guide", url }] });
    },
  );
  const download = async (requested: string) => {
    downloads++;
    assert.equal(requested, url);
    const ticket = await reserveProviderRequest(url, "document");
    const buffer = Buffer.from(
      `<html><body><main><p>${content}</p></main></body></html>`,
    );
    await recordProviderRequest(ticket, "complete", {
      bytes: buffer.length,
      estimatedUsd: 0,
      charge: "none",
    });
    return { buffer, url, type: "text/html" };
  };
  const execute = async (owner: string, documentVersionId: string) => {
    const run = await createRun(
      db,
      owner,
      runInput.parse({
        documentVersionId,
        mode: "fact_check",
        sourcePolicy: "public",
        externalAccess: "research",
        allowProviderProcessing: true,
      }),
      randomUUID(),
    );
    await processRun(db, blobs, owner, run.id, {
      research: (
        database,
        store,
        ownerId,
        runId,
        query,
        mode,
        maximum,
        route,
      ) =>
        research(database, store, ownerId, runId, query, mode, maximum, route, {
          download,
        }),
      resolveReferences: async () => ({
        selections: [],
        candidates: [],
        notices: [],
      }),
      judge: async (claim, source, passages) => {
        assert.equal(source.access, "full_text");
        assert.ok(
          passages!.some((p) => p.includes("Paris is the capital of France.")),
        );
        return {
          ...claim,
          status: "supported",
          method: "Jev",
          evidence: passages![0],
          checkedPassages: passages,
          explanation:
            "Exact public-page passage supports this controlled claim.",
        };
      },
    });
    assert.equal((await ownedRun(db, owner, run.id)).status, "complete");
    const finding = (
      await db.query(
        "SELECT data FROM findings WHERE workspace_id=$1 AND run_id=$2",
        [owner, run.id],
      )
    ).rows[0].data;
    assert.equal(finding.support, "supported");
    assert.equal(finding.basis, "public_sources");
    assert.equal(finding.eligibility, "unknown");
    assert.ok(finding.evidence[0].text.includes(content));
    assert.equal(finding.evidence[0].labelStatus, "unknown");
    const assetId = finding.evidence[0].assetId;
    const asset = (
      await db.query(
        "SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2",
        [owner, assetId],
      )
    ).rows[0];
    assert.equal(asset.metadata.evidencePolicy, "public");
    assert.equal(asset.metadata.pagination, "unavailable");
    assert.equal(
      asset.metadata.contentFingerprint,
      checksum(await blobs.get(asset.object_key)),
    );
    assert.equal(asset.metadata.extractionCompleteness, "complete");
    return { asset, finding };
  };
  try {
    const initial = await execute(ws, version);
    assert.equal(
      searches,
      2,
      "both relevance and conflict intentions are searched",
    );
    assert.equal(
      downloads,
      1,
      "the same web page from two search intentions is downloaded once",
    );
    const originalBody = await blobs.get(initial.asset.object_key);
    content += " This later retrieved edition adds another complete paragraph.";
    const revised = await execute(ws, version);
    assert.equal(
      searches,
      2,
      "a warm run reuses both scoped search queries while fetching current content",
    );
    assert.notEqual(
      revised.asset.id,
      initial.asset.id,
      "changed full text gets a new immutable snapshot",
    );
    assert.notEqual(
      revised.asset.metadata.textFingerprint,
      initial.asset.metadata.textFingerprint,
    );
    assert.deepEqual(
      await blobs.get(initial.asset.object_key),
      originalBody,
      "older evidence is preserved",
    );
    const unchanged = await execute(ws, version);
    assert.equal(
      searches,
      2,
      "another warm run also avoids duplicate Exa calls",
    );
    assert.equal(
      unchanged.asset.id,
      revised.asset.id,
      "unchanged URL/content/parser reuse one stored extraction",
    );
    const anotherWork = await execute(ws, await draft(ws));
    assert.notEqual(
      anotherWork.asset.id,
      revised.asset.id,
      "another work cannot reuse source assets from this work",
    );
    assert.equal(searches, 4, "another work performs its own searches");
    const otherWorkspace = await workspace(db, randomUUID());
    const other = await execute(otherWorkspace, await draft(otherWorkspace));
    assert.notEqual(
      other.asset.id,
      revised.asset.id,
      "another workspace cannot reuse tenant-owned source assets",
    );
    const ledger = (
      await db.query(
        "SELECT provider,count(*)::int AS n FROM provider_calls GROUP BY provider ORDER BY provider",
      )
    ).rows;
    assert.deepEqual(ledger, [
      { provider: "document", n: 5 },
      { provider: "exa", n: 6 },
    ]);
  } finally {
    fetch.mock.restore();
  }
});
