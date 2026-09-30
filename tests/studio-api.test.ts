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
