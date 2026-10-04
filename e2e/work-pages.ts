import type { Page } from "@playwright/test";

// Review fixtures grant permission without discarding their current check setup.
// Onboarding and the actual Settings controls are covered in privacy-settings.spec.ts.
export async function enableAiProcessing(page: Page) {
  await page.evaluate(() => {
    const key = "proof.preferences.v1:browser-e2e";
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved, privacyReviewed: true, aiProcessing: true }),
    );
    window.dispatchEvent(
      new CustomEvent("proof:studio-preferences-changed", { detail: { key } }),
    );
  });
}

async function openSection(page: Page, section: "claims" | "dashboard") {
  await page.locator(".ps-page-heading").waitFor({ state: "visible" });
  const path = new URL(page.url()).pathname;
  if (section === "dashboard" && /^\/app\/works\/[^/]+\/?$/.test(path)) return;
  if (section === "claims" && path.endsWith("/claims")) return;
  const name = section === "claims" ? "Claims" : "Review";
  const link = page.getByRole("link", { name, exact: true });
  const rail = page.getByRole("button", { name, exact: true });
  if (await link.isVisible()) await link.click();
  else if (await rail.isVisible()) await rail.click();
  else {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await link.click();
  }
}

export async function openClaims(page: Page) {
  await openSection(page, "claims");
}

export async function openReview(page: Page) {
  await openSection(page, "dashboard");
}

export async function showSources(page: Page) {
  await page.locator(".ps-setup").waitFor({ state: "visible" });
  const summary = page
    .locator(".ps-setup-options > summary")
    .filter({ hasText: "My sources and bibliography" });
  if (
    (await summary.isVisible()) &&
    (await summary.locator("..").getAttribute("open")) === null
  ) {
    await summary.click();
  }
  const toggle = page.getByRole("button", { name: /^Your sources/ });
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
}
export async function showMoreOptions(page: Page) {
  const summary = page
    .locator(".ps-setup-options > summary")
    .filter({ hasText: "More options" });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
}

export async function showCheckDetails(page: Page) {
  const factCheck = page
    .getByRole("group", { name: "Check type" })
    .getByRole("button", { name: "Fact-check", exact: true });
  if ((await factCheck.getAttribute("aria-pressed")) === "true") return;
  const details = page.locator(".ps-check-details, .ps-review-run-data");
  await details.waitFor({ state: "visible", timeout: 60_000 });
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
