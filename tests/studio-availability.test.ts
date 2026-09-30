import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, canUseLocalDrafts } from "../src/studio-api.js";

test("production and hosted sessions never fall back to browser-only drafts", () => {
  const unavailable = new ApiError("Unavailable", 503);
  for (const hosted of [true, false]) {
    assert.equal(
      canUseLocalDrafts({ authenticated: true, hosted }, false, unavailable),
      false,
    );
  }
  assert.equal(
    canUseLocalDrafts({ authenticated: true, hosted: true }, true, unavailable),
    false,
  );
});

test("local development only falls back for an unavailable backend", () => {
  const session = { authenticated: true, hosted: false };
  assert.equal(
    canUseLocalDrafts(session, true, new ApiError("Unavailable", 503)),
    true,
  );
  for (const error of [
    new ApiError("Unauthorized", 401),
    new ApiError("Server error", 500),
    new Error("Network error"),
  ]) {
    assert.equal(canUseLocalDrafts(session, true, error), false);
  }
});
