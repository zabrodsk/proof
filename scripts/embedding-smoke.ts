import assert from "node:assert/strict";
import { embed } from "../server/backend/embeddings.js";
import { embeddingSnapshot } from "../server/backend/embedding-model.js";

process.env.PROOF_EMBEDDINGS = "true";
process.env.PROOF_EMBEDDING_REVISION ||= embeddingSnapshot.revision;
const query = await embed(
  "How does lack of rest affect remembering new information?",
  "query",
);
assert.ok(query);
assert.equal(query.length, 384);
const passages = [
  "Sleep deprivation impairs memory consolidation and makes learning new material more difficult.",
  "The museum's collection includes paintings, bronze sculptures, and ceramic vessels.",
  "The manufacturer sells replacement tires for passenger vehicles and delivery trucks.",
];
const ranked = await Promise.all(
  passages.map(async (text, index) => {
    const values = await embed(text);
    assert.ok(values);
    assert.equal(values.length, 384);
    assert.ok(Math.abs(Math.hypot(...values) - 1) < 0.0001);
    return {
      index,
      text,
      score: query.reduce((sum, value, i) => sum + value * values[i], 0),
    };
  }),
);
ranked.sort((a, b) => b.score - a.score);
assert.equal(ranked[0].index, 0);
assert.ok(ranked[0].score - ranked[1].score > 0.1);
console.log(
  JSON.stringify(
    {
      model: embeddingSnapshot.model,
      revision: embeddingSnapshot.revision,
      dimensions: query.length,
      device: "cpu",
      remoteModels: false,
      ranked,
    },
    null,
    2,
  ),
);
