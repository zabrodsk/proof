import { env, pipeline } from "@huggingface/transformers";
import {
  embeddingSnapshot,
  modelDirectory,
  verifyModelSnapshot,
} from "./embedding-model.js";
// Deployment preloads a reviewed local ONNX snapshot. Never download a mutable model during a run.
env.allowRemoteModels = false;
env.useFSCache = false;
let extractor: Promise<any> | undefined;
let loadedDirectory: string | undefined;
export type EmbeddingOptions = {
  enabled: boolean;
  revision: string | null;
  modelDirectory?: string;
};
export function embeddingOptions(): EmbeddingOptions {
  return {
    enabled: process.env.PROOF_EMBEDDINGS === "true",
    revision: process.env.PROOF_EMBEDDING_REVISION || null,
    modelDirectory: process.env.PROOF_MODEL_DIR || ".data/models/",
  };
}
export async function embed(
  text: string,
  purpose: "passage" | "query" = "passage",
  options = embeddingOptions(),
): Promise<number[] | undefined> {
  if (!options.enabled) return;
  if (options.revision !== embeddingSnapshot.revision)
    throw new Error(
      `Set PROOF_EMBEDDING_REVISION=${embeddingSnapshot.revision} to use the reviewed local snapshot.`,
    );
  const directory = modelDirectory(options.modelDirectory);
  if (extractor && loadedDirectory !== directory)
    throw new Error("Restart the worker after changing PROOF_MODEL_DIR.");
  if (!extractor) {
    loadedDirectory = directory;
    extractor = (async () => {
      await verifyModelSnapshot(directory);
      return pipeline("feature-extraction", directory, {
        dtype: embeddingSnapshot.dtype,
        device: "cpu",
        local_files_only: true,
        revision: embeddingSnapshot.revision,
      });
    })();
    extractor.catch(() => {
      extractor = undefined;
      loadedDirectory = undefined;
    });
  }
  const model = await extractor;
  const input =
    purpose === "query"
      ? `Represent this sentence for searching relevant passages: ${text}`
      : text;
  const result = await model(input, {
    pooling: embeddingSnapshot.pooling,
    normalize: true,
    truncation: true,
    max_length: 512,
  });
  const values = Array.from(result.data) as number[];
  if (values.length !== 384 || values.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid embedding dimensions.");
  return values;
}
export function vector(values: number[]) {
  if (values.length !== 384 || values.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid vector.");
  return `[${values.join(",")}]`;
}
