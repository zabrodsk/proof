import { test, expect } from "@playwright/test";
import { showSources } from "./work-pages";

test("document import selects its detected sources and keeps manual source upload", async ({
  page,
  request,
  isMobile,
}) => {
  await page.goto("/app");
  if (isMobile)
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Add new work", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Work title", { exact: true })
    .fill("Automatic source import");
  await page.getByLabel("Choose document file", { exact: true }).setInputFiles({
    name: "work.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "The trial included 218 adults (Brown 2024).\n\nWorks Cited\nBrown, Maria. “Citable source.” Journal, 2024.\n\nUnidentified, Author. “Missing text.” Journal, 2024.",
    ),
  });
  await expect(page.getByLabel("Review the extracted text")).toContainText(
    "The trial",
  );
  // Fixture source already exists. Detection and attachment require no external request.
  await page
    .getByRole("checkbox", {
      name: "Allow Proof to look up cited works",
      exact: false,
    })
    .uncheck();
  await page.getByRole("button", { name: "Create work", exact: false }).click();
  await expect(page).toHaveURL(/\/app\/works\//);
  const id = new URL(page.url()).pathname.split("/")[3];
  await expect
    .poll(async () => {
      const data = await (
        await request.get(`/api/v1/documents/${id}/bibliography`)
      ).json();
      return data.item?.status;
    })
    .toBe("complete");
  await showSources(page);
  const source = page
    .locator(".ps-setup-source")
    .filter({ hasText: "Citable source" });
  await expect(source).toBeVisible();
  await expect(
    page.locator('.ps-setup-sources input[type="checkbox"]'),
  ).toHaveCount(0);
  const unavailable = page
    .locator(".ps-setup-source")
    .filter({ hasText: "Missing text" });
  await expect(unavailable).toContainText("Source text unavailable");
  await expect(unavailable).not.toContainText("Reading the text");
  await page
    .getByRole("button", { name: "Edit used sources", exact: true })
    .click();
  await expect(page).toHaveURL(`/app/works/${id}/citations`);
  await expect(
    page.getByText("Detected in your document", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Reference detected. External retrieval is disabled", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.locator('.ps-analysis-sources input[type="file"]'),
  ).toBeAttached();
  await page.locator('.ps-analysis-sources input[type="file"]').setInputFiles({
    name: "extra.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Additional evidence supplied by the writer after the automatic import.",
    ),
  });
  await expect(
    page.locator(".ps-analysis-source").filter({ hasText: "extra.txt" }),
  ).toBeVisible();
});
