import { defineConfig, devices } from "@playwright/test";
const testPort = Number(process.env.PROOF_E2E_PORT || 4333);
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    // Existing review tests start after the one-time privacy choice.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${testPort}`,
          localStorage: [
            {
              name: "proof.preferences.v1:browser-e2e",
              value: JSON.stringify({
                privacyReviewed: true,
                aiProcessing: false,
                retrieveCitedWorks: true,
              }),
            },
          ],
        },
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
    },
  ],
  webServer: {
    command: "node --import tsx scripts/review-e2e-server.ts",
    url: `http://127.0.0.1:${testPort}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
