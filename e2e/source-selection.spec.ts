import { test, expect } from "@playwright/test";
import { openReview } from "./work-pages";

test("sources start included, editing happens on Sources, and exclusions survive reload", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/v1/documents", {
    data: { title: "Source selection", text: "The trial included 218 adults." },
  });
  const doc = await created.json();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-sources")).toContainText(
    "Citable source",
  );
  await expect(
    page.locator('.ps-setup-sources input[type="checkbox"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit used sources", exact: true })
    .click();
  await expect(page).toHaveURL(`/app/works/${doc.id}/citations`);
  const sources = page.locator('.ps-analysis-source input[type="checkbox"]');
  await expect(sources.first()).toBeChecked();
  expect(await sources.count()).toBeGreaterThan(1);
  for (const source of await sources.all()) await expect(source).toBeChecked();
  const cited = page
    .locator(".ps-analysis-source")
    .filter({ hasText: "Citable source" });
  await cited.getByRole("checkbox").uncheck();
  await page.reload();
  await expect(cited.getByRole("checkbox")).not.toBeChecked();
  await openReview(page);
  await expect(page.locator(".ps-setup-sources")).not.toContainText(
    "Citable source",
  );
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await page.locator(".ps-setup-start").click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/documents/${doc.id}/runs`);
      const runs = (await response.json()).items;
      return runs.length;
    })
    .toBe(1);
  const run = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  const excluded = run.input.excludedSourceIds;
  expect(excluded).toHaveLength(1);
  expect(
    run.input.selectedSources.some((source: { assetId: string }) =>
      excluded.includes(source.assetId),
    ),
  ).toBe(false);
});
