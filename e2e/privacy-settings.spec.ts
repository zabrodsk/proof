import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  reducedMotion: "reduce",
});

async function createDraft(request: APIRequestContext) {
  return await (
    await request.post("/api/v1/documents", {
      data: {
        title: "Privacy choices",
        text: "The trial included 218 adults.",
      },
    })
  ).json();
}

async function choosePrivacy(page: Page, ai = true, retrieval = true) {
  await expect(
    page.getByRole("heading", { name: "Choose how Proof processes your work" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: /^Allow AI processing/ })
    .setChecked(ai);
  await page
    .getByRole("checkbox", { name: /^Retrieve cited works/ })
    .setChecked(retrieval);
  await page.getByRole("button", { name: "Save choices and continue" }).click();
}

test("first-use privacy choices start unchecked and persist across reloads", async ({
  page,
  request,
}) => {
  const doc = await createDraft(request);
  await page.goto(`/app/works/${doc.id}`);
  await expect(
    page.getByRole("checkbox", { name: /^Allow AI processing/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Retrieve cited works/ }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `output/privacy-settings/${test.info().project.name}-welcome.png`,
    fullPage: true,
  });
  await choosePrivacy(page);
  await expect(page.locator(".ps-setup-processing")).toContainText(
    "AI processing enabled",
  );
  await expect(page.locator(".ps-setup-processing")).toContainText(
    "Cited-work retrieval enabled",
  );
  await expect(
    page.getByRole("checkbox", { name: /Allow AI providers/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Retrieve cited works for this check" }),
  ).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Choose how Proof processes your work" }),
  ).toHaveCount(0);
  await expect(page.locator(".ps-setup-start")).toBeEnabled();
});

test("declining AI processing keeps drafts usable and new checks disabled", async ({
  page,
  request,
}) => {
  const doc = await createDraft(request);
  await page.goto(`/app/works/${doc.id}`);
  await choosePrivacy(page, false, false);
  await expect(page.getByLabel("Document text")).toBeEditable();
  await expect(page.locator(".ps-setup-start")).toBeDisabled();
  await expect(page.locator("#studio-start-reason")).toContainText(
    "Enable AI processing",
  );
  await page
    .getByRole("button", { name: "Change privacy and processing settings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Privacy & processing" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /^Allow AI processing/ }).check();
  await page.goto(`/app/works/${doc.id}`);
  await expect(page.locator(".ps-setup-start")).toBeEnabled();
  const outbound = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/runs",
  );
  await page.locator(".ps-setup-start").click();
  expect((await outbound).postDataJSON()).toMatchObject({
    allowProviderProcessing: true,
    externalAccess: "none",
  });
});

test("settings apply across works while retrieval overrides stay in check setup", async ({
  page,
  request,
}) => {
  const doc = await createDraft(request);
  await page.goto(`/app/works/${doc.id}`);
  await choosePrivacy(page);
  await page
    .locator("summary")
    .filter({ hasText: /^More options$/ })
    .click();
  await page
    .getByRole("checkbox", { name: "Retrieve cited works for this check" })
    .uncheck();
  await expect(page.locator(".ps-setup-processing")).toContainText(
    "Cited-work retrieval disabled",
  );
  await page
    .getByRole("button", { name: "Change privacy and processing settings" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /^Retrieve cited works/ }),
  ).toBeChecked();
  await page.screenshot({
    path: `output/privacy-settings/${test.info().project.name}-settings.png`,
    fullPage: true,
  });
  await page.getByRole("checkbox", { name: /^Retrieve cited works/ }).uncheck();
  await page.getByRole("checkbox", { name: /^Allow AI processing/ }).uncheck();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: /^Allow AI processing/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Retrieve cited works/ }),
  ).not.toBeChecked();
  const other = await createDraft(request);
  await page.goto(`/app/works/${other.id}`);
  await expect(page.locator(".ps-setup-processing")).toContainText(
    "AI processing disabled",
  );
  await expect(page.locator(".ps-setup-processing")).toContainText(
    "Cited-work retrieval disabled",
  );
  await expect(page.locator(".ps-setup-start")).toBeDisabled();
  await page
    .locator("summary")
    .filter({ hasText: /^More options$/ })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Retrieve cited works for this check" }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `output/privacy-settings/${test.info().project.name}-setup.png`,
    fullPage: true,
  });
});
