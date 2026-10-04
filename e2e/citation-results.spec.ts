import { test, expect, type APIRequestContext } from "@playwright/test";

async function checkedDraft(
  request: APIRequestContext,
  text: string,
  mode: "source_check" | "discover",
) {
  const created = await request.post("/api/v1/documents", {
    data: { title: "Citation review layout", text },
  });
  expect(created.status()).toBe(201);
  const document = await created.json();
  if (/^\s*(?:Works Cited|References|Bibliography)\s*$/im.test(text))
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
  const sources = (await (await request.get("/api/v1/sources")).json()).items;
  const source = sources.find(
    (item: any) =>
      item.metadata.title === "Citable source" &&
      item.extraction_id &&
      item.status === "ready",
  );
  const started = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: document.documentVersionId,
      mode,
      citationOutput: mode === "discover" ? "generate" : "audit",
      citationProfile: "mla9",
      sourcePolicy: mode === "discover" ? "public" : "user_supplied",
      externalAccess: mode === "discover" ? "research" : "none",
      allowProviderProcessing: true,
      selectedSources: [
        {
          assetId: source.id,
          extractionId: source.extraction_id,
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
  const planResponse = await request.get(
    `/api/v1/runs/${run.id}/citation-plan`,
  );
  expect(planResponse.status()).toBe(200);
  return { document, plan: await planResponse.json() };
}

test("citation results retain all three modes and keep operational details out of the issue queue", async ({
  page,
  request,
}) => {
  const { document } = await checkedDraft(
    request,
    "The trial included 218 adults (Missing 4).\n\nWorks Cited\n\nBrown, Maria. Citable source. Test Press, 2025.",
    "source_check",
  );
  await page.goto(`/app/works/${document.id}`);
  const modes = page.getByRole("group", { name: "Check type" });
  for (const name of ["Check citations", "Generate citations", "Fact-check"])
    await expect(
      modes.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Issues/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Changes/ })).toBeVisible();
  const coverage = page.getByText("selected claims checked.", { exact: false });
  await expect(coverage).toHaveCount(0);
  await expect(page.getByText("Check details", { exact: true })).toHaveCount(0);
  const citationIssues = page.getByRole("region", {
    name: "In-text citation issues",
  });
  const worksCitedIssues = page.getByRole("region", {
    name: "Works Cited issues",
  });
  await expect(citationIssues).toBeVisible();
  await expect(worksCitedIssues).toBeVisible();
  const inTextToggle = citationIssues.getByRole("button", {
    name: /^In-text citations/,
  });
  const worksCitedToggle = worksCitedIssues.getByRole("button", {
    name: /^Works Cited/,
  });
  await inTextToggle.click();
  await expect(inTextToggle).toHaveAttribute("aria-expanded", "false");
  await expect(citationIssues.locator(".ps-citation-issue")).toBeHidden();
  await worksCitedToggle.click();
  await expect(worksCitedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(worksCitedIssues.locator(".ps-citation-issue")).toBeHidden();
  await inTextToggle.click();
  await expect(inTextToggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    citationIssues.locator(".ps-citation-issue").first(),
  ).toBeVisible();
  await page.locator(".ps-citation-issue-toggle").first().click();
  await expect(page.locator(".ps-citation-issue")).not.toHaveCount(0);
  await page.screenshot({
    path: `output/citation-results/${test.info().project.name}-issues.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Locate in draft" }).click();
  const documentEditor = page.getByLabel("Document text");
  const locatedRange = page.locator(".ps-locate-focus");
  await expect(documentEditor).toBeFocused();
  await expect(locatedRange.first()).toBeVisible();
  await expect(locatedRange.first()).toBeInViewport();
  const highlightedText = (await locatedRange.allTextContents()).join("");
  expect(highlightedText).toBe("The trial included 218 adults (Missing 4).");
  const selection = await documentEditor.evaluate((el: HTMLTextAreaElement) => [
    el.selectionStart,
    el.selectionEnd,
  ]);
  expect(selection[0]).toBe(0);
  expect(selection[0]).toBe(selection[1]);
});

test("citation selections survive tab switches and save only deliberately selected operations", async ({
  page,
  request,
}) => {
  const text =
    "The trial included 218 adults.\n\nThe trial included 218 adults.";
  const { document, plan } = await checkedDraft(request, text, "discover");
  expect(plan.operations).toHaveLength(2);
  await page.goto(`/app/works/${document.id}`);
  await expect(page.locator(".ps-check-details > summary")).toHaveText(
    "Check details",
  );
  await page.getByRole("tab", { name: /^Changes/ }).click();
  const changes = page.getByRole("region", {
    name: "Citation proposals",
    exact: true,
  });
  const boxes = changes.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first()).not.toBeChecked();
  await expect(changes.getByRole("button", { name: /^Apply/ })).toBeDisabled();
  await changes.getByRole("button", { name: "Select all" }).click();
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await changes.getByRole("button", { name: "Deselect all" }).click();
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await boxes.first().check();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect(boxes.first()).toBeChecked();
  await expect(boxes.last()).not.toBeChecked();
  const body = await changes.locator(".ps-plan-scroll").boundingBox();
  const footer = await changes.locator(".ps-plan-footer").boundingBox();
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y + 1);
  await page.screenshot({
    path: `output/citation-results/${test.info().project.name}-changes.png`,
    fullPage: true,
  });
  await changes
    .getByRole("button", { name: "Apply 1 selected change", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(/\(Brown 21\)/);
  const saved = await (await request.get("/api/v1/documents")).json();
  expect(
    saved.items
      .find((item: any) => item.id === document.id)
      .text.match(/\(Brown 21\)/g),
  ).toHaveLength(1);
  await page.screenshot({
    path: `output/citation-results/${test.info().project.name}-saved-changes.png`,
    fullPage: true,
  });
});

test("locating any repeated in-text citation highlights every occurrence", async ({
  page,
  request,
}) => {
  const text =
    "The trial included 218 adults (Missing 4).\n\nParticipants reported better sleep (Missing 4).\n\nThe follow-up confirmed the result (Missing 4).\n\nA separate study reported a different result (Other 8).";
  const { document } = await checkedDraft(request, text, "source_check");
  await page.goto(`/app/works/${document.id}/citations`);
  await page.getByRole("tab", { name: /^In-text citations/ }).click();
  const occurrences = page
    .locator(".ps-inventory-row")
    .filter({ hasText: "(Missing 4)" });
  await expect(occurrences).toHaveCount(3);
  await occurrences.last().click();
  await page.getByRole("button", { name: "Locate in draft" }).click();

  const documentEditor = page.getByLabel("Document text");
  const locatedRange = page.locator(".ps-locate-focus");
  await expect(documentEditor).toBeFocused();
  await expect(locatedRange).toHaveCount(3);
  await expect(locatedRange).toHaveText([
    "(Missing 4)",
    "(Missing 4)",
    "(Missing 4)",
  ]);
  await expect(locatedRange.first()).toBeVisible();
  await expect(locatedRange.first()).toBeInViewport();
  const selection = await documentEditor.evaluate(
    (el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
    }),
  );
  expect(selection.start).toBe(text.indexOf("(Missing 4)"));
  expect(selection.end).toBe(selection.start);

  await page
    .getByRole("button", { name: "Open Sources & citations", exact: true })
    .click();
  await page.getByRole("tab", { name: /^In-text citations/ }).click();
  await page
    .locator(".ps-inventory-row")
    .filter({ hasText: "(Other 8)" })
    .click();
  await page.getByRole("button", { name: "Locate in draft" }).click();
  await expect(locatedRange).toHaveCount(1);
  await expect(locatedRange).toHaveText("(Other 8)");
});

test("Works Cited formatting fixes update a saved document version and keep old audit locations disabled", async ({
  page,
  request,
}) => {
  const text =
    "The trial included 218 adults (Brown 21).\n\nWorks Cited\n\nBrown, Maria. Citable source. Evidence Journal, 2024. https://doi.org/10.1234/citable.";
  const { document, plan } = await checkedDraft(request, text, "source_check");
  await page.goto(`/app/works/${document.id}/citations`);
  await page.getByRole("tab", { name: /^Works Cited/ }).click();
  await page
    .getByRole("button", { name: /Brown, Maria/ })
    .first()
    .click();
  const formatted = plan.references[0].text;
  const pane = page.getByRole("complementary", {
    name: "Selected bibliography entry",
  });
  await expect(pane.locator(".ps-inventory-original")).toHaveText(
    "Brown, Maria. Citable source. Evidence Journal, 2024. https://doi.org/10.1234/citable.",
  );
  await expect(pane.locator(".ps-inventory-formatted")).toHaveText(formatted);
  await expect(pane.getByRole("textbox")).toHaveCount(0);
  await expect(
    pane.getByRole("button", { name: "Locate in draft" }),
  ).toBeEnabled();
  await expect(
    pane.getByRole("button", { name: "Open source", exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Copy citation" }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/citation-results/${test.info().project.name}-works-cited.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fix entry", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/documents")).json()).items.find(
          (item: any) => item.id === document.id,
        ).text,
    )
    .toBe(
      text.replace(
        "Brown, Maria. Citable source. Evidence Journal, 2024. https://doi.org/10.1234/citable.",
        formatted,
      ),
    );
  await expect(
    page.getByRole("button", { name: "Entry fixed", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ps-inventory-notice")).toBeVisible();
  await page.screenshot({
    path: `output/citation-results/${test.info().project.name}-saved-entry.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("inventory cannot overwrite a draft while its hidden editor is saving", async ({
  page,
  request,
}) => {
  const text =
    "The trial included 218 adults (Brown 21).\n\nWorks Cited\n\nBrown, Maria. Citable source. Evidence Journal, 2024. https://doi.org/10.1234/citable.";
  const { document } = await checkedDraft(request, text, "source_check");
  await page.goto(`/app/works/${document.id}`);
  let releaseSave: () => void = () => {};
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(
    `**/api/v1/documents/${document.id}/versions`,
    async (route) => {
      await heldSave;
      await route.continue();
    },
  );
  try {
    await page
      .getByRole("textbox", { name: "Document text" })
      .fill(text + "\n\nMy new paragraph.");
    await page
      .getByRole("button", { name: "Open Sources & citations", exact: true })
      .click();
    await page.getByRole("tab", { name: /^Works Cited/ }).click();
    await page
      .getByRole("button", { name: /Brown, Maria/ })
      .first()
      .click();
    await expect(page.locator(".ps-inventory-save:enabled")).toHaveCount(0);
  } finally {
    releaseSave();
  }
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/documents")).json()).items.find(
          (item: any) => item.id === document.id,
        ).text,
    )
    .toBe(text + "\n\nMy new paragraph.");
});
