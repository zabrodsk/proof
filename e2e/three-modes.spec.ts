import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { CitationPlan } from "../shared/citation-plan.js";

// Providers are deterministic in review-e2e-server.ts. The HTTP endpoints,
// ownership checks, source extraction, review engine and version persistence run
// against the real backend and PGlite. These are not live-provider smoke tests.
async function draft(
  request: APIRequestContext,
  text: string,
  headers?: Record<string, string>,
) {
  const response = await request.post("/api/v1/documents", {
    data: { title: "Three-mode acceptance", text },
    headers,
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function source(request: APIRequestContext, title = "Citable source") {
  const items = (await (await request.get("/api/v1/sources")).json()).items;
  const saved = items.find((item: any) => item.metadata.title === title);
  expect(saved).toBeTruthy();
  return {
    assetId: saved.id,
    extractionId: saved.extraction_id,
    pageRanges: [],
  };
}
async function run(
  request: APIRequestContext,
  input: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await request.post("/api/v1/runs", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: input,
  });
  expect(response.status(), await response.text()).toBe(202);
  const created = await response.json();
  await expect
    .poll(async () => {
      const saved = await (
        await request.get(`/api/v1/runs/${created.id}`, { headers })
      ).json();
      return saved.stage;
    })
    .toBe("done");
  return (await request.get(`/api/v1/runs/${created.id}`, { headers })).json();
}
async function plan(
  request: APIRequestContext,
  runId: string,
): Promise<CitationPlan> {
  const response = await request.post(`/api/v1/runs/${runId}/citation-plan`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function generate(request: APIRequestContext, text: string) {
  const document = await draft(request, text);
  const checked = await run(request, {
    documentVersionId: document.documentVersionId,
    mode: "discover",
    citationOutput: "generate",
    citationProfile: "mla9",
    sourcePolicy: "public",
    externalAccess: "research",
    allowProviderProcessing: true,
    selectedSources: [await source(request)],
  });
  return { document, checked, proposal: await plan(request, checked.id) };
}
async function choose(page: Page, mode: string) {
  await page
    .getByRole("group", { name: "Check type" })
    .getByRole("button", { name: mode, exact: true })
    .click();
}
async function permit(page: Page) {
  await page
    .getByRole("checkbox", { name: "Allow AI providers", exact: false })
    .check();
}

test("mode setup preserves the draft and never starts research before claim approval", async ({
  page,
  request,
}) => {
  const text =
    "Jane Smith.\nI prefer this ending.\nParis is the capital of France.\nThe moon is made of cheese.";
  const document = await draft(request, text);
  const started: string[] = [];
  page.on("request", (outbound) => {
    if (
      outbound.method() === "POST" &&
      new URL(outbound.url()).pathname === "/api/v1/runs"
    )
      started.push(outbound.url());
  });
  await page.goto(`/app/works/${document.id}`);
  await choose(page, "Generate citations");
  await expect(
    page.getByRole("combobox", { name: "Citation profile", exact: true }),
  ).toHaveValue("mla9");
  await choose(page, "Fact-check");
  await page
    .getByRole("group", { name: "Search scope" })
    .getByRole("radio", { name: "Academic only", exact: true })
    .check();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text);
  expect(started).toHaveLength(0);
  expect(
    (await (await request.get(`/api/v1/documents/${document.id}/runs`)).json())
      .items,
  ).toHaveLength(0);
  const preview = page.locator(".ps-claim-preview");
  await expect(
    preview.getByRole("checkbox", { name: "Paris is", exact: false }),
  ).toBeChecked();
  await preview
    .getByRole("checkbox", { name: "The moon is", exact: false })
    .uncheck();
  await permit(page);
  await page.locator(".ps-setup-start").click();
  await expect(
    page.getByText("1 of 1 selected claims checked.", { exact: false }),
  ).toBeVisible();
  const saved = (
    await (await request.get(`/api/v1/documents/${document.id}/runs`)).json()
  ).items[0];
  expect(saved.input.sourcePolicy).toBe("academic");
  expect(saved.input.claimSpans).toEqual([
    { start: text.indexOf("Paris"), end: text.indexOf("\nThe moon") },
  ]);
  expect(started).toHaveLength(1);
});

test("citation audit separates claim support from a wrong printed locator and a missing citation", async ({
  request,
}) => {
  const document = await draft(
    request,
    "The trial included 218 adults (Brown 21).\n\nThe trial included 218 adults (Brown 22).\n\nThe trial included 218 adults.",
  );
  const checked = await run(request, {
    documentVersionId: document.documentVersionId,
    mode: "source_check",
    selectedSources: [await source(request)],
    sourcePolicy: "user_supplied",
    externalAccess: "none",
    allowProviderProcessing: true,
    citationProfile: "mla9",
  });
  const findings = (
    await (await request.get(`/api/v1/runs/${checked.id}/findings`)).json()
  ).items;
  expect(findings).toHaveLength(3);
  expect(findings[0].support).toBe("supported");
  expect(findings[0].citation).toBe("correct");
  expect(findings[0].evidence[0].pageLabel).toBe("21");
  expect(findings[0].evidence[0].pageIndex).toBe(1);
  expect(findings[1].support).toBe("supported");
  expect(findings[1].citation).toBe("wrong_locator");
  expect(findings[2].support).toBe("supported");
  expect(findings[2].citation).toBe("missing");
  const requests = (
    await (
      await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
    ).json()
  ).items;
  expect(requests.some((item: any) => item.url.includes("api.exa.ai"))).toBe(
    false,
  );
});

test("generated citation plan needs approval, preserves gaps and unused references, applies once, and exports the saved version", async ({
  request,
}) => {
  const text =
    "Jane Smith.\n\nThe trial included 218 adults.\n\nThe moon is made of cheese.\n\nTutoring improves adult reading scores.\n\nWorks Cited\n\nUnrelated, Author. A retained reference.";
  const { document, checked, proposal } = await generate(request, text);
  await test.info().attach("citation-plan", {
    body: JSON.stringify(proposal, null, 2),
    contentType: "application/json",
  });
  expect(proposal.coverage.totalClaims).toBe(3);
  expect(proposal.coverage.citableClaims).toBe(1);
  expect(
    proposal.operations.filter((op) => op.kind === "citation"),
  ).toHaveLength(1);
  expect(proposal.previewText).toContain(
    "The trial included 218 adults (Brown 21).",
  );
  expect(proposal.previewText).toContain(
    "Unrelated, Author. A retained reference.",
  );
  expect(proposal.previewText).toContain("The moon is made of cheese.");
  expect(proposal.gaps.some((gap) => gap.claim.includes("moon"))).toBe(true);
  expect(proposal.gaps.some((gap) => gap.claim.includes("Tutoring"))).toBe(
    true,
  );
  const before = (
    await (await request.get("/api/v1/documents")).json()
  ).items.find((item: any) => item.id === document.id);
  expect(before.current_version_id).toBe(document.documentVersionId);
  expect(before.text).toBe(text);
  const endpoint = `/api/v1/documents/${document.id}/citation-plans/${proposal.id}/apply`;
  const key = crypto.randomUUID();
  const body = {
    approved: true,
    documentVersionId: document.documentVersionId,
    operationIds: proposal.operations
      .filter((op) => op.kind === "citation")
      .map((op) => op.id),
  };
  const apply = () =>
    request.post(endpoint, { headers: { "Idempotency-Key": key }, data: body });
  const first = await apply();
  expect(first.status(), await first.text()).toBe(200);
  const saved = await first.json();
  expect(saved.id).not.toBe(document.documentVersionId);
  expect(saved.text).toBe(proposal.previewText);
  expect((await (await apply()).json()).id).toBe(saved.id);
  expect(saved.text.match(/Brown, Maria/g)).toHaveLength(1);
  expect(saved.text.match(/\(Brown 21\)/g)).toHaveLength(1);
  const persisted = (
    await (await request.get("/api/v1/documents")).json()
  ).items.find((item: any) => item.id === document.id);
  expect(persisted.text).toBe(saved.text);
  expect(persisted.current_version_id).toBe(saved.id);
  const old = await request.get(
    `/api/v1/documents/${document.id}/export?format=text&versionId=${document.documentVersionId}`,
  );
  expect(old.status()).toBe(200);
  expect(await old.text()).toBe(text);
  const exported = await request.get(
    `/api/v1/documents/${document.id}/export?format=html&versionId=${saved.id}`,
  );
  expect(exported.status()).toBe(200);
  const html = await exported.text();
  expect(html).toContain("The trial included 218 adults (Brown 21).");
  expect(html).toContain("Works Cited");
  expect(html).toMatch(/<(?:i|em)>Evidence Journal<\/(?:i|em)>/);
  expect(
    (
      await (
        await request.get(`/api/v1/runs/${checked.id}/citation-plan`)
      ).json()
    ).gaps,
  ).toEqual(proposal.gaps);
});

test("citation edits reject stale versions, invalid operation IDs and access by another owner without mutation", async ({
  request,
}) => {
  const text = "The trial included 218 adults.";
  const { document, checked, proposal } = await generate(request, text);
  const endpoint = `/api/v1/documents/${document.id}/citation-plans/${proposal.id}/apply`;
  const body = {
    approved: true,
    documentVersionId: document.documentVersionId,
    operationIds: proposal.operations.map((op) => op.id),
  };
  const other = { "x-proof-e2e-owner": "another-browser-owner" };
  for (const url of [
    `/api/v1/runs/${checked.id}/citation-plan`,
    `/api/v1/documents/${document.id}/export?format=html&versionId=${document.documentVersionId}`,
  ])
    expect((await request.get(url, { headers: other })).status()).toBe(404);
  expect(
    (
      await request.post(endpoint, {
        headers: { ...other, "Idempotency-Key": crypto.randomUUID() },
        data: body,
      })
    ).status(),
  ).toBe(404);
  const invalid = await request.post(endpoint, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { ...body, operationIds: [crypto.randomUUID()] },
  });
  expect(invalid.status()).toBeGreaterThanOrEqual(400);
  expect(invalid.status()).toBeLessThan(500);
  const edit = await request.post(`/api/v1/documents/${document.id}/versions`, {
    data: {
      text: `${text}\nA new factual statement.`,
      expectedVersionId: document.documentVersionId,
    },
  });
  expect(edit.status()).toBe(201);
  const current = await edit.json();
  expect(
    (
      await request.post(endpoint, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        data: body,
      })
    ).status(),
  ).toBe(409);
  const saved = (
    await (await request.get("/api/v1/documents")).json()
  ).items.find((item: any) => item.id === document.id);
  expect(saved.current_version_id).toBe(current.id);
  expect(saved.text).not.toContain("Works Cited");
});

test("fact-check source scope changes real query routing, while scientific claims retain academic routing", async ({
  request,
}) => {
  for (const [claim, policy] of [
    ["Paris is the capital of France.", "public"],
    ["Paris is the capital of France.", "academic"],
    ["Tutoring improves adult reading scores.", "public"],
  ]) {
    // Each route starts with a fresh workspace. Warm reuse is covered by the
    // provider-efficiency tests, and must not erase the cold dispatch assertion.
    const headers = {
      "x-proof-e2e-owner": `scope-routing-${crypto.randomUUID()}`,
    };
    const document = await draft(request, claim, headers);
    const checked = await run(
      request,
      {
        documentVersionId: document.documentVersionId,
        mode: "fact_check",
        selectedSources: [],
        sourcePolicy: policy,
        externalAccess: "research",
        allowProviderProcessing: true,
      },
      headers,
    );
    const requests = (
      await (
        await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
      ).json()
    ).items.filter((item: any) => item.url.includes("api.exa.ai/search"));
    await test
      .info()
      .attach(
        `provider-routing-${policy}-${claim.includes("Tutoring") ? "scientific" : "public-fact"}`,
        {
          body: JSON.stringify(requests, null, 2),
          contentType: "application/json",
        },
      );
    expect(requests).toHaveLength(2);
    for (const outbound of requests) {
      if (policy === "academic" || claim.includes("Tutoring"))
        expect(outbound.body.category).toBe("publication");
      else {
        expect(outbound.body.category).toBeUndefined();
        expect(outbound.body.includeDomains).toBeUndefined();
      }
    }
  }
});

test("the generated document is reviewed, saved, reopened and downloaded through the UI", async ({
  page,
  request,
  browserName,
  context,
}) => {
  const text =
    "The trial included 218 adults.\n\nTutoring improves adult reading scores.";
  const document = await draft(request, text);
  await page.goto(`/app/works/${document.id}`);
  await choose(page, "Generate citations");
  await page
    .getByRole("checkbox", { name: "Citable source Ready", exact: true })
    .check();
  await permit(page);
  await page.locator(".ps-setup-start").click();
  const proposals = page.getByRole("region", { name: "Citation proposals" });
  await expect(proposals).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text);
  await expect(proposals).toContainText("Brown 21");
  await proposals.getByText("Evidence and reference", { exact: true }).click();
  await expect(proposals.locator("blockquote")).toContainText(
    "The trial included 218 adults.",
  );
  await expect(proposals.locator("figcaption")).toContainText("Page 21");
  const selection = proposals.getByRole("checkbox", {
    name: "Citation for The trial",
    exact: false,
  });
  await selection.focus();
  await selection.press("Space");
  await expect(
    page.getByRole("button", { name: "Apply selected citations", exact: true }),
  ).toBeDisabled();
  await selection.press("Space");
  await expect(selection).toBeChecked();
  await page.screenshot({
    path: `output/proof-three-modes/${test.info().project.name}-citation-proposals.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Apply selected citations", exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveValue(
    /The trial included 218 adults \(Brown 21\)\./,
  );
  const saved = await editor.inputValue();
  expect(saved).toContain("Works Cited");
  expect(saved).toContain("Tutoring improves adult reading scores.");
  await page.reload();
  await expect(editor).toHaveValue(saved);
  await page.screenshot({
    path: `output/proof-three-modes/${test.info().project.name}-cited-document.png`,
    fullPage: true,
  });
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: "Copy document", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Document copied", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      saved,
    );
  }
  const textDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download text", exact: true })
    .click();
  const downloaded = await textDownload;
  expect(downloaded.suggestedFilename()).toMatch(/\.txt$/);
  const stream = await downloaded.createReadStream();
  const buffers: Buffer[] = [];
  if (stream)
    for await (const chunk of stream) buffers.push(Buffer.from(chunk));
  expect(Buffer.concat(buffers).toString()).toBe(saved);
  const htmlDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download formatted HTML", exact: true })
    .click();
  const formatted = await htmlDownload;
  expect(formatted.suggestedFilename()).toMatch(/\.html$/);
  const htmlStream = await formatted.createReadStream();
  const htmlBuffers: Buffer[] = [];
  if (htmlStream)
    for await (const chunk of htmlStream) htmlBuffers.push(Buffer.from(chunk));
  expect(Buffer.concat(htmlBuffers).toString()).toContain(
    "The trial included 218 adults (Brown 21).",
  );
});

test("a provider timeout leaves a durable uncited gap and never creates a cosmetic citation", async ({
  request,
}) => {
  const text = "The outage fixture is a public fact.";
  const { document, checked, proposal } = await generate(request, text);
  expect(proposal.operations).toHaveLength(0);
  expect(proposal.coverage.citableClaims).toBe(0);
  expect(proposal.gaps).toHaveLength(1);
  expect(proposal.previewText).toBe(text);
  const persisted = (
    await (await request.get("/api/v1/documents")).json()
  ).items.find((item: any) => item.id === document.id);
  expect(persisted.current_version_id).toBe(document.documentVersionId);
  expect(persisted.text).toBe(text);
  const findings = (
    await (await request.get(`/api/v1/runs/${checked.id}/findings`)).json()
  ).items;
  expect(findings[0].support).toBe("not_verified");
  expect(findings[0].fix).toBeUndefined();
  const reopened = await (
    await request.get(`/api/v1/runs/${checked.id}/citation-plan`)
  ).json();
  expect(reopened.gaps).toEqual(proposal.gaps);
});

test("classroom audit cannot be turned into citation generation through the API", async ({
  request,
}) => {
  const document = await draft(request, "Paris is the capital of France.");
  const response = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      documentVersionId: document.documentVersionId,
      mode: "discover",
      citationOutput: "generate",
      citationProfile: "classroom",
      sourcePolicy: "academic",
      externalAccess: "research",
      selectedSources: [await source(request)],
      allowProviderProcessing: true,
    },
  });
  expect(response.status()).toBe(400);
  expect(
    (await (await request.get(`/api/v1/documents/${document.id}/runs`)).json())
      .items,
  ).toHaveLength(0);
});

test("Accept all sends one atomic request and saves every approved correction together", async ({
  page,
  request,
}) => {
  const text =
    "Jane Smith.\n\nThe trial included 120 adults.\n\nThe trial included 120 adults.";
  const document = await draft(request, text);
  const edits: string[] = [];
  page.on("request", (outbound) => {
    if (
      outbound.method() === "POST" &&
      /\/apply-fix(?:es)?$/.test(new URL(outbound.url()).pathname)
    )
      edits.push(new URL(outbound.url()).pathname);
  });
  await page.goto(`/app/works/${document.id}`);
  await page
    .getByRole("checkbox", { name: "Synthetic source Ready", exact: true })
    .check();
  await permit(page);
  await page.locator(".ps-setup-start").click();
  const accept = page.getByRole("button", {
    name: "Accept all 2",
    exact: true,
  });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text.replaceAll("120", "218"));
  expect(edits).toEqual([`/api/v1/documents/${document.id}/apply-fixes`]);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text.replaceAll("120", "218"));
  const previous = await request.get(
    `/api/v1/documents/${document.id}/export?format=text&versionId=${document.documentVersionId}`,
  );
  expect(await previous.text()).toBe(text);
});

test("a bibliography-only classroom audit runs without inventing claims and keeps the four-source assignment separate", async ({
  page,
  request,
}) => {
  const entry =
    'Brown, Maria. "Citable source." Evidence Journal, vol. 4, no. 2, 2024, pp. 21-22.';
  const text = `Jane Smith.\n\nWorks Cited\n\n${entry}\n\n${entry}`;
  const document = await draft(request, text);
  await page.goto(`/app/works/${document.id}`);
  await page
    .getByRole("combobox", { name: "Citation profile", exact: true })
    .selectOption("classroom");
  await page
    .getByRole("combobox", { name: "Assignment checks", exact: true })
    .selectOption("bibliography");
  await page
    .getByRole("checkbox", { name: "Citable source Ready", exact: true })
    .check();
  await permit(page);
  await expect(page.locator(".ps-setup-start")).toBeEnabled();
  await page.locator(".ps-setup-start").click();
  const audit = page.getByRole("region", {
    name: "Citation audit",
    exact: true,
  });
  await expect(audit).toBeVisible();
  await expect(audit).toContainText("2 bibliography entries");
  await expect(audit).toContainText("separate four-source assignment");
  await expect(audit).toContainText("Manual review");
  await expect(
    page.getByRole("textbox", { name: "Document text" }),
  ).toHaveValue(text);
  const checked = (
    await (await request.get(`/api/v1/documents/${document.id}/runs`)).json()
  ).items[0];
  expect(checked.input.claimSpans).toEqual([]);
  expect(checked.input.assignmentProfile).toBe("bibliography");
  expect(checked.coverage.totalClaims).toBe(0);
  const proposal = await plan(request, checked.id);
  expect(proposal.operations).toHaveLength(0);
  expect(proposal.audit?.counts.bibliographyEntries).toBe(2);
  expect(
    proposal.audit?.bibliographyIssues.some(
      (issue) => issue.kind === "duplicate",
    ),
  ).toBe(true);
  expect(
    (
      await (
        await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
      ).json()
    ).items,
  ).toHaveLength(0);
});

test("common knowledge receives no generated citation, paid call or implied accuracy verdict", async ({
  request,
}) => {
  const text = "Paris is the capital of France.";
  for (const mode of ["source_check", "discover"]) {
    const document = await draft(request, text);
    const checked = await run(request, {
      documentVersionId: document.documentVersionId,
      mode,
      selectedSources: [await source(request)],
      sourcePolicy: mode === "source_check" ? "user_supplied" : "academic",
      externalAccess: mode === "source_check" ? "none" : "research",
      citationOutput: mode === "discover" ? "generate" : "audit",
      allowProviderProcessing: true,
    });
    const findings = (
      await (await request.get(`/api/v1/runs/${checked.id}/findings`)).json()
    ).items;
    expect(findings).toHaveLength(1);
    expect(findings[0].claim.citationRequirement).toBe("common_knowledge");
    expect(findings[0].citation).toBe("not_required");
    expect(findings[0].support).toBe("not_verified");
    expect(findings[0].evidence).toHaveLength(0);
    const proposal = await plan(request, checked.id);
    expect(proposal.operations).toHaveLength(0);
    expect(proposal.previewText).toBe(text);
    expect(proposal.previewText).not.toContain("Works Cited");
    expect(proposal.coverage.citableClaims).toBe(0);
    expect(proposal.coverage.citationExemptClaims).toBe(1);
    expect(proposal.exemptions).toHaveLength(1);
    expect(proposal.gaps).toHaveLength(0);
    expect(checked.usage).toHaveLength(0);
    expect(
      (
        await (
          await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
        ).json()
      ).items,
    ).toHaveLength(0);
  }
});

test("mixed citation generation cites only the study-specific claim and keeps common knowledge separate", async ({
  request,
}) => {
  const text =
    "Paris is the capital of France.\n\nThe trial included 218 adults.";
  const { checked, proposal } = await generate(request, text);
  const citations = proposal.operations.filter((op) => op.kind === "citation");
  expect(citations).toHaveLength(1);
  expect(citations[0].original).toBe("The trial included 218 adults.");
  expect(citations[0].replacement).toBe(
    "The trial included 218 adults (Brown 21).",
  );
  expect(proposal.previewText).toMatch(
    /^Paris is the capital of France\.\n\nThe trial included 218 adults \(Brown 21\)\./,
  );
  expect(proposal.coverage.citableClaims).toBe(1);
  expect(proposal.coverage.citationExemptClaims).toBe(1);
  expect(proposal.exemptions?.[0].claim).toBe(
    "Paris is the capital of France.",
  );
  expect(proposal.gaps).toHaveLength(0);
  const requests = (
    await (
      await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
    ).json()
  ).items;
  expect(
    requests.some(
      (item: any) =>
        item.body?.state?.claim === "Paris is the capital of France.",
    ),
  ).toBe(false);
  expect(
    requests.some(
      (item: any) =>
        item.body?.state?.claim === "The trial included 218 adults.",
    ),
  ).toBe(true);
  expect(requests.some((item: any) => item.url.includes("api.exa.ai"))).toBe(
    false,
  );
});

test("quoting common knowledge still requires inspected evidence and a source citation", async ({
  request,
}) => {
  const text = '"Paris is the capital of France."';
  const { checked, proposal } = await generate(request, text);
  const findings = (
    await (await request.get(`/api/v1/runs/${checked.id}/findings`)).json()
  ).items;
  expect(findings[0].claim.kind).toBe("quotation");
  expect(findings[0].claim.citationRequirement).toBe("required");
  expect(findings[0].support).toBe("supported");
  expect(proposal.exemptions || []).toHaveLength(0);
  expect(
    proposal.operations.filter((op) => op.kind === "citation"),
  ).toHaveLength(1);
  expect(proposal.previewText).toContain("(Brown 21)");
  expect(
    (
      await (
        await request.get(`/__e2e/provider-requests?runId=${checked.id}`)
      ).json()
    ).items.some((item: any) => item.url.includes("api.typesafe.ai")),
  ).toBe(true);
});

test("audience common-knowledge choice persists and cannot exempt quotes or study-specific evidence", async ({
  page,
  request,
}) => {
  const text =
    'Berlin is the capital of Germany.\n\nThe trial included 218 adults.\n\n"Paris is the capital of France."';
  const document = await draft(request, text);
  await page.goto(`/app/works/${document.id}`);
  await choose(page, "Generate citations");
  const berlin = page.getByRole("combobox", {
    name: "Citation requirement for Berlin is the capital of Germany.",
    exact: true,
  });
  await expect(berlin).toHaveValue("required");
  await berlin.selectOption("common_knowledge");
  const trial = page.getByRole("combobox", {
    name: "Citation requirement for The trial included 218 adults.",
    exact: true,
  });
  const quotation = page.getByRole("combobox", {
    name: 'Citation requirement for "Paris is the capital of France."',
    exact: true,
  });
  for (const protectedChoice of [trial, quotation]) {
    await expect(protectedChoice).toHaveValue("required");
    await expect(
      protectedChoice.getByRole("option", {
        name: "Common knowledge, no citation",
        exact: true,
      }),
    ).toHaveAttribute("disabled", "");
  }
  await page
    .getByRole("checkbox", { name: "Citable source Ready", exact: true })
    .check();
  await permit(page);
  await page.locator(".ps-setup-start").click();
  const proposals = page.getByRole("region", {
    name: "Citation proposals",
    exact: true,
  });
  await expect(proposals).toBeVisible();
  await expect(proposals).toContainText("No citation needed · 1");
  await expect(proposals).toContainText("Berlin is the capital of Germany.");
  const checked = (
    await (await request.get(`/api/v1/documents/${document.id}/runs`)).json()
  ).items[0];
  expect(
    checked.input.claimSpans.find((span: any) => span.start === 0)
      .citationRequirement,
  ).toBe("common_knowledge");
  const findings = (
    await (await request.get(`/api/v1/runs/${checked.id}/findings`)).json()
  ).items;
  expect(
    findings.find((finding: any) => finding.claim.start === 0).support,
  ).toBe("not_verified");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Citation proposals", exact: true }),
  ).toContainText("No citation needed · 1");
  await page.getByRole("button", { name: "New check", exact: true }).click();
  await expect(berlin).toHaveValue("common_knowledge");
  await expect(trial).toHaveValue("required");
  await expect(quotation).toHaveValue("required");
  await expect(
    page.getByRole("textbox", { name: "Document text", exact: true }),
  ).toHaveValue(text);
});
