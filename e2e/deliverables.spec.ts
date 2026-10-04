import { enableAiProcessing } from "./work-pages";
import {
  showCheckDetails,
  openClaims,
  openReview,
  showSources,
} from "./work-pages";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function draft(request: APIRequestContext, text: string) {
  const r = await request.post("/api/v1/documents", {
    data: { title: "Acceptance draft", text },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function consent(page: any) {
  await enableAiProcessing(page);
}
async function selectSource(page: any) {
  await showSources(page);
  await showSources(page);
  await expect(
    page.locator(".ps-setup-source").filter({ hasText: "Synthetic source" }),
  ).toBeVisible();
}
test("claim preview controls the actual checked spans and skips a punctuated name", async ({
  page,
  request,
}) => {
  const text =
    "Jane Smith.\nI prefer this ending.\nThe trial included 218 adults.\nParis is the capital of France.";
  const doc = await draft(request, text);
  await page.goto(`/app/works/${doc.id}`);
  await openClaims(page);
  const preview = page.locator(".ps-claims-page");
  await expect(
    preview.getByRole("checkbox", { name: "The trial included", exact: false }),
  ).toBeChecked();
  await preview
    .getByRole("checkbox", { name: "Paris is", exact: false })
    .uncheck();
  await openReview(page);
  await selectSource(page);
  await consent(page);
  await page.locator(".ps-setup-start").click();
  await showCheckDetails(page);
  await expect(
    page.getByText("1 of 1 selected claims checked.", { exact: false }),
  ).toBeVisible();
  const runs = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items;
  expect(runs[0].input.claimSpans).toEqual([
    { start: text.indexOf("The trial"), end: text.indexOf("\nParis") },
  ]);
  expect(runs[0].coverage.excludedSpans).toHaveLength(1);
  expect(runs[0].coverage.skippedSpans).toHaveLength(2);
});
test("numeric correction has exact evidence, changes only the approved claim, and survives reopening", async ({
  page,
  request,
}) => {
  const text =
    "Jane Smith.\nThe trial included 120 adults.\nParis is the capital of France.";
  const doc = await draft(request, text);
  await page.goto(`/app/works/${doc.id}`);
  await selectSource(page);
  await consent(page);
  await page.locator(".ps-setup-start").click();
  const card = page
    .locator(".ps-citation-issue")
    .filter({ hasText: "120 adults" });
  await card.locator(".ps-citation-issue-toggle").click();
  await expect(
    card.getByRole("button", { name: "Apply wording correction", exact: true }),
  ).toBeEnabled();
  await card.getByText("Evidence and source details", { exact: true }).click();
  await expect(card.locator(".ps-change-passage blockquote")).toContainText(
    "The trial included 218 adults.",
  );
  await expect(
    card.getByText("Citation page unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  const before = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  const findings = (
    await (await request.get(`/api/v1/runs/${before.id}/findings`)).json()
  ).items;
  const numeric = findings.find((f: any) => f.fix);
  expect(numeric.fix.replacement).toBe("The trial included 218 adults.");
  const passage = await (
    await request.get(`/api/v1/passages/${numeric.evidence[0].id}`)
  ).json();
  expect(passage.text).toBe(numeric.evidence[0].text);
  await card
    .getByRole("button", { name: "Apply wording correction", exact: true })
    .click();
  const updated = text.replace("120", "218");
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(updated);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(updated);
  const stale = await request.post(`/api/v1/documents/${doc.id}/apply-fix`, {
    data: {
      approved: true,
      documentVersionId: doc.documentVersionId,
      findingId: numeric.id,
    },
  });
  expect(stale.status()).toBe(409);
  expect(
    (await (await request.get(`/api/v1/runs/${before.id}`)).json()).invalidated,
  ).toBe(true);
});
test("research exposes inaccessible and retracted candidates, recorded usage, and shared search counts", async ({
  page,
  request,
}) => {
  const text =
    "Tutoring improves adult reading scores. Tutoring does not improve adult reading scores.";
  const doc = await draft(request, text);
  await page.goto(`/app/works/${doc.id}`);
  await page
    .getByRole("group", { name: "Check type" })
    .getByRole("button", { name: "Fact-check", exact: true })
    .click();
  await consent(page);
  await page.locator(".ps-setup-start").click();
  await showCheckDetails(page);
  await expect(
    page.getByText("2 of 2 selected claims checked.", { exact: false }),
  ).toBeVisible();
  await page
    .getByText("Retrieved sources and access gaps", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Unavailable test paper" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Retracted test paper" }),
  ).toBeVisible();
  await page.getByText(/API usage ·/).click();
  const run = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  const result = await (await request.get(`/api/v1/runs/${run.id}`)).json();
  const searchCalls = result.usage
    .filter((u: any) => u.provider === "exa")
    .reduce((n: number, u: any) => n + u.requests, 0);
  // A cold run shares the relevance and conflict queries across both claims.
  // Later browser projects may legitimately reuse those scoped search results.
  expect([0, 2]).toContain(searchCalls);
  const research = (
    await (await request.get(`/api/v1/runs/${run.id}/research`)).json()
  ).items;
  if (searchCalls === 0)
    expect(
      research.some((item: any) =>
        item.notices.some((notice: string) =>
          notice.includes(
            "Recent search results were reused within this workspace and source scope",
          ),
        ),
      ),
    ).toBe(true);
  const outbound = (
    await (await request.get(`/__e2e/provider-requests?runId=${run.id}`)).json()
  ).items.filter((item: any) => item.url.includes("api.exa.ai/search"));
  expect(outbound).toHaveLength(searchCalls);
  expect(result.coverage.completedClaims).toBe(2);
  const findings = (
    await (await request.get(`/api/v1/runs/${run.id}/findings`)).json()
  ).items;
  expect(findings.every((f: any) => f.support !== "supported")).toBe(true);
});
test("a supplied source that covers a public claim prevents all external searches", async ({
  page,
  request,
}) => {
  const doc = await draft(request, "Paris is the capital of France.");
  await page.goto(`/app/works/${doc.id}`);
  await page
    .getByRole("group", { name: "Check type" })
    .getByRole("button", { name: "Fact-check", exact: true })
    .click();
  await selectSource(page);
  await consent(page);
  await page.locator(".ps-setup-start").click();
  await showCheckDetails(page);
  await expect(
    page.getByText("1 of 1 selected claims checked.", { exact: false }),
  ).toBeVisible();
  const run = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  const result = await (await request.get(`/api/v1/runs/${run.id}`)).json();
  expect(result.usage.some((u: any) => u.provider === "exa")).toBe(false);
  expect(
    result.usage
      .filter((u: any) => u.provider === "jev")
      .reduce((n: number, u: any) => n + u.requests, 0),
  ).toBe(1);
  await page.getByRole("button", { name: "Supported 1", exact: true }).click();
  await expect(page.locator(".ps-changes > li")).toHaveCount(1);
});
test("starting a check waits for delayed autosave and uses the new version", async ({
  page,
  request,
}) => {
  const doc = await draft(request, "The trial included 218 adults.");
  await page.goto(`/app/works/${doc.id}`);
  await selectSource(page);
  await consent(page);
  await page.route(`**/api/v1/documents/${doc.id}/versions`, async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  const text = "The trial included 120 adults.";
  await page.getByRole("textbox", { name: "Document text" }).fill(text);
  const start = page.locator(".ps-setup-start");
  await expect(start).toBeDisabled();
  await page.getByRole("textbox", { name: "Document text" }).blur();
  await expect(start).toBeEnabled();
  await start.click();
  await page.locator(".ps-citation-issue-toggle").first().click();
  await expect(
    page.getByRole("button", { name: "Apply wording correction", exact: true }),
  ).toBeVisible();
  const run = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  expect(run.document_version_id).not.toBe(doc.documentVersionId);
  expect(
    (await (await request.get(`/api/v1/runs/${run.id}/findings`)).json())
      .items[0].claim.text,
  ).toBe(text);
});
for (const ext of ["pdf", "docx", "txt", "md"])
  test(`UI imports ${ext}, preserves its name, and reopens saved text`, async ({
    page,
    isMobile,
  }) => {
    await page.goto("/app");
    if (isMobile)
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Add new work", exact: true })
      .first()
      .click();
    const buffer = ["pdf", "docx"].includes(ext)
      ? await readFile(`tests/fixtures/research.${ext}`)
      : Buffer.from("Jane Smith.\nThe trial included 218 adults.");
    await page.locator('.ps-new-work input[type="file"]').setInputFiles({
      name: `Résumé.${ext}`,
      mimeType:
        ext === "pdf"
          ? "application/pdf"
          : ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "text/plain",
      buffer,
    });
    await expect(page.getByRole("textbox", { name: "Work title" })).toHaveValue(
      "Résumé",
    );
    const expected = await page
      .getByRole("textbox", { name: "Review the extracted text" })
      .inputValue();
    expect(expected).toContain("218");
    await page
      .getByRole("button", { name: "Create work", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Document text" }),
    ).toHaveValue(expected);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Document text" }),
    ).toHaveValue(expected);
  });
test("MLA bibliography preserves formatting and warnings after reopening", async ({
  page,
  request,
}) => {
  const doc = await draft(request, "The trial included 218 adults.");
  await page.goto(`/app/works/${doc.id}/citations`);
  await page
    .getByRole("textbox", { name: "Bibliography" })
    .fill(
      'Huxley, Aldous. Brave New World. 1932.\nTest Author. "Synthetic source." 2026.',
    );
  await page
    .getByRole("button", { name: "Format bibliography", exact: true })
    .click();
  await expect(page.locator(".ps-analysis-reference-text")).toHaveCount(2);
  const citations = await page
    .locator(".ps-analysis-reference-text")
    .allTextContents();
  expect(citations.join(" ")).toContain("Huxley");
  expect(citations.join(" ")).toContain("Brave New World");
  await expect(page.locator(".ps-analysis-warning").first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".ps-analysis-reference-text")).toHaveCount(2);
  expect(
    await page.locator(".ps-analysis-reference-text").allTextContents(),
  ).toEqual(citations);
});

test("uploaded PDF exposes unreadable pages and honest physical locators after reopening", async ({
  page,
  request,
}) => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("The trial included 218 adults.", {
    x: 40,
    y: 700,
    font,
    size: 14,
  });
  pdf.addPage();
  const sourceName = `Partial ${test.info().project.name} source.pdf`;
  const doc = await draft(request, "The trial included 120 adults.");
  await page.goto(`/app/works/${doc.id}`);
  await page.locator('.ps-setup-upload input[type="file"]').setInputFiles({
    name: sourceName,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(
    page.getByRole("checkbox", {
      name: `${sourceName} Some pages could not be read`,
      exact: true,
    }),
  ).toBeEnabled();
  await consent(page);
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByText("Source extraction gaps", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unreadable physical pages: 2.", { exact: false }),
  ).toBeVisible();
  await page.locator(".ps-change-head").click();
  await expect(
    page.getByText("Physical page 1. Printed page unconfirmed", {
      exact: false,
    }),
  ).toBeVisible();
  const run = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items[0];
  expect(run.status).toBe("partial");
  expect(run.coverage.sources[0].unreadablePages).toEqual([2]);
  await page.reload();
  await expect(
    page.getByText("Unreadable physical pages: 2.", { exact: false }),
  ).toBeVisible();
});

test("mobile drawer removes closed controls from navigation and restores them when opened", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is used on mobile.");
  await page.goto("/app");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Close menu", exact: true })
    .click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});
