import { test, expect } from "@playwright/test";
import { openClaims, openReview, showSources } from "./work-pages";

test("compact setup links to Claims and preserves selection and exact findings", async ({
  page,
  request,
}) => {
  const text =
    "Jane Smith.\nThe trial included 120 adults.\nParis is the capital of France.";
  const created = await request.post("/api/v1/documents", {
    data: { title: "Claims tab acceptance", text },
  });
  expect(created.status()).toBe(201);
  const doc = await created.json();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-claims")).toContainText(
    "2 claims selected",
  );
  await expect(
    page.getByRole("combobox", { name: "Citation profile", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".ps-claim-preview")).toHaveCount(0);
  await expect(page.locator(".ps-claim-results")).toHaveCount(0);
  await openClaims(page);
  const rows = page.locator(".ps-claim-result-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Not checked");
  await expect(rows.first()).toContainText("Citation required");
  await expect(rows.filter({ hasText: "Paris is the capital" })).toContainText(
    "General fact · No citation needed",
  );
  await expect(rows.getByRole("combobox")).toHaveCount(2);
  await expect(rows.locator(".ps-claim-settings")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Paris is", exact: false })
    .uncheck();
  await openReview(page);
  await expect(page.locator(".ps-setup-claims")).toContainText(
    "1 claim selected",
  );
  await openClaims(page);
  await expect(
    page.getByRole("checkbox", { name: "Paris is", exact: false }),
  ).not.toBeChecked();
  await rows
    .filter({ hasText: "The trial included" })
    .getByRole("button", { name: "Locate claim:", exact: false })
    .click();
  await expect(page.getByLabel("Document text")).toBeFocused();
  expect(
    await page
      .getByLabel("Document text")
      .evaluate((el: HTMLTextAreaElement) =>
        el.value.slice(el.selectionStart, el.selectionEnd),
      ),
  ).toBe("The trial included 120 adults.");
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Synthetic source" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByText("1 of 1 selected claims checked.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".ps-claim-results")).toHaveCount(0);
  await openClaims(page);
  const trial = rows.filter({ hasText: "The trial included 120 adults." });
  await expect(trial).toContainText("Contradicted");
  await trial.locator(".ps-change-head").click();
  await expect(trial.locator("blockquote")).toContainText(
    "The trial included 218 adults.",
  );
  const unchecked = rows.filter({
    has: page.locator(".ps-claim-result-text", {
      hasText: "Paris is the capital of France.",
    }),
  });
  await expect(unchecked).toContainText("Not checked");
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(trial).toContainText("Contradicted");
});
