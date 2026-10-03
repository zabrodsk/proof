import { test, expect } from "@playwright/test";
import { openClaims, openReview, showSources } from "./work-pages";

test("setup defaults, disabled reasons and keyboard-accessible secondary options", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/v1/documents", {
    data: { title: "Compact setup", text: "The trial included 218 adults." },
  });
  const doc = await response.json();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-claims")).toContainText(
    "1 claim selected",
  );
  await expect(
    page.locator('.ps-setup-sources input[type="checkbox"]'),
  ).toHaveCount(0);
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Citable source" }),
  ).toBeVisible();
  await expect(page.locator("#studio-start-reason")).toContainText(
    "Allow AI processing",
  );
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await expect(page.locator(".ps-setup-start")).toBeEnabled();
  const options = page.locator("summary").filter({ hasText: /^More options$/ });
  await options.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Citation profile", exact: true }),
  ).toHaveValue("mla9");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Citation profile", exact: true }),
  ).not.toBeVisible();
  const modes = page.getByRole("group", { name: "Check type" });
  await modes
    .getByRole("button", { name: "Generate citations", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Academic sources", exact: true }),
  ).toBeChecked();
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Citable source" }),
  ).not.toBeVisible();
  await modes.getByRole("button", { name: "Fact-check", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Web and academic sources", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: `output/compact-setup/${test.info().project.name}-setup.png`,
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Copy document", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "More document options" }).click();
  await expect(
    page.getByRole("button", { name: "Copy document", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "More document options" }).click();
  await openClaims(page);
  await page
    .getByRole("checkbox", { name: "The trial included", exact: false })
    .uncheck();
  await page.getByRole("button", { name: "To review", exact: true }).click();
  await expect(page.locator(".ps-claim-result-row")).toHaveCount(1);
  await openReview(page);
  await expect(page.locator("#studio-start-reason")).toContainText(
    "Select at least one claim",
  );
  await expect(page.locator(".ps-setup-start")).toBeDisabled();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: Math.floor(viewport.width / 2),
    height: viewport.height,
  });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("manually restored claims are sent with exact spans and retain selection", async ({
  page,
  request,
}) => {
  const text = "The company employs 300 people.";
  const doc = await (
    await request.post("/api/v1/documents", {
      data: { title: "Manual claim", text },
    })
  ).json();
  await page.goto(`/app/works/${doc.id}`);
  await page
    .getByRole("button", { name: "Review claims", exact: true })
    .click();
  await page.getByRole("button", { name: "Unsure", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "The company employs", exact: false })
    .check();
  await expect(page.locator(".ps-claim-result-row")).toHaveCount(1);
  await expect(page.locator(".ps-claims-heading")).toContainText("1 selected");
  await openReview(page);
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Synthetic source" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  const outbound = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/runs",
  );
  await page.locator(".ps-setup-start").click();
  expect((await outbound).postDataJSON().claimSpans).toEqual([
    { start: 0, end: text.length },
  ]);
  await expect(
    page.getByText("1 of 1 selected claims checked.", { exact: false }),
  ).toBeVisible();
  await openClaims(page);
  await page.getByRole("button", { name: "Unsure", exact: true }).click();
  await expect(page.locator(".ps-claim-result-row")).toHaveCount(1);
  await expect(page.locator(".ps-claim-result-row")).not.toContainText(
    "Not checked",
  );
  await page.reload();
  await page.getByRole("button", { name: "Unsure", exact: true }).click();
  await expect(page.locator(".ps-claim-result-row")).toHaveCount(1);
  await expect(
    page.locator(".ps-claim-result-row input[type=checkbox]"),
  ).toBeChecked();
});

test("bibliography-only checks keep retrieval consent and run with zero claims", async ({
  page,
  request,
}) => {
  const doc = await (
    await request.post("/api/v1/documents", {
      data: { title: "Bibliography only", text: "Jane Smith." },
    })
  ).json();
  await page.goto(`/app/works/${doc.id}/citations`);
  await page
    .getByRole("textbox", { name: "Bibliography", exact: true })
    .fill(
      'Brown, Maria. "Citable source." Evidence Journal, vol. 4, no. 2, 2024, pp. 21-22.',
    );
  await page
    .getByRole("button", { name: "Format bibliography", exact: true })
    .click();
  await expect(page.locator(".ps-analysis-import-status")).toContainText(
    "1 formatted reference",
  );
  await openReview(page);
  await page
    .locator("summary")
    .filter({ hasText: /^Bibliography \(optional\)$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Manage", exact: true }),
  ).toBeVisible();
  const consent = page.getByRole("checkbox", {
    name: "Allow Proof to retrieve",
    exact: false,
  });
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await page
    .getByRole("button", { name: "Edit used sources", exact: true })
    .click();
  for (const source of await page
    .locator('.ps-analysis-source input[type="checkbox"]')
    .all())
    await source.uncheck();
  await openReview(page);
  const outbound = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/runs",
  );
  await page.locator(".ps-setup-start").click();
  const input = (await outbound).postDataJSON();
  expect(input.claimSpans).toEqual([]);
  expect(input.selectedSources).toEqual([]);
  expect(input.externalAccess).toBe("resolve_selected_references");
  expect(input.referenceImportVersionId).toBeTruthy();
});
