import { test, expect } from "@playwright/test";

test("Sparrow narrative citation resolves to a paper card verified from its abstract", async ({
  page,
  request,
}) => {
  const source = await (await request.post("/__e2e/sparrow-abstract")).json();
  const sentence =
    "Sparrow, Liu, and Wegner (2011) found that when people expected information to remain accessible later, they showed lower recall for the information itself while remembering more about where it could be found.";
  const text = `${sentence}\n\nReferences\nSparrow, B., Liu, J., & Wegner, D. M. (2011). Google effects on memory: Cognitive consequences of having information at our fingertips. Science, 333(6043), 776–778. https://doi.org/10.1126/science.1207745`;
  const response = await request.post("/api/v1/documents", {
    data: { title: "Narrative citation regression", text },
  });
  expect(response.status()).toBe(201);
  const document = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/documents/${document.id}/bibliography`)
          ).json()
        ).item?.status,
    )
    .toBe("complete");
  const started = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: document.documentVersionId,
      mode: "source_check",
      allowProviderProcessing: true,
      selectedSources: [
        {
          assetId: source.id,
          extractionId: source.extractionId,
          pageRanges: [],
        },
      ],
    },
  });
  expect(started.status(), await started.text()).toBe(202);
  const run = await started.json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/runs/${run.id}`)).json()).stage,
    )
    .toBe("done");
  await page.goto(`/app/works/${document.id}`);
  await page.getByText("Checked citations", { exact: true }).click();
  const card = page
    .locator(".ps-citation-issue-detail")
    .filter({ hasText: "Verified from abstract" });
  await expect(card).toContainText("Supported");
  await expect(card).toContainText("Google effects on memory");
  await expect(card).toContainText(
    "Betsy Sparrow, Jenny Liu, Daniel M. Wegner · 2011 · Science",
  );
  await expect(card.locator("blockquote")).toContainText(
    "lower rates of recall",
  );
  await expect(
    card.getByRole("button", { name: "Open source", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Locate in draft", exact: true })
    .click();
  await expect(page.locator(".ps-locate-focus").first()).toContainText(
    sentence,
  );
  await expect(
    page.getByText("Source text unavailable", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `output/playwright/${test.info().project.name}-sparrow-abstract.png`,
    fullPage: true,
  });
});
