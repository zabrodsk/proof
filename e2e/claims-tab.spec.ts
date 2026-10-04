import { enableAiProcessing } from "./work-pages";
import { test, expect } from "@playwright/test";
import { openClaims, openReview, showSources } from "./work-pages";

test("Open in review highlights the claim in the review editor", async ({
  page,
  request,
}) => {
  const text = "A trial included 120 adults.\nA second claim follows.";
  const created = await request.post("/api/v1/documents", {
    data: { title: "Open claim in review", text },
  });
  expect(created.status()).toBe(201);
  const document = await created.json();
  await page.goto(`/app/works/${document.id}`);
  await openClaims(page);
  await page.getByRole("button", { name: "All claims", exact: true }).click();

  const claim = page
    .locator(".ps-claim-result-row")
    .filter({ hasText: "A trial included 120 adults." });
  await claim
    .getByRole("button", {
      name: "Open claim in review: A trial included 120 adults.",
    })
    .click();

  await expect(page.getByLabel("Document text")).toBeFocused();
  await expect(page.locator(".ps-locate-focus")).toHaveText(
    "A trial included 120 adults.",
  );
  expect(
    await page
      .getByLabel("Document text")
      .evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
  ).toEqual([0, 0]);
});

test("compact setup checks cited claims and retains exact findings after reload", async ({
  page,
  request,
}) => {
  const trialText = "The trial included 120 adults (Test Author).";
  const text = `Jane Smith.\n${trialText}\nParis is the capital of France.`;
  const created = await request.post("/api/v1/documents", {
    data: { title: "Claims tab acceptance", text },
  });
  expect(created.status()).toBe(201);
  const doc = await created.json();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-claims")).toContainText(
    "1 claim selected",
  );
  await openClaims(page);
  const rows = page.locator(".ps-claim-result-row");
  await expect(rows).toHaveCount(1);
  const trial = rows.filter({ hasText: trialText });
  await trial
    .getByRole("button", { name: "Open claim in review:", exact: false })
    .click();
  await expect(page.getByLabel("Document text")).toBeFocused();
  await expect(page.locator(".ps-locate-focus")).toContainText(trialText);
  expect(
    await page
      .getByLabel("Document text")
      .evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
  ).toEqual([text.indexOf(trialText), text.indexOf(trialText)]);
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Synthetic source" }),
  ).toBeVisible();
  await enableAiProcessing(page);
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByRole("heading", { name: "2 issues to review", exact: true }),
  ).toBeVisible();
  await openClaims(page);
  await expect(trial).toContainText("Contradicted");
  await trial.locator(".ps-change-head").click();
  await expect(trial.locator("blockquote").first()).toContainText(
    "The trial included 218 adults.",
  );
  await page.getByRole("button", { name: "All claims", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(
    rows.filter({
      has: page.locator(".ps-claim-result-text", {
        hasText: "Paris is the capital",
      }),
    }),
  ).toContainText("No citation · Not checked");
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(trial).toContainText("Contradicted");
});

test("citation review defaults to cited claims and keeps uncited claims outside issues", async ({
  page,
  request,
}) => {
  const cited = "The trial included 120 adults (Unknown 1).";
  const uncited = "These findings mean the treatment cures depression.";
  const created = await request.post("/api/v1/documents", {
    data: { title: "Cited claims scope", text: `${cited}\n${uncited}` },
  });
  expect(created.status()).toBe(201);
  const doc = await created.json();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-claims")).toContainText(
    "1 claim selected",
  );
  await openClaims(page);
  await expect(
    page.getByRole("button", { name: "Cited claims", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator(".ps-claim-result-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(cited);
  await page.getByRole("button", { name: "All claims", exact: true }).click();
  await expect(rows).toHaveCount(2);
  const uncitedRow = rows.filter({ hasText: uncited });
  await expect(uncitedRow).toContainText("No citation · Not checked");
  await expect(uncitedRow.getByRole("checkbox")).toBeDisabled();
  await expect(uncitedRow.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("button", { name: "No citation", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(uncited);
  await expect(rows.filter({ hasText: cited })).toHaveCount(0);
  await openReview(page);
  await enableAiProcessing(page);
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByRole("heading", { name: "1 issue to review", exact: true }),
  ).toBeVisible();
  await openClaims(page);
  await page.getByRole("button", { name: "All claims", exact: true }).click();
  await expect(uncitedRow).toContainText("No citation · Not checked");
  await page.getByRole("button", { name: "To review", exact: true }).click();
  await expect(rows.filter({ hasText: uncited })).toHaveCount(0);
});
