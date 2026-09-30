import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionState } from "../src/mcp-connection";
import {
  evidenceLocator,
  integrationFindingState,
} from "../src/integration-report";
import type { ResultFinding } from "../shared/integrations/contracts";

test("a remote connection requires an enabled deployment, exact HTTPS URL and registered platform", () => {
  const config = {
    mcpEnabled: true,
    mcpUrl: "https://app.example/mcp",
    platforms: ["claude"],
  };
  assert.deepEqual(connectionState(config), {
    ready: true,
    reason: "ready",
    url: config.mcpUrl,
  });
  assert.equal(connectionState().reason, "loading");
  assert.equal(
    connectionState({ ...config, mcpEnabled: false }).reason,
    "disabled",
  );
  assert.equal(
    connectionState({ ...config, platforms: [] }).reason,
    "no_platforms",
  );
  for (const mcpUrl of [
    undefined,
    "not-a-url",
    "http://localhost/mcp",
    "https://user:secret@app.example/mcp",
    "https://app.example/mcp?token=secret",
    "https://app.example/mcp#fragment",
  ]) {
    assert.equal(connectionState({ ...config, mcpUrl }).ready, false);
  }
});

test("incomplete processing and unknown eligibility or citation cannot produce a positive connector verdict", () => {
  const finding: ResultFinding = {
    id: "finding",
    text: "Claim",
    start: 0,
    end: 5,
    support: "supported",
    citationCorrectness: "correct",
    sourceEligibility: "eligible",
    coverage: "checked",
    explanation: "",
    evidenceIds: [],
  };
  assert.equal(integrationFindingState(finding).tone, "supported");
  assert.equal(
    integrationFindingState({ ...finding, coverage: "not_verified" }).tone,
    "unverified",
  );
  assert.equal(
    integrationFindingState({ ...finding, processing: "partial" }).tone,
    "unverified",
  );
  assert.equal(
    integrationFindingState({ ...finding, citationCorrectness: "not_checked" })
      .tone,
    "review",
  );
  assert.equal(
    integrationFindingState({ ...finding, sourceEligibility: "unknown" }).tone,
    "review",
  );
});

test("evidence locators preserve actual pages and do not invent absent offsets", () => {
  assert.equal(
    evidenceLocator({ page: 2, pageLabel: "iv", chapter: 1 }),
    "PDF page 2, printed label iv, supplied chapter 1",
  );
  assert.equal(evidenceLocator({ start: 0 }), "Character offset 0");
  assert.equal(evidenceLocator({ paragraph: 3 }), "Paragraph 3");
  assert.equal(evidenceLocator({}), "Source locator not available");
});
