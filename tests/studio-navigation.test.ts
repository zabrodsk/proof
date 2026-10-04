import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkRoute, workPath } from "../src/app-navigation";

test("Claims routes support direct links, trailing slashes and existing work pages", () => {
  assert.equal(workPath("draft", "claims"), "/app/works/draft/claims");
  assert.deepEqual(parseWorkRoute("/app/works/draft/claims/"), {
    workId: "draft",
    section: "claims",
  });
  assert.deepEqual(parseWorkRoute("/app/works/draft/citations"), {
    workId: "draft",
    section: "citations",
  });
  assert.deepEqual(parseWorkRoute("/app/works/draft/analysis"), {
    workId: "draft",
    section: "dashboard",
  });
  assert.deepEqual(parseWorkRoute("/app"), {
    workId: null,
    section: "dashboard",
  });
});
