import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import {
  compatibilityRouter,
  processCompatibilityJob,
  legacyCandidate,
} from "../server/backend/compatibility.js";
import { processRun } from "../server/backend/engine.js";
import type { BlobStore } from "../server/backend/storage.js";
import type { BackendFinding } from "../shared/backend.js";
function sql(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(query, values) {
      if (values) {
        const r = await connection.query(query, values);
        return { rows: r.rows, rowCount: r.affectedRows };
      }
      const r = (await connection.exec(query)).at(-1);
      return { rows: r?.rows || [] };
    },
  };
}

test("legacy jobs survive router recreation, preserve pasted source text, and share the run engine", async () => {
  const pg = new PGlite({ extensions: { vector } });
  const db: Database = {
    ...sql(pg),
    transaction: (fn) => pg.transaction((tx) => fn(sql(tx))),
    close: () => pg.close(),
  };
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    async put(key, body) {
      files.set(key, Buffer.from(body));
    },
    async get(key) {
      const body = files.get(key);
      if (!body) throw Error("Missing object");
      return body;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  await migrate(db);
  function app() {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
      res.locals.proofSession = req.get("X-Owner");
      next();
    });
    a.use("/api/class", compatibilityRouter(db, blobs));
    return a;
  }
  let server = app().listen(0, "127.0.0.1");
  const listen = async () => {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  };
  let base = await listen();
  const headers = {
    "Content-Type": "application/json",
    "X-Owner": "alice",
    "Idempotency-Key": "legacy-source-1",
  };
  const text =
    "  The review included 218 studies and discussed their limitations.\n\nResults varied by population.  ";
  const body = {
    text: "The review included 218 studies.",
    mode: "supplied",
    sources: [{ label: "A book without a DOI", text }],
  };
  try {
    const anonymous = await fetch(`${base}/api/class/evidence-checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(anonymous.status, 401);
    const post = await fetch(`${base}/api/class/evidence-checks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(post.status, 202);
    const { id } = (await post.json()) as { id: string };
    const replay = await fetch(`${base}/api/class/evidence-checks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(((await replay.json()) as { id: string }).id, id);
    const collision = await fetch(`${base}/api/class/evidence-checks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...body,
        text: "A different claim is supplied here.",
      }),
    });
    assert.equal(collision.status, 409);
    const ws = await workspace(db, "alice");
    await processCompatibilityJob(db, blobs, ws, id);
    await processCompatibilityJob(db, blobs, ws, id);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM runs WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0].n,
      1,
    );
    const a = (
      await db.query("SELECT * FROM source_assets WHERE workspace_id=$1", [ws])
    ).rows[0];
    assert.equal((await blobs.get(a.object_key)).toString(), text);
    assert.equal(a.metadata.title, "A book without a DOI");
    assert.equal(a.metadata.doi, undefined);
    const saved = (
      await db.query(
        "SELECT * FROM compatibility_jobs WHERE workspace_id=$1 AND id=$2",
        [ws, id],
      )
    ).rows[0];
    await processRun(db, blobs, ws, saved.run_id, {
      async judge(claim, source, packet = []) {
        return {
          ...claim,
          method: "Jev",
          status: "supported",
          evidence: packet[0],
          checkedPassages: packet,
          sourceId: source.id,
          explanation: "The supplied text states the same sample size.",
        };
      },
      async research() {
        throw Error("Supplied mode must not research");
      },
      async resolveReferences() {
        throw Error("Supplied mode must not resolve other references");
      },
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = app().listen(0, "127.0.0.1");
    base = await listen();
    const other = await fetch(`${base}/api/class/evidence-checks/${id}`, {
      headers: { "X-Owner": "bob" },
    });
    assert.equal(other.status, 404);
    const got = await fetch(`${base}/api/class/evidence-checks/${id}`, {
      headers: { "X-Owner": "alice" },
    });
    const report = (await got.json()) as any;
    assert.equal(report.status, "complete");
    assert.equal(
      report.report.rows[0].candidates[0].finding.status,
      "supported",
    );
    assert.equal(report.report.completed, 1);
    assert.equal(report.report.sources[0].title, "A book without a DOI");
    const wrongRoute = await fetch(`${base}/api/class/searches/${id}`, {
      headers: { "X-Owner": "alice" },
    });
    assert.equal(wrongRoute.status, 404);
    const search = await fetch(`${base}/api/class/searches`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "custom-query" },
      body: JSON.stringify({
        claim: "The population showed improved outcomes.",
        query: "population outcomes systematic review",
      }),
    });
    const searchJob = (await search.json()) as { id: string };
    assert.equal(search.status, 202);
    await processCompatibilityJob(db, blobs, ws, searchJob.id);
    const searchRun = (
      await db.query(
        "SELECT r.* FROM runs r JOIN compatibility_jobs c ON c.run_id=r.id AND c.workspace_id=r.workspace_id WHERE c.workspace_id=$1 AND c.id=$2",
        [ws, searchJob.id],
      )
    ).rows[0];
    assert.equal(
      searchRun.config.researchQuery,
      "population outcomes systematic review",
    );
    assert.equal(searchRun.input.mode, "discover");
    assert.equal(searchRun.input.sourcePolicy, "academic");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test("compatibility findings retain contradictions and never expose unchecked fixes", () => {
  const assetId = randomUUID();
  const finding: BackendFinding = {
    id: randomUUID(),
    claim: {
      text: "A claim is made.",
      start: 0,
      end: 16,
      kind: "factual",
      context: "A claim is made.",
    },
    support: "mixed",
    citation: "wrong_locator",
    eligibility: "unknown",
    processing: "partial",
    checkedPassageIds: [],
    explanation: ["Conflicting evidence."],
    evidence: [
      {
        id: randomUUID(),
        assetId,
        extractionId: randomUUID(),
        pageIndex: 1,
        labelStatus: "unknown",
        start: 0,
        end: 12,
        text: "Contradicts.",
        role: "cited",
        support: "contradicted",
      },
    ],
    fix: {
      original: "A claim is made.",
      replacement: "A different claim.",
      start: 0,
      end: 16,
      documentVersionId: randomUUID(),
      kind: "number",
    },
  };
  const candidate = legacyCandidate(finding, {
    id: assetId,
    title: "Source",
    authors: [],
    year: "",
    access: "uploaded",
    passages: [],
    provider: "Library",
    retrievedAt: "",
  });
  assert.equal(candidate.finding.status, "contradicted");
  assert.equal(candidate.finding.method, "unverified");
  assert.equal(candidate.finding.fix, undefined);
});
