import { test, expect } from "@playwright/test";

test("sources and every check mode stay within their work", async ({
  page,
  request,
}) => {
  const works = [];
  for (const title of ["First work", "Second work"]) {
    const created = await request.post("/api/v1/documents", {
      data: {
        title,
        text: "The trial included 218 adults.",
        fixtureSources: false,
      },
    });
    expect(created.status()).toBe(201);
    works.push(await created.json());
  }
  const first = works[0],
    second = works[1];
  const upload = await request.post("/api/v1/uploads", {
    data: {
      documentId: first.id,
      filename: "first-only.txt",
      mediaType: "text/plain",
      bytes: Buffer.byteLength("The trial included 218 adults."),
      metadata: { title: "First work source", authors: [], year: "2024" },
    },
  });
  expect(upload.status()).toBe(201);
  const intent = await upload.json();
  expect(
    (
      await request.put(intent.uploadUrl, {
        data: "The trial included 218 adults.",
        headers: intent.headers,
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.post(`/api/v1/uploads/${intent.id}/complete`)).status(),
  ).toBe(202);
  let source: any;
  await expect
    .poll(async () => {
      const list = await (
        await request.get(`/api/v1/sources?documentId=${first.id}`)
      ).json();
      source = list.items[0];
      return source?.status;
    })
    .toBe("ready");
  const otherSources = await (
    await request.get(`/api/v1/sources?documentId=${second.id}`)
  ).json();
  expect(otherSources.items).toEqual([]);
  await page.goto(`/app/works/${first.id}/citations`);
  await expect(
    page.getByRole("tabpanel").getByText("First work source", { exact: true }),
  ).toBeVisible();
  await page.goto(`/app/works/${second.id}/citations`);
  await expect(
    page.getByRole("tabpanel").getByText("First work source", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("No sources yet", { exact: true })).toBeVisible();
  for (const mode of ["source_check", "discover", "fact_check"]) {
    const result = await request.post("/api/v1/runs", {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: {
        documentVersionId: second.documentVersionId,
        mode,
        sourcePolicy: mode === "source_check" ? "user_supplied" : "academic",
        externalAccess: mode === "source_check" ? "none" : "research",
        selectedSources: [
          {
            assetId: source.id,
            extractionId: source.extraction_id,
            pageRanges: [],
          },
        ],
      },
    });
    expect(result.status(), await result.text()).toBe(400);
    expect(await result.text()).toContain(
      "does not belong to the current work",
    );
  }
  const imported = await request.post("/api/v1/source-imports", {
    data: {
      kind: "bibliography",
      documentId: first.id,
      text: "Smith, Jane. First work source. Publisher, 2024.",
    },
  });
  expect(imported.status()).toBe(202);
  const bibliography = await imported.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/source-imports/${bibliography.id}`)
          ).json()
        ).status,
    )
    .toBe("complete");
  const wrongBibliography = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: second.documentVersionId,
      mode: "source_check",
      sourcePolicy: "user_supplied",
      externalAccess: "none",
      selectedSources: [],
      referenceImportVersionId: bibliography.id,
    },
  });
  expect(wrongBibliography.status(), await wrongBibliography.text()).toBe(400);
  const wrongImport = await request.post("/api/v1/source-imports", {
    data: { kind: "file", documentId: second.id, assetId: source.id },
  });
  expect(wrongImport.status()).toBe(400);
  const wrongDelete = await request.delete(
    `/api/v1/sources/${source.id}?documentId=${second.id}`,
  );
  expect(wrongDelete.status()).toBe(400);
  const valid = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: first.documentVersionId,
      mode: "source_check",
      sourcePolicy: "user_supplied",
      externalAccess: "none",
      selectedSources: [
        {
          assetId: source.id,
          extractionId: source.extraction_id,
          pageRanges: [],
        },
      ],
    },
  });
  expect(valid.status(), await valid.text()).toBe(202);
  const validRun = await valid.json();
  const manual = await request.post("/api/v1/source-imports", {
    data: {
      kind: "text",
      documentId: second.id,
      text: "The trial included 218 adults.",
      metadata: { title: "Second work source", authors: [], year: "2024" },
    },
  });
  expect(manual.status()).toBe(202);
  const manualImport = await manual.json();
  let manualResult: any;
  await expect
    .poll(async () => {
      manualResult = await (
        await request.get(`/api/v1/source-imports/${manualImport.id}`)
      ).json();
      return manualResult.status;
    })
    .toBe("complete");
  const references = await (
    await request.get(`/api/v1/source-imports/${bibliography.id}`)
  ).json();
  const entryId = references.entries[0].id;
  const wrongReference = await request.patch(
    `/api/v1/reference-entries/${entryId}`,
    { data: { assetId: manualResult.result.assetId } },
  );
  expect(wrongReference.status()).toBe(400);
  const corrected = await request.patch(
    `/api/v1/reference-entries/${entryId}`,
    { data: { assetId: source.id } },
  );
  expect(corrected.status()).toBe(200);
  const correctedVersion = await corrected.json();
  const correctedCheck = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: first.documentVersionId,
      mode: "source_check",
      referenceImportVersionId: correctedVersion.referenceImportVersionId,
    },
  });
  expect(correctedCheck.status(), await correctedCheck.text()).toBe(202);
  const correctedRun = await correctedCheck.json();
  for (const run of [validRun, correctedRun]) {
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/runs/${run.id}`)).json()).status,
      )
      .not.toMatch(/^(queued|running)$/);
  }
  expect(
    (
      await request.delete(
        `/api/v1/sources/${source.id}?documentId=${first.id}`,
      )
    ).status(),
  ).toBe(202);
  const remaining = await (
    await request.get(`/api/v1/sources?documentId=${first.id}`)
  ).json();
  expect(remaining.items.map((item: any) => item.id)).not.toContain(source.id);
  const secondLibrary = await (
    await request.get(`/api/v1/sources?documentId=${second.id}`)
  ).json();
  expect(secondLibrary.items.map((item: any) => item.id)).toEqual([
    manualResult.result.assetId,
  ]);
});
