import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { limits } from "./config.js";
export interface BlobStore {
  put(key: string, body: Buffer, type: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signUpload?(key: string, type: string, bytes: number): Promise<string>;
  signDownload?(key: string): Promise<string>;
}
export function localStorage(
  root = process.env.PROOF_STORAGE_DIR || ".data/library",
): BlobStore {
  const location = (key: string) => {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes(".."))
      throw new Error("Invalid storage key.");
    return path.resolve(root, key);
  };
  return {
    async put(key, body) {
      const file = location(key);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, body, { mode: 0o600 });
    },
    get: (key) => readFile(location(key)),
    delete: (key) => rm(location(key), { force: true }),
  };
}
export function storage(env: NodeJS.ProcessEnv = process.env): BlobStore {
  const generic = [
    "STORAGE_BUCKET",
    "STORAGE_ENDPOINT",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
  ].some((key) => !!env[key]);
  const bucket = generic ? env.STORAGE_BUCKET : env.R2_BUCKET;
  const endpoint = generic ? env.STORAGE_ENDPOINT : env.R2_ENDPOINT;
  const accessKeyId = generic
    ? env.STORAGE_ACCESS_KEY_ID
    : env.R2_ACCESS_KEY_ID;
  const secretAccessKey = generic
    ? env.STORAGE_SECRET_ACCESS_KEY
    : env.R2_SECRET_ACCESS_KEY;
  if (!bucket && !endpoint && !accessKeyId && !secretAccessKey) {
    if (env.PROOF_HOSTED === "true")
      throw new Error(
        "Hosted persistent storage requires a private S3-compatible bucket.",
      );
    return localStorage(env.PROOF_STORAGE_DIR);
  }
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
    throw new Error("Incomplete private S3-compatible storage configuration.");
  if (env.PROOF_HOSTED === "true" && new URL(endpoint).protocol !== "https:")
    throw new Error("Hosted private storage requires an HTTPS endpoint.");
  const client = new S3Client({
    region: env.STORAGE_REGION || "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async put(key, body, type) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: type,
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    },
    async get(key) {
      const r = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      if ((r.ContentLength || 0) > limits.fileBytes) {
        (r.Body as any)?.destroy?.();
        throw new Error("File exceeds upload limit.");
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of r.Body as any) {
        bytes += chunk.length;
        if (bytes > limits.fileBytes) {
          (r.Body as any).destroy();
          throw new Error("File exceeds upload limit.");
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(60_000),
      });
    },
    signUpload: (key, type, bytes) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: type,
          ContentLength: bytes,
        }),
        { expiresIn: 900 },
      ),
    signDownload: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: 60,
      }),
  };
}
