import { openClaims, openReview, showSources } from "./work-pages";
import { test, expect } from "@playwright/test";
import { documentCorpus } from "../tests/fixtures/document-corpus.js";

for (const sample of documentCorpus) {
  test(`${sample.id}: review, source check, exact coverage, export and reopen`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const response = await request.post("/api/v1/documents", {
      data: { title: sample.title, text: sample.text },
    });
    expect(response.status()).toBe(201);
    const doc = await response.json();
    const expectedCount = sample.claimCount;
    await page.goto(`/app/works/${doc.id}`);
    await openClaims(page);
    const preview = page.locator(".ps-claims-page");
    await expect(preview.locator(".ps-claims-heading")).toContainText(
      `${expectedCount} selected`,
    );
    const search = page.getByRole("searchbox", { name: "Find a claim" });
    await search.fill("The trial included");
    await expect(preview.locator(".ps-claims-heading")).toContainText(
      `${expectedCount} selected`,
    );
    await expect(
      preview
        .locator(".ps-claim-option")
        .filter({ hasText: "The trial included" }),
    ).toHaveCount((sample.text.match(/The trial included/g) || []).length);
    await search.clear();
    await openReview(page);
    await showSources(page);
    await showSources(page);
    await expect(
      page.locator(".ps-setup-source").filter({ hasText: "Citable source" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Allow AI providers", exact: false })
      .check();
    await page.locator(".ps-setup-start").click();
    await expect(
      page.getByText(
        `${expectedCount} of ${expectedCount} selected claims checked.`,
        { exact: false },
      ),
    ).toBeVisible({ timeout: 60_000 });
    const run = (
      await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
    ).items[0];
    expect(run.input.checkScope).toBe("cited_first_then_selected_library");
    const findings = (
      await (
        await request.get(`/api/v1/runs/${run.id}/findings?limit=100`)
      ).json()
    ).items;
    expect(findings).toHaveLength(expectedCount);
    for (const f of findings) {
      expect(sample.text.slice(f.claim.start, f.claim.end)).toBe(f.claim.text);
      expect(f.processing).toBe("complete");
      expect(
        f.evidence.length > 0 || f.evidenceGap || f.citation === "not_required",
      ).toBeTruthy();
    }
    const right = findings.find(
      (f: any) => f.claim.text === "The trial included 218 adults (Brown 21).",
    );
    expect(right?.citation).toBe("correct");
    const wrong = findings.find(
      (f: any) => f.claim.text === "The trial included 218 adults (Brown 22).",
    );
    if (wrong) {
      expect(wrong.citation).toBe("wrong_locator");
      await expect(
        page.getByText("Wrong citation page", { exact: true }),
      ).toBeVisible();
    }
    const quoted = findings.find(
      (f: any) => f.claim.text === "The Earth is a planet.",
    );
    if (quoted) expect(quoted.citation).not.toBe("not_required");
    const qualified = findings.find((f: any) =>
      f.claim.text.includes("population doubled"),
    );
    if (qualified) {
      expect(qualified.citation).not.toBe("not_required");
      expect(qualified.support).toBe("not_verified");
    }
    const citationAudit = await (
      await request.get(`/api/v1/runs/${run.id}/citation-plan`)
    ).json();
    expect(
      citationAudit.audit.occurrences.some((item: any) =>
        item.text.includes("population doubled"),
      ),
    ).toBe(false);
    const calls = (
      await (
        await request.get(`/__e2e/provider-requests?runId=${run.id}`)
      ).json()
    ).items;
    expect(calls.some((c: any) => c.url.includes("api.exa.ai"))).toBe(false);
    await expect(
      page.getByRole("textbox", { name: "Document text", exact: true }),
    ).toHaveValue(sample.text);
    const exported = await request.get(
      `/api/v1/documents/${doc.id}/export?format=text`,
    );
    expect(await exported.text()).toBe(sample.text);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Document text", exact: true }),
    ).toHaveValue(sample.text);
    await test.info().attach("corpus-summary", {
      body: JSON.stringify(
        {
          document: sample.id,
          words: sample.text.split(/\s+/).length,
          claims: expectedCount,
          skipped: run.coverage.skippedSpans.length,
          calls: calls.length,
          findings: findings.map((f: any) => ({
            text: f.claim.text,
            support: f.support,
            citation: f.citation,
            gap: f.evidenceGap,
          })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await page.screenshot({
      path: `output/task-audit/${test.info().project.name}-${sample.id}.png`,
      fullPage: true,
    });
  });
}

test("partial citation approval keeps the remaining gap after reopening", async ({
  page,
  request,
}) => {
  const text =
    "The trial included 218 adults.\n\nThe trial included 218 adults.";
  const doc = await (
    await request.post("/api/v1/documents", {
      data: { title: "Selective approval", text },
    })
  ).json();
  await page.goto(`/app/works/${doc.id}`);
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
  await page.locator(".ps-setup-start").click();
  const review = page.getByRole("region", {
    name: "Citation proposals",
    exact: true,
  });
  await expect(review.locator(".ps-citation-operation input")).toHaveCount(2);
  await review.locator(".ps-citation-operation input").last().uncheck();
  await expect(review).toContainText("1 of 2 changes selected.");
  await review
    .getByRole("button", { name: "Apply selected citations", exact: true })
    .click();
  await expect(review).toContainText("1 left for review");
  await expect(review).toContainText("This citation change was not applied.");
  await page.reload();
  await expect(review).toContainText("1 left for review");
  const saved = await page
    .getByRole("textbox", { name: "Document text", exact: true })
    .inputValue();
  expect(saved.match(/\(Brown 21\)/g)).toHaveLength(1);
  expect(saved).toContain("\n\nThe trial included 218 adults.\n\nWorks Cited");
});
