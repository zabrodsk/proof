import { mkdir, mkdtemp, stat, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  embeddingSnapshot,
  modelDirectory,
  verifyModelFile,
  verifyModelSnapshot,
} from "../server/backend/embedding-model.js";

const target = modelDirectory();
try {
  await verifyModelSnapshot(target);
  console.log(
    `Verified existing local model ${embeddingSnapshot.model}@${embeddingSnapshot.revision}`,
  );
} catch {
  await mkdir(path.dirname(target), { recursive: true });
  const staging = await mkdtemp(`${target}.install-`);
  try {
    const files: Record<string, { bytes: number; sha256: string }> = {};
    for (const file of embeddingSnapshot.files) {
      const url = `https://huggingface.co/${embeddingSnapshot.model}/resolve/${embeddingSnapshot.revision}/${file.path}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok)
        throw new Error(
          `Model download failed for ${file.path}: HTTP ${response.status}`,
        );
      const body = Buffer.from(await response.arrayBuffer());
      const sha256 = verifyModelFile(file, body);
      await mkdir(path.dirname(path.join(staging, file.path)), {
        recursive: true,
      });
      await writeFile(path.join(staging, file.path), body);
      files[file.path] = { bytes: body.length, sha256 };
      console.log(`Verified ${file.path}, ${body.length} bytes`);
    }
    await writeFile(
      path.join(staging, "proof-model-manifest.json"),
      JSON.stringify(
        {
          model: embeddingSnapshot.model,
          revision: embeddingSnapshot.revision,
          dimensions: embeddingSnapshot.dimensions,
          dtype: embeddingSnapshot.dtype,
          pooling: embeddingSnapshot.pooling,
          files,
        },
        null,
        2,
      ) + "\n",
    );
    await verifyModelSnapshot(staging);
    // Preserve an invalid prior install for inspection rather than deleting it.
    try {
      await stat(target);
      await rename(target, `${target}.replaced-${Date.now()}`);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(staging, target);
    console.log(`Installed ${target}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
console.log(
  `PROOF_EMBEDDINGS=true\nPROOF_EMBEDDING_REVISION=${embeddingSnapshot.revision}`,
);
