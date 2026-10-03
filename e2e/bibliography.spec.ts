import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a Word bibliography survives upload, citation audit, and reopening without evidence calls", async ({
  page,
  request,
}) => {
  const sourceTitle = `Word bibliography ${crypto.randomUUID()}`;
  const body = await readFile("tests/fixtures/bibliography.docx");
  const create = await request.post("/api/v1/uploads", {
    data: {
      filename: "bibliography.docx",
      metadata: { title: sourceTitle },
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: body.length,
    },
  });
  expect(create.status()).toBe(201);
  const upload = await create.json();
  expect(
    (
      await request.put(upload.uploadUrl, {
        data: body,
        headers: upload.headers,
      })
    ).status(),
  ).toBe(204);
  expect(
    (await request.post(`/api/v1/uploads/${upload.id}/complete`)).status(),
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/sources")).json()).items.find(
          (s: any) => s.id === upload.id,
        )?.contentKind,
    )
    .toBe("bibliography");
  const text =
    "The U.S. therefore funds research (Brown 15). The program supplies the station (Brown 18). The patent framework changes (Lee 8). The Act permits private operations (Hao and Tronchetti 8). The proposed budgets grow (Krause 14).";
  const docResponse = await request.post("/api/v1/documents", {
    data: { title: "Bibliography acceptance", text },
  });
  const doc = await docResponse.json();
  await page.goto(`/app/works/${doc.id}`);
  await page.getByRole("checkbox", { name: sourceTitle, exact: false }).check();
  await expect(
    page
      .locator(".ps-setup-source")
      .filter({ hasText: sourceTitle })
      .getByText("4 references found.", { exact: false }),
  ).toBeVisible();
  const retrieval = page.getByRole("checkbox", {
    name: "Allow Proof to retrieve the works",
    exact: false,
  });
  await expect(retrieval).toBeChecked();
  await retrieval.uncheck();
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByText(
      "5 in-text citations · 4 cited works · 4 bibliography entries",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.locator(".ps-changes > li")).toHaveCount(5);
  await expect(page.locator(".ps-changes")).toContainText(
    "Source text unavailable",
  );
  await expect(page.locator(".ps-changes")).not.toContainText(
    "Not in your sources",
  );
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text);
  const history = (
    await (await request.get(`/api/v1/documents/${doc.id}/runs`)).json()
  ).items;
  const calls = await (
    await request.get(`/__e2e/provider-requests?runId=${history[0].id}`)
  ).json();
  expect(calls.items).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByText(
      "5 in-text citations · 4 cited works · 4 bibliography entries",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "New check", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: sourceTitle, exact: false }),
  ).toBeChecked();
  await expect(retrieval).not.toBeChecked();
});
