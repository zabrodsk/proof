import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";

test("disabled analytics loads no PostHog SDK and sends no external requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route(/https:\/\/.*posthog\.com\//, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/analytics/config", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/?private=secret#private");
  await expect(page.locator("body")).toContainText("proof.");
  await page.waitForTimeout(1000);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("module.no-external")),
    ),
  ).toBe(false);
});

test("synthetic analytics sanitizes pageviews and follows browser history without cookies", async ({
  page,
  context,
}) => {
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  await page.route(/https:\/\/.*posthog\.com\//, async (route) => {
    const request = route.request();
    const data = request.postDataBuffer();
    if (data && new URL(request.url()).pathname === "/e/") {
      const compression = new URL(request.url()).searchParams.get(
        "compression",
      );
      let decoded = data.toString();
      if (compression === "gzip-js") decoded = gunzipSync(data).toString();
      else if (decoded.startsWith("data="))
        decoded = Buffer.from(
          new URLSearchParams(decoded).get("data")!,
          "base64",
        ).toString();
      const payload = JSON.parse(decoded);
      events.push(
        ...(Array.isArray(payload) ? payload : payload.batch || [payload]),
      );
    }
    await route.fulfill({ json: { status: 1 } });
  });
  await page.route("**/api/analytics/config", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        token: "phc_synthetic_browser_test",
        host: "https://eu.i.posthog.com",
      },
    }),
  );
  await page.goto("/?private=secret#private");
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.includes("module.no-external")),
      ),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const entry = performance
      .getEntriesByType("resource")
      .find((item) => item.name.includes("module.no-external"))!;
    const { default: sdk } = await import(entry.name);
    // The production SDK filters automated browsers. Override only in this
    // intercepted fixture, then exercise the same before_send and history hooks.
    sdk.set_config({ opt_out_useragent_filter: true });
    sdk.capture("$pageview", { path: "/" });
  });
  await expect.poll(() => events.length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    history.pushState(
      {},
      "",
      "/app/works/private-document/claims?token=secret#private",
    );
    history.replaceState(
      {},
      "",
      "/app/works/private-document/claims?other=secret",
    );
    history.pushState({}, "", "/app/works/another-private-document/claims");
  });
  await expect
    .poll(() => events.filter((event) => event.event === "$pageview").length, {
      timeout: 15000,
    })
    .toBe(3);
  expect(events.map((event) => event.properties.path)).toEqual([
    "/",
    "/app/works/:id/claims",
    "/app/works/:id/claims",
  ]);
  expect(events.every((event) => event.properties.app === "proof")).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(
    /private-document|another-private|secret|\$current_url|\$referrer|\$set/,
  );
  expect(
    (await context.cookies()).filter((cookie) => cookie.name.startsWith("ph_")),
  ).toEqual([]);
});

test("Do Not Track skips analytics configuration and SDK loading", async ({
  page,
}) => {
  let configRequests = 0;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "doNotTrack", { value: "1" }),
  );
  await page.route("**/api/analytics/config", (route) => {
    configRequests++;
    return route.fulfill({
      json: {
        enabled: true,
        token: "phc_test",
        host: "https://eu.i.posthog.com",
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("body")).toContainText("proof.");
  expect(configRequests).toBe(0);
});
