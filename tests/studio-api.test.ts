import { test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../src/studio-api.js";

test("shared app API sends FormData without overriding its boundary", async () => {
  const original = globalThis.fetch;
  const form = new FormData();
  form.append("title", "Source upload");
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.method, "POST");
    assert.equal(options?.body, form);
    assert.equal(options?.headers, undefined);
    assert.equal(options?.credentials, "same-origin");
    return Response.json({ id: "import" });
  };
  try {
    assert.deepEqual(await api("/api/integrations/imports", form), {
      id: "import",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("shared app API accepts empty logout responses", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.method, "DELETE");
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await api("/api/session", undefined, "DELETE"), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("shared app API preserves integration error messages and HTTP status", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: "Source access expired." }, { status: 403 });
  try {
    await assert.rejects(api("/api/integrations/library"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.message, "Source access expired.");
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("approved edits send the same idempotency key when a request is retried", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (_url, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
    seen.push(headers.get("Idempotency-Key")!);
    assert.equal(options?.body, JSON.stringify({ approved: true }));
    return Response.json({ id: "saved-version" });
  };
  try {
    await api(
      "/api/v1/documents/document/apply-fixes",
      { approved: true },
      "POST",
      { idempotencyKey: "same-approved-edits" },
    );
    await api(
      "/api/v1/documents/document/apply-fixes",
      { approved: true },
      "POST",
      { idempotencyKey: "same-approved-edits" },
    );
    assert.deepEqual(seen, ["same-approved-edits", "same-approved-edits"]);
  } finally {
    globalThis.fetch = original;
  }
});
