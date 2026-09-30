import { test } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/backend/storage.js";

const cloud = {
  PROOF_HOSTED: "true",
  STORAGE_BUCKET: "proof-library",
  STORAGE_ENDPOINT: "https://t3.storageapi.dev",
  STORAGE_ACCESS_KEY_ID: "test-access",
  STORAGE_SECRET_ACCESS_KEY: "test-secret",
};

test("hosted storage fails closed when credentials are missing or partial", () => {
  assert.throws(() => storage({ PROOF_HOSTED: "true" }), /private S3/);
  assert.throws(
    () => storage({ STORAGE_ENDPOINT: cloud.STORAGE_ENDPOINT }),
    /Incomplete/,
  );
  assert.throws(
    () =>
      storage({ ...cloud, STORAGE_BUCKET: undefined, R2_BUCKET: "unrelated" }),
    /Incomplete/,
  );
  assert.throws(
    () => storage({ ...cloud, STORAGE_ENDPOINT: "http://t3.storageapi.dev" }),
    /HTTPS/,
  );
});

test("Railway uploads and downloads use private expiring signatures", async () => {
  const blobs = storage(cloud);
  const upload = new URL(
    await blobs.signUpload!("workspace/asset/original", "application/pdf", 123),
  );
  assert.equal(upload.hostname, "proof-library.t3.storageapi.dev");
  assert.equal(upload.pathname, "/workspace/asset/original");
  assert.equal(upload.searchParams.get("X-Amz-Expires"), "900");
  assert.ok(
    upload.searchParams.get("X-Amz-SignedHeaders")?.includes("content-length"),
  );
  const download = new URL(
    await blobs.signDownload!("workspace/asset/original"),
  );
  assert.equal(download.searchParams.get("X-Amz-Expires"), "60");
  assert.ok(download.searchParams.has("X-Amz-Signature"));
});

test("the existing R2 configuration remains supported", async () => {
  const blobs = storage({
    PROOF_HOSTED: "true",
    R2_BUCKET: "proof-library",
    R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "test-access",
    R2_SECRET_ACCESS_KEY: "test-secret",
  });
  const download = new URL(
    await blobs.signDownload!("workspace/asset/original"),
  );
  assert.equal(
    download.hostname,
    "proof-library.example.r2.cloudflarestorage.com",
  );
});
