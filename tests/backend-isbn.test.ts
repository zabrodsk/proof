import test from "node:test";
import assert from "node:assert/strict";
import { validIsbn, resolveIsbn } from "../server/backend/references.js";
test("ISBN lookup validates checksums and never accepts a different edition identifier", async () => {
  assert.equal(validIsbn("978-0-9802004-4-7"), true);
  assert.equal(validIsbn("0451526538"), true);
  assert.equal(validIsbn("9780980200448"), false);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      "ISBN:9780980200447": {
        title: "Library book",
        identifiers: { isbn_13: ["9780980200447"] },
        publish_date: "2009",
        authors: [{ name: "A. Author" }],
      },
    });
  try {
    assert.equal((await resolveIsbn("9780980200447"))?.year, "2009");
    globalThis.fetch = async () =>
      Response.json({
        "ISBN:9780980200447": {
          title: "Another edition",
          identifiers: { isbn_13: ["9780980200448"] },
        },
      });
    assert.equal(await resolveIsbn("9780980200447"), undefined);
  } finally {
    globalThis.fetch = original;
  }
});
