import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { backendRouter } from "../server/backend/router.js";
import type { BlobStore } from "../server/backend/storage.js";

let db: Database;
let server: Server;
let base: string;

function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) {
        const result = await connection.query(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows };
      }
      const result = (await connection.exec(sql)).at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows };
    },
  };
}

before(async () => {
  const pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
  const blobs: BlobStore = {
    async put() {
      throw new Error("Unexpected blob write");
    },
    async get() {
      throw new Error("Unexpected blob read");
    },
    async delete() {
      throw new Error("Unexpected blob deletion");
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.proofSession = req.get("X-Owner");
    next();
  });
  app.use("/api/backend", backendRouter(db, blobs));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api/backend`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await db?.close();
});

function request(
  owner: string | undefined,
  url: string,
  method = "GET",
  body?: unknown,
) {
  return fetch(`${base}${url}`, {
    method,
    headers: {
      ...(owner ? { "X-Owner": owner } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function document(
  owner: string,
  title: string,
  text = "Original draft.",
) {
  const response = await request(owner, "/documents", "POST", { title, text });
  assert.equal(response.status, 201);
  return (await response.json()) as { id: string; documentVersionId: string };
}

async function seedRun(owner: string, versionId: string, createdAt: string) {
  const ws = await workspace(db, owner),
    id = randomUUID();
  await db.query(
    "INSERT INTO runs(id,workspace_id,document_version_id,idempotency_key,request_hash,input,config,status,created_at) VALUES($1,$2,$3,$4,'fixture','{}','{}','complete',$5)",
    [id, ws, versionId, randomUUID(), createdAt],
  );
  return id;
}

test("Studio document list returns only the owner's current versions in paginated order", async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const first = await document(owner, "First");
  const second = await document(owner, "Second");
  await document(other, "Private document", "Other owner's text.");
  const update = await request(
    owner,
    `/documents/${first.id}/versions`,
    "POST",
    {
      text: "Revised draft.",
      expectedVersionId: first.documentVersionId,
    },
  );
  assert.equal(update.status, 201);
  const revised = await update.json();
  await db.query("UPDATE document_versions SET created_at=$2 WHERE id=$1", [
    second.documentVersionId,
    "2026-01-01T00:00:00Z",
  ]);
  await db.query("UPDATE document_versions SET created_at=$2 WHERE id=$1", [
    revised.id,
    "2026-01-02T00:00:00Z",
  ]);
  const response = await request(owner, "/documents");
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.deepEqual(
    items.map((item: { id: string }) => item.id),
    [first.id, second.id],
  );
  assert.equal(items[0].title, "First");
  assert.equal(items[0].text, "Revised draft.");
  assert.equal(items[0].current_version_id, revised.id);
  assert.equal(items[0].created_at, "2026-01-02T00:00:00.000Z");
  const next = await request(owner, "/documents?limit=1&offset=1");
  assert.deepEqual(
    (await next.json()).items.map((item: { id: string }) => item.id),
    [second.id],
  );
  assert.deepEqual(
    await (await request(owner, "/documents?limit=1&offset=2")).json(),
    { items: [] },
  );
  assert.deepEqual(await (await request(randomUUID(), "/documents")).json(), {
    items: [],
  });
});

test("Studio archive enforces ownership, hides the document, and retains its version and run records", async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const doc = await document(owner, "Archive me");
  const keep = await document(owner, "Keep me");
  const runId = await seedRun(
    owner,
    doc.documentVersionId,
    "2026-01-01T00:00:00Z",
  );
  assert.equal(
    (await request(other, `/documents/${doc.id}/archive`, "POST")).status,
    404,
  );
  assert.equal(
    (await request(owner, `/documents/${randomUUID()}/archive`, "POST")).status,
    404,
  );
  const archive = await request(owner, `/documents/${doc.id}/archive`, "POST");
  assert.equal(archive.status, 204);
  assert.equal(await archive.text(), "");
  const { items } = await (await request(owner, "/documents")).json();
  assert.deepEqual(
    items.map((item: { id: string }) => item.id),
    [keep.id],
  );
  assert.equal((await request(owner, `/documents/${doc.id}/runs`)).status, 404);
  assert.equal(
    (await request(owner, `/documents/${doc.id}/archive`, "POST")).status,
    404,
  );
  assert.equal(
    (
      await db.query("SELECT id FROM document_versions WHERE id=$1", [
        doc.documentVersionId,
      ])
    ).rows.length,
    1,
  );
  assert.equal(
    (await db.query("SELECT id FROM runs WHERE id=$1", [runId])).rows.length,
    1,
  );
});

test("Studio history includes runs from previous versions and excludes other documents and owners", async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const doc = await document(owner, "History");
  const oldRun = await seedRun(
    owner,
    doc.documentVersionId,
    "2026-01-01T00:00:00Z",
  );
  const updated = await request(
    owner,
    `/documents/${doc.id}/versions`,
    "POST",
    {
      text: "Updated claim.",
      expectedVersionId: doc.documentVersionId,
    },
  );
  assert.equal(updated.status, 201);
  const version = await updated.json();
  const recentRun = await seedRun(owner, version.id, "2026-01-03T00:00:00Z");
  const unrelated = await document(owner, "Another document");
  await seedRun(owner, unrelated.documentVersionId, "2026-01-04T00:00:00Z");
  const privateDoc = await document(other, "Another owner's document");
  await seedRun(other, privateDoc.documentVersionId, "2026-01-05T00:00:00Z");
  const response = await request(owner, `/documents/${doc.id}/runs`);
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.deepEqual(
    items.map((item: { id: string }) => item.id),
    [recentRun, oldRun],
  );
  assert.equal(items[1].invalidated, true);
  assert.equal(items[0].document_version_id, version.id);
  assert.equal((await request(other, `/documents/${doc.id}/runs`)).status, 404);
  assert.equal(
    (await request(owner, `/documents/${randomUUID()}/runs`)).status,
    404,
  );
  const empty = await document(owner, "No runs");
  assert.deepEqual(
    await (await request(owner, `/documents/${empty.id}/runs`)).json(),
    { items: [] },
  );
});

test("Studio history returns the newest 50 runs", async () => {
  const owner = randomUUID(),
    doc = await document(owner, "Long history");
  const ids = [];
  for (let i = 0; i < 52; i++)
    ids.push(
      await seedRun(
        owner,
        doc.documentVersionId,
        new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      ),
    );
  const { items } = await (
    await request(owner, `/documents/${doc.id}/runs`)
  ).json();
  assert.deepEqual(
    items.map((item: { id: string }) => item.id),
    ids.reverse().slice(0, 50),
  );
});

test("Studio endpoints require authentication and reject malformed pagination and document IDs", async () => {
  const owner = randomUUID(),
    id = randomUUID();
  for (const [url, method] of [
    ["/documents", "GET"],
    [`/documents/${id}/archive`, "POST"],
    [`/documents/${id}/runs`, "GET"],
  ]) {
    assert.equal((await request(undefined, url, method)).status, 401);
  }
  for (const query of [
    "limit=-1",
    "limit=101",
    "limit=1.5",
    "limit=no",
    "offset=-1",
    "offset=1000001",
    "offset=1.5",
  ]) {
    assert.equal(
      (await request(owner, `/documents?${query}`)).status,
      400,
      query,
    );
  }
  assert.equal(
    (await request(owner, "/documents/invalid/archive", "POST")).status,
    400,
  );
  assert.equal((await request(owner, "/documents/invalid/runs")).status, 400);
});

test("Studio bibliography persists its document association and retrieves the newest import", async () => {
  const owner = randomUUID();
  const doc = await document(owner, "Bibliography draft");
  const unrelated = await document(owner, "Another draft");
  assert.deepEqual(
    await (await request(owner, `/documents/${doc.id}/bibliography`)).json(),
    { item: null },
  );
  const first = await request(owner, "/source-imports", "POST", {
    kind: "bibliography",
    documentId: doc.id,
    text: "Brown. First reference. 2024.",
  });
  assert.equal(first.status, 202);
  const firstImport = await first.json();
  await db.query("UPDATE source_imports SET created_at=$2 WHERE id=$1", [
    firstImport.id,
    "2026-01-01T00:00:00Z",
  ]);
  const second = await request(owner, "/source-imports", "POST", {
    kind: "bibliography",
    documentId: doc.id,
    text: "Green. Revised reference. 2025.",
  });
  assert.equal(second.status, 202);
  const latest = await second.json();
  await request(owner, "/source-imports", "POST", {
    kind: "bibliography",
    documentId: unrelated.id,
    text: "Unrelated reference.",
  });
  await request(owner, "/source-imports", "POST", {
    kind: "bibliography",
    text: "Unattached reference.",
  });
  await request(owner, "/source-imports", "POST", {
    kind: "text",
    documentId: doc.id,
    text: "An imported source, not a bibliography.",
  });
  const response = await request(owner, `/documents/${doc.id}/bibliography`);
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(item.id, latest.referenceImportVersionId);
  assert.equal(item.status, "pending");
  assert.equal(item.input.documentId, doc.id);
  assert.equal(item.input.text, "Green. Revised reference. 2025.");
  assert.equal(
    (
      await db.query(
        "SELECT input->>'documentId' AS document_id FROM source_imports WHERE id=$1",
        [latest.id],
      )
    ).rows[0].document_id,
    doc.id,
  );
  await db.query("UPDATE source_imports SET status='complete' WHERE id=$1", [
    latest.id,
  ]);
  assert.equal(
    (await (await request(owner, `/documents/${doc.id}/bibliography`)).json())
      .item.status,
    "complete",
  );
});

test("Studio bibliography rejects foreign and archived documents without queuing imports", async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const doc = await document(owner, "Private bibliography");
  const ws = await workspace(db, other);
  const attempt = () =>
    request(other, "/source-imports", "POST", {
      kind: "bibliography",
      documentId: doc.id,
      text: "Private reference.",
    });
  assert.equal((await attempt()).status, 404);
  assert.equal(
    (await request(other, `/documents/${doc.id}/bibliography`)).status,
    404,
  );
  assert.equal(
    (
      await db.query("SELECT id FROM source_imports WHERE workspace_id=$1", [
        ws,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT id FROM job_outbox WHERE workspace_id=$1", [ws]))
      .rows.length,
    0,
  );
  assert.equal(
    (await request(undefined, `/documents/${doc.id}/bibliography`)).status,
    401,
  );
  assert.equal(
    (await request(owner, "/documents/invalid/bibliography")).status,
    400,
  );
  assert.equal(
    (await request(owner, `/documents/${randomUUID()}/bibliography`)).status,
    404,
  );
  assert.equal(
    (
      await request(owner, "/source-imports", "POST", {
        kind: "bibliography",
        documentId: "invalid",
        text: "Reference.",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(owner, `/documents/${doc.id}/archive`, "POST")).status,
    204,
  );
  assert.equal(
    (await request(owner, `/documents/${doc.id}/bibliography`)).status,
    404,
  );
  assert.equal(
    (
      await request(owner, "/source-imports", "POST", {
        kind: "bibliography",
        documentId: doc.id,
        text: "Reference.",
      })
    ).status,
    404,
  );
});
