import { test, expect } from "@playwright/test";
import { openClaims, openReview, showSources } from "./work-pages";

test("Claims explains general facts, evidence claims and uncertain classifications", async ({
  page,
  request,
}, testInfo) => {
  const text =
    "The capital of France is Paris.\n\nA triangle has three sides.\n\nArtificial intelligence is becoming increasingly common in education.\n\nSocial media can cause anxiety.\n\nDemocracy allows citizens to vote.";
  const doc = await (
    await request.post("/api/v1/documents", {
      data: { title: "Citation classification", text },
    })
  ).json();
  await page.goto(`/app/works/${doc.id}`);
  await openClaims(page);
  const rows = page.locator(".ps-claim-result-row");
  const paris = rows.filter({ hasText: "The capital of France" });
  const geometry = rows.filter({ hasText: "A triangle" });
  for (const row of [paris, geometry]) {
    await expect(row).toContainText("General fact · No citation needed");
    await expect(row.getByRole("combobox")).toHaveValue("common_knowledge");
  }
  const trend = rows.filter({ hasText: "Artificial intelligence" });
  const causal = rows.filter({ hasText: "Social media" });
  for (const row of [trend, causal]) {
    await expect(row).toContainText("Evidence needed");
    await expect(row.getByRole("combobox")).toHaveValue("required");
    await expect(
      row.getByRole("option", {
        name: "Common knowledge, no citation",
        exact: true,
      }),
    ).toHaveJSProperty("disabled", true);
    const explanationId = await row
      .getByRole("combobox")
      .getAttribute("aria-describedby");
    await expect(row.locator(`[id="${explanationId}"]`)).toContainText(
      "Evidence needed",
    );
  }
  await expect(trend).toContainText("trend");
  await expect(causal).toContainText("cause, effect or association");
  const uncertain = rows.filter({ hasText: "Democracy allows" });
  await expect(uncertain).toContainText("Review classification");
  await page.screenshot({
    path: `output/citation-classification/${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await uncertain.getByRole("combobox").selectOption("common_knowledge");
  await expect(uncertain).toContainText("You marked this as common knowledge");
  await paris.getByRole("combobox").selectOption("required");
  await expect(paris).toContainText("You chose to require a citation");
  await page.getByRole("button", { name: "General fact", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page
    .getByRole("button", { name: "Need Citation", exact: true })
    .click();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "All claims", exact: true }).click();
  await openReview(page);
  await page
    .getByRole("group", { name: "Check type" })
    .getByRole("button", { name: "Generate citations", exact: true })
    .click();
  await showSources(page);
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Citable source" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  const outbound = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/runs",
  );
  await page.locator(".ps-setup-start").click();
  const input = (await outbound).postDataJSON();
  expect(
    input.claimSpans.find((span: any) => span.start === 0).citationRequirement,
  ).toBe("required");
  expect(
    input.claimSpans.find(
      (span: any) => span.start === text.indexOf("Democracy"),
    ).citationRequirement,
  ).toBe("common_knowledge");
});
