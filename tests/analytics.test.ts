import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { analyticsConfig, analyticsRouter } from "../server/analytics.js";
import { analyticsPath, analyticsProperties } from "../shared/analytics.js";

test("analytics requires explicit enablement and a public project token", () => {
  assert.deepEqual(analyticsConfig({}), { enabled: false });
  assert.deepEqual(analyticsConfig({ PROOF_POSTHOG_TOKEN: "phc_public" }), {
    enabled: false,
  });
  assert.deepEqual(
    analyticsConfig({
      PROOF_POSTHOG_ENABLED: "true",
      PROOF_POSTHOG_TOKEN: "phx_personal_secret",
    }),
    { enabled: false },
  );
  assert.deepEqual(
    analyticsConfig({
      PROOF_POSTHOG_ENABLED: "true",
      PROOF_POSTHOG_TOKEN: "phc_public",
      PROOF_POSTHOG_HOST: "https://other.example",
    }),
    { enabled: false },
  );
  assert.deepEqual(
    analyticsConfig({
      PROOF_POSTHOG_ENABLED: "true",
      PROOF_POSTHOG_TOKEN: "phc_public",
      WORKOS_API_KEY: "secret",
    }),
    { enabled: true, token: "phc_public", host: "https://eu.i.posthog.com" },
  );
});

test("page activity removes IDs, unknown routes, search parameters and hashes", () => {
  assert.equal(
    analyticsPath("/app/works/private-document/claims?token=secret#private"),
    "/app/works/:id/claims",
  );
  assert.equal(
    analyticsPath("/app/integrations?secret=token#connect"),
    "/app/integrations",
  );
  assert.equal(analyticsPath("/auth/callback?code=secret"), "/other");
  assert.equal(analyticsPath("/unknown/private-name/"), "/other");
});

test("analytics payload drops document content, names, URLs and nested profiles", () => {
  assert.deepEqual(
    analyticsProperties({
      text: "Private document text",
      title: "Private document title",
      email: "private@example.com",
      filename: "private.pdf",
      $set: { name: "Private person" },
      $current_url: "https://proof.example?token=secret",
      $referrer: "https://example.com/private",
      $pathname: "/private",
      path: "/app/works/private-id",
      mode: "fact_check",
      word_count: 100.8,
      source_count: Infinity,
      claim_count: -1,
      media_type: "application/pdf",
    }),
    {
      path: "/app/works/:id",
      mode: "fact_check",
      word_count: 100,
      media_type: "application/pdf",
      $process_person_profile: false,
      $geoip_disable: true,
      app: "proof",
    },
  );
  assert.deepEqual(
    analyticsProperties({ mode: "private text", format: "private text" }),
    { $process_person_profile: false, $geoip_disable: true, app: "proof" },
  );
});

test("public runtime config works before authentication and exposes no other environment values", async () => {
  const app = express();
  app.use(analyticsRouter());
  app.use((_req, res) => {
    res.sendStatus(401);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/analytics/config`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), analyticsConfig());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
