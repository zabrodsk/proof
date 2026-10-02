import { test, expect } from "@playwright/test";
const essay =
  "Jane Smith\nIoanna Mavridou\n4G2 English\n14 January 2026\n\nThe trial included 218 adults.\nJohn was born on the Reservation.\n\nWorks Cited\nTest Author. Synthetic source.";
async function draft(request: any, text = essay) {
  const r = await request.post("/api/v1/documents", {
    data: { title: "E2E essay", text },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
for (const mode of ["source_check", "fact_check", "discover"] as const) {
  test(`${mode} checks body claims and leaves header intact`, async ({
    page,
    request,
  }) => {
    const doc = await draft(request);
    const sources = (await (await request.get("/api/v1/sources")).json()).items;
    const input = {
      documentVersionId: doc.documentVersionId,
      mode,
      selectedSources:
        mode === "source_check"
          ? [
              {
                assetId: sources.find(
                  (s: any) => s.metadata.title === "Synthetic source",
                ).id,
                extractionId: sources.find(
                  (s: any) => s.metadata.title === "Synthetic source",
                ).extraction_id,
                pageRanges: [],
              },
            ]
          : [],
      externalAccess: mode === "source_check" ? "none" : "research",
      sourcePolicy: mode === "source_check" ? "user_supplied" : "academic",
      allowProviderProcessing: true,
    };
    const r = await request.post("/api/v1/runs", {
      data: input,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(r.status()).toBe(202);
    const run = await r.json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/runs/${run.id}`)).json()).stage,
      )
      .toBe("done");
    const data = await (await request.get(`/api/v1/runs/${run.id}`)).json();
    expect(data.coverage.totalClaims).toBe(2);
    expect(data.coverage.skippedSpans).toHaveLength(4);
    const findings = await (
      await request.get(`/api/v1/runs/${run.id}/findings`)
    ).json();
    expect(findings.items).toHaveLength(2);
    expect(
      findings.items.every(
        (f: any) =>
          !f.claim.text.includes("Jane Smith") &&
          !f.claim.text.includes("English"),
      ),
    ).toBe(true);
    await page.goto(`/app/works/${doc.id}`);
    if (mode !== "source_check")
      await page
        .getByRole("button", {
          name: mode === "fact_check" ? "Research" : "Find sources",
          exact: true,
        })
        .click();
    await expect(
      page.getByRole("textbox", { name: "Document text" }),
    ).toHaveValue(essay);
    await expect(
      page.getByText("4 text segments skipped.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name:
          mode === "source_check"
            ? "My sources"
            : mode === "fact_check"
              ? "Research"
              : "Find sources",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: `output/proof-audit/${test.info().project.name}-${mode}.png`,
      fullPage: true,
    });
  });
}

test("user can start a source check with consent and see only claim cards", async ({
  page,
  request,
}) => {
  const doc = await draft(request);
  await page.goto(`/app/works/${doc.id}`);
  await page
    .getByRole("checkbox", { name: "Synthetic source", exact: false })
    .check();
  await page
    .getByRole("checkbox", {
      name: "Allow AI providers to process my text",
      exact: false,
    })
    .check();
  await page
    .getByRole("button", { name: "Check my text", exact: true })
    .click();
  await expect(
    page.getByText("4 text segments skipped.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".ps-changes > li")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(essay);
});

test("metadata-only document shows no candidate claims, never verified", async ({
  page,
  request,
}) => {
  const doc = await draft(request, "Jane Smith\n4G2 English\n14 January 2026");
  const sources = (await (await request.get("/api/v1/sources")).json()).items;
  const r = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: doc.documentVersionId,
      mode: "source_check",
      selectedSources: [
        {
          assetId: sources.find(
            (s: any) => s.metadata.title === "Synthetic source",
          ).id,
          extractionId: sources.find(
            (s: any) => s.metadata.title === "Synthetic source",
          ).extraction_id,
          pageRanges: [],
        },
      ],
    },
  });
  expect(r.status()).toBe(202);
  const run = await r.json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/runs/${run.id}`)).json()).status,
    )
    .toBe("complete");
  await page.goto(`/app/works/${doc.id}`);
  await expect(
    page.getByText("No candidate claims found.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("3 text segments skipped.", { exact: false }),
  ).toBeVisible();
});

test("discovery API skips metadata and returns exact claim locations", async ({
  request,
}) => {
  const r = await request.post("/api/discovery/claims", {
    data: { text: essay },
  });
  expect(r.status()).toBe(200);
  const data = await r.json();
  expect(data.sentences).toHaveLength(2);
  expect(data.skipped).toHaveLength(4);
  for (const c of data.sentences)
    expect(essay.slice(c.start, c.end)).toBe(c.text);
});

test("consent is required before a user can start a source check", async ({
  page,
  request,
}) => {
  const doc = await draft(request);
  await page.goto(`/app/works/${doc.id}`);
  const start = page.getByRole("button", {
    name: "Check my text",
    exact: true,
  });
  await expect(start).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Synthetic source", exact: false })
    .check();
  await expect(start).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await expect(start).toBeEnabled();
});

test("real file imports preserve accents and reject a disguised PDF", async ({
  request,
}) => {
  const { readFile } = await import("node:fs/promises");
  for (const ext of ["pdf", "docx"]) {
    const r = await request.post("/api/documents/import", {
      multipart: {
        file: {
          name: `Essay_Dušan Zábrodský.${ext}`,
          mimeType:
            ext === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: await readFile(`tests/fixtures/research.${ext}`),
        },
      },
    });
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(data.title).toBe("Essay_Dušan Zábrodský");
    expect(data.text).toContain("218 trials");
  }
  const invalid = await request.post("/api/documents/import", {
    multipart: {
      file: {
        name: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a PDF"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
});

test("claim budgets exclude headers and report the unchecked remainder", async ({
  request,
}) => {
  const text =
    "Jane Smith\n4G2 English\n14 January 2026\n" +
    Array.from({ length: 12 }, () => "The trial included 218 adults.").join(
      "\n",
    );
  const doc = await draft(request, text);
  const s = (await (await request.get("/api/v1/sources")).json()).items.find(
    (s: any) => s.metadata.title === "Synthetic source",
  );
  const key = crypto.randomUUID();
  const input = {
    documentVersionId: doc.documentVersionId,
    mode: "source_check",
    selectedSources: [
      { assetId: s.id, extractionId: s.extraction_id, pageRanges: [] },
    ],
    budgetPreset: "small",
    allowProviderProcessing: false,
  };
  const create = () =>
    request.post("/api/v1/runs", {
      data: input,
      headers: { "Idempotency-Key": key },
    });
  const first = await create();
  expect(first.status()).toBe(202);
  const run = await first.json();
  expect((await (await create()).json()).id).toBe(run.id);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/runs/${run.id}`)).json()).stage,
    )
    .toBe("done");
  const data = await (await request.get(`/api/v1/runs/${run.id}`)).json();
  expect(data.coverage.totalClaims).toBe(12);
  expect(data.coverage.selectedClaims).toBe(10);
  expect(data.coverage.skippedSpans).toHaveLength(3);
  expect(data.coverage.unprocessedSpans).toHaveLength(2);
  expect(data.status).toBe("partial");
  expect(data.usage).toHaveLength(0);
});

test("invalid selected locations are rejected before a run starts", async ({
  request,
}) => {
  const doc = await draft(request);
  const s = (await (await request.get("/api/v1/sources")).json()).items.find(
    (s: any) => s.metadata.title === "Synthetic source",
  );
  const r = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: doc.documentVersionId,
      mode: "source_check",
      selectedSources: [
        { assetId: s.id, extractionId: s.extraction_id, pageRanges: [] },
      ],
      claimSpans: [{ start: 0, end: essay.length + 1 }],
    },
  });
  expect(r.status()).toBe(400);
});
