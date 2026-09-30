import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { embed, vector } from "../server/backend/embeddings.js";
import {
  embeddingSnapshot,
  modelDirectory,
  verifyModelFile,
  verifyModelSnapshot,
} from "../server/backend/embedding-model.js";

test("disabled frozen configuration does not start an embedding model", async () => {
  assert.equal(
    await embed("A passage", "query", { enabled: false, revision: null }),
    undefined,
  );
});
test("enabled embeddings reject a mutable revision", async () => {
  await assert.rejects(
    embed("A passage", "query", { enabled: true, revision: "main" }),
    /reviewed local snapshot/,
  );
});
test("model files must match their published hashes", () => {
  const file = embeddingSnapshot.files.find(
    (file) => file.path === "config.json",
  )!;
  assert.throws(
    () => verifyModelFile(file, Buffer.alloc(file.bytes)),
    /integrity check failed/,
  );
});
test("snapshot validation rejects a falsely labeled manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-model-manifest-"));
  try {
    await writeFile(
      path.join(directory, "proof-model-manifest.json"),
      JSON.stringify({ model: embeddingSnapshot.model, revision: "main" }),
    );
    await assert.rejects(verifyModelSnapshot(directory), /does not match/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("database vectors reject invalid dimensions or values", () => {
  assert.throws(() => vector([1, 2]), /Invalid vector/);
  assert.throws(() => vector(new Array(384).fill(NaN)), /Invalid vector/);
});
test("real local ONNX model returns normalized 384-dimensional embeddings and ranks a paraphrase", async (t) => {
  try {
    await verifyModelSnapshot(modelDirectory());
  } catch (error: any) {
    if (error.message.includes("missing")) {
      t.skip("Run npm run model:prepare to install the pinned ONNX snapshot.");
      return;
    }
    throw error;
  }
  const options = { enabled: true, revision: embeddingSnapshot.revision };
  const query = await embed(
    "How does lack of rest affect remembering new information?",
    "query",
    options,
  );
  const related = await embed(
    "Sleep deprivation impairs memory consolidation and makes learning new material more difficult.",
    "passage",
    options,
  );
  const unrelated = await embed(
    "The museum displays bronze sculptures and ceramic vessels.",
    "passage",
    options,
  );
  assert.ok(query && related && unrelated);
  for (const values of [query, related, unrelated]) {
    assert.equal(values.length, 384);
    assert.ok(values.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...values) - 1) < 0.0001);
  }
  const similarity = (values: number[]) =>
    query.reduce((sum, value, i) => sum + value * values[i], 0);
  assert.ok(similarity(related) - similarity(unrelated) > 0.1);
});
