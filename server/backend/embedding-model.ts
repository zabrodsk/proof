import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { versions } from "./config.js";

// Published file hashes from the immutable Hugging Face tree API for this revision.
export const embeddingSnapshot = {
  model: versions.embedding,
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dimensions: 384,
  dtype: "q8",
  pooling: "cls",
  files: [
    {
      path: "config.json",
      bytes: 683,
      git: "0c4d86248983ce46dfc09a9091b6f56bb0224550",
    },
    {
      path: "tokenizer.json",
      bytes: 711396,
      git: "688882a79f44442ddc1f60d70334a7ff5df0fb47",
    },
    {
      path: "tokenizer_config.json",
      bytes: 366,
      git: "37fca74771bc76a8e01178ce3a6055a0995f8093",
    },
    {
      path: "special_tokens_map.json",
      bytes: 125,
      git: "a8b3208c2884c4efb86e49300fdd3dc877220cdf",
    },
    {
      path: "onnx/model_quantized.onnx",
      bytes: 34014426,
      sha256:
        "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4",
    },
  ],
} as const;

export function modelDirectory(
  root = process.env.PROOF_MODEL_DIR || ".data/models/",
) {
  return path.resolve(
    root,
    embeddingSnapshot.model,
    embeddingSnapshot.revision,
  );
}

export function verifyModelFile(
  file: (typeof embeddingSnapshot.files)[number],
  body: Buffer,
) {
  const sha256 = createHash("sha256").update(body).digest("hex");
  const expected =
    "git" in file
      ? createHash("sha1")
          .update(`blob ${body.length}\0`)
          .update(body)
          .digest("hex") === file.git
      : sha256 === file.sha256;
  if (body.length !== file.bytes || !expected)
    throw new Error(
      `Embedding model integrity check failed for ${file.path}. Run npm run model:prepare.`,
    );
  return sha256;
}

export async function verifyModelSnapshot(directory: string) {
  let manifest: any;
  try {
    manifest = JSON.parse(
      await readFile(path.join(directory, "proof-model-manifest.json"), "utf8"),
    );
  } catch (error: any) {
    if (error.code === "ENOENT")
      throw new Error(
        "Local embedding snapshot is missing. Run npm run model:prepare.",
      );
    throw new Error(
      "Local embedding manifest is unreadable. Run npm run model:prepare.",
    );
  }
  if (
    manifest.model !== embeddingSnapshot.model ||
    manifest.revision !== embeddingSnapshot.revision ||
    manifest.dimensions !== embeddingSnapshot.dimensions ||
    manifest.dtype !== embeddingSnapshot.dtype ||
    manifest.pooling !== embeddingSnapshot.pooling
  )
    throw new Error(
      "Local embedding model manifest does not match the pinned snapshot.",
    );
  for (const file of embeddingSnapshot.files) {
    const sha256 = verifyModelFile(
      file,
      await readFile(path.join(directory, file.path)),
    );
    if (manifest.files?.[file.path]?.sha256 !== sha256)
      throw new Error(`Local embedding manifest mismatch for ${file.path}.`);
  }
}
