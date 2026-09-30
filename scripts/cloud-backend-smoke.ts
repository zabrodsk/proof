import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// This script only calls an already deployed API. It never starts a local server.
// All documents and files below contain synthetic test data. No secrets or signed
// URLs are printed, including when a request fails.
const rawUrl = process.env.PROOF_SMOKE_URL;
if (!rawUrl)
  throw new Error("Set PROOF_SMOKE_URL to the deployed HTTPS API origin.");
const remote = new URL(rawUrl);
assert.equal(remote.protocol, "https:", "Cloud smoke requires HTTPS.");
assert.ok(
  !remote.username && !remote.password,
  "Use a URL without credentials.",
);
assert.ok(
  !/^(localhost|127\.|0\.0\.0\.0$|\[::1\]$)/i.test(remote.hostname),
  "Cloud smoke cannot target a local server.",
);
const base = remote.origin;
const name = process.env.PROOF_SMOKE_NAME;
const password = process.env.PROOF_SMOKE_PASSWORD;
if (!name || !password)
  throw new Error(
    "Set PROOF_SMOKE_NAME and PROOF_SMOKE_PASSWORD for a provisioned synthetic account.",
  );
const providers = process.env.PROOF_SMOKE_PROVIDER_CHECK === "true";
const research = process.env.PROOF_SMOKE_RESEARCH === "true";
const timeout = Number(process.env.PROOF_SMOKE_TIMEOUT_MS || 240_000);
assert.ok(
  Number.isFinite(timeout) && timeout >= 10_000,
  "Invalid smoke timeout.",
);
let cookie = "";
const assets = new Set<string>();
const runIds = new Set<string>();
const downloads = new Map<string, URL>();
const cleanupFailures: string[] = [];
const marker = randomUUID();

async function network(input: string | URL, options: RequestInit = {}) {
  try {
    return await fetch(input, options);
  } catch {
    throw new Error("Deployment network request failed or timed out.");
  }
}

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await network(base + path, {
    ...init,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(40_000),
    redirect: "error",
  });
  // Do not include response bodies, URLs with query strings, or request headers
  // in errors. Provider responses and signed links can contain credentials.
  assert.equal(
    response.status,
    expected,
    `${init.method || "GET"} ${path.split("?")[0]} returned HTTP ${response.status}.`,
  );
  const sessionCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("proof_session="));
  if (sessionCookie) cookie = sessionCookie.split(";")[0];
  return response;
}
async function json(
  path: string,
  body?: unknown,
  expected = 200,
  extra: Record<string, string> = {},
) {
  const response = await request(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", ...extra },
          body: JSON.stringify(body),
        },
    expected,
  );
  return response.json();
}
async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  maximum = timeout,
) {
  const until = Date.now() + maximum;
  while (Date.now() < until) {
    const value = await read();
    if (ready(value)) return value;
    await delay(1500);
  }
  throw new Error(`${label} did not finish within the smoke timeout.`);
}
async function run(
  documentVersionId: string,
  mode: "source_check" | "discover" | "fact_check",
  selectedSources: unknown[],
  allowProviderProcessing: boolean,
  claimLength: number,
) {
  const input = {
    documentVersionId,
    mode,
    selectedSources,
    checkScope: "selected_library",
    externalAccess: mode === "source_check" ? "none" : "research",
    sourcePolicy: mode === "source_check" ? "user_supplied" : "academic",
    budgetPreset: "small",
    allowProviderProcessing,
    claimSpans: [{ start: 0, end: claimLength }],
  };
  const key = randomUUID();
  const created = await json("/api/v1/runs", input, 202, {
    "Idempotency-Key": key,
  });
  runIds.add(created.id);
  const duplicate = await json("/api/v1/runs", input, 202, {
    "Idempotency-Key": key,
  });
  assert.equal(duplicate.id, created.id, "Retry created a second run.");
  const finished: any = await waitFor(
    "Worker run",
    () => json(`/api/v1/runs/${created.id}`),
    (value) => !["queued", "running"].includes(value.status),
  );
  assert.ok(
    ["complete", "partial"].includes(finished.status),
    `Worker run ended as ${finished.status}.`,
  );
  assert.equal(finished.stage, "done");
  assert.equal(finished.coverage.completedClaims, 1);
  const findings = await json(`/api/v1/runs/${created.id}/findings`);
  assert.equal(findings.items.length, 1, "Worker did not persist the finding.");
  assert.equal(
    (await json(`/api/v1/runs/${created.id}/findings`)).items[0].id,
    findings.items[0].id,
  );
  const events = await request(`/api/v1/runs/${created.id}/events`);
  const stream = await events.text();
  assert.match(stream, /event: queued/);
  assert.match(stream, /event: finding/);
  assert.match(stream, /event: (?:complete|partial)/);
  return { id: created.id, finished, finding: findings.items[0] };
}

try {
  assert.equal((await json("/health")).ok, true);
  const before = await json("/api/session");
  assert.equal(
    before.hosted,
    true,
    "Deployment must enable hosted authentication.",
  );
  assert.equal(before.authenticated, false);
  const unauthenticated = await network(base + "/api/v1/sources", {
    redirect: "error",
    signal: AbortSignal.timeout(40_000),
  });
  assert.equal(unauthenticated.status, 401);
  // The deployment must provision this synthetic account before the smoke run.
  // Never claim a real student's roster entry for an automated deployment test.
  assert.ok(
    !before.roster?.some(
      (entry: any) => entry.name.toLowerCase() === name.toLowerCase(),
    ),
    "Choose a synthetic test name outside the class roster.",
  );
  const login = await network(base + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name, password }),
    redirect: "error",
    signal: AbortSignal.timeout(40_000),
  });
  assert.equal(
    login.status,
    200,
    "Synthetic account sign-in failed. Provision the dedicated smoke account first.",
  );
  cookie =
    login.headers
      .getSetCookie()
      .find((value) => value.startsWith("proof_session="))
      ?.split(";")[0] || "";
  assert.equal((await login.json()).authenticated, true);
  assert.ok(cookie, "Authentication did not return a session cookie.");
  const capabilities = await json("/api/v1/capabilities");
  assert.equal(capabilities.persistent, true);
  console.log("Cloud authentication and persistent API passed.");

  const sourceText = `Synthetic private deployment test ${marker}. The study included exactly 218 adult participants. Each participant completed a questionnaire in 2026. This text exists only to verify storage and background processing.`;
  const bytes = Buffer.from(sourceText);
  const upload = await json(
    "/api/v1/uploads",
    {
      metadata: {
        title: `Synthetic deployment source ${marker}`,
        authors: ["Deployment Fixture"],
        year: "2026",
      },
      filename: "deployment-fixture.txt",
      mediaType: "text/plain",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      allowExternalProcessing: false,
    },
    201,
  );
  assets.add(upload.id);
  const signed = new URL(upload.uploadUrl);
  assert.equal(signed.protocol, "https:");
  assert.notEqual(
    signed.origin,
    base,
    "Upload must use the deployed private bucket.",
  );
  assert.ok(
    signed.searchParams.has("X-Amz-Signature"),
    "Bucket upload URL is not signed.",
  );
  const put = await network(signed, {
    method: "PUT",
    headers: { ...upload.headers, "Content-Length": String(bytes.length) },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  assert.ok(put.ok, `Private bucket upload returned HTTP ${put.status}.`);
  await json(`/api/v1/uploads/${upload.id}/complete`, {}, 202);
  const source: any = await waitFor(
    "Source ingestion",
    async () =>
      (await json("/api/v1/sources?limit=100")).items.find(
        (item: any) => item.id === upload.id,
      ),
    (item) => {
      if (item?.status === "failed")
        throw new Error("Worker source ingestion failed.");
      return item?.status === "ready" && !!item.extraction_id;
    },
  );
  assert.equal(source.coverage.totalPages, 1);
  assert.deepEqual(source.coverage.unreadablePages, []);
  const downloaded = await json(`/api/v1/sources/${upload.id}/download`);
  const signedDownload = new URL(downloaded.url);
  downloads.set(upload.id, signedDownload);
  assert.ok(signedDownload.searchParams.has("X-Amz-Signature"));
  const stored = await network(signedDownload, {
    signal: AbortSignal.timeout(40_000),
    redirect: "error",
  });
  assert.equal(stored.status, 200);
  assert.equal(await stored.text(), sourceText);
  const unsigned = new URL(signedDownload);
  unsigned.search = "";
  const privateResponse = await network(unsigned, {
    signal: AbortSignal.timeout(40_000),
    redirect: "error",
  });
  assert.ok(
    [401, 403, 404].includes(privateResponse.status),
    "Original source is anonymously accessible.",
  );
  console.log(
    "Signed private bucket upload, worker extraction, exact download, and anonymous denial passed.",
  );

  const claim = "The study included exactly 218 adult participants.";
  const document = await json(
    "/api/v1/documents",
    { title: `Synthetic deployment draft ${marker}`, text: claim },
    201,
  );
  const selections = [
    { assetId: upload.id, extractionId: source.extraction_id, pageRanges: [] },
  ];
  const baseline = await run(
    document.documentVersionId,
    "source_check",
    selections,
    false,
    claim.length,
  );
  assert.equal(baseline.finished.status, "partial");
  assert.equal(baseline.finding.support, "not_verified");
  assert.equal(
    baseline.finished.usage.length,
    0,
    "Provider-disabled run used an external provider.",
  );
  assert.ok(baseline.finished.config.sourceSnapshots[upload.id]);
  console.log(
    "Durable provider-disabled run, idempotency, findings, provenance, and event replay passed.",
  );
  if (providers) {
    const checked = await run(
      document.documentVersionId,
      "source_check",
      selections,
      true,
      claim.length,
    );
    assert.ok(
      checked.finding.checkedPassageIds.length > 0,
      "Provider-enabled check assessed no passages.",
    );
    assert.ok(
      checked.finished.usage.some(
        (entry: any) => entry.provider === "jev" && entry.status === "complete",
      ),
    );
    for (const passageId of checked.finding.checkedPassageIds) {
      const passage = await json(`/api/v1/passages/${passageId}`);
      assert.equal(passage.extraction_id, source.extraction_id);
      assert.ok(sourceText.includes(passage.text));
    }
    console.log(
      "Live Jev source assessment and stored passage provenance passed.",
    );
  }
  if (research) {
    assert.equal(
      capabilities.exa,
      true,
      "Research smoke requires configured Exa.",
    );
    const researchText =
      "Regular exercise reduces depressive symptoms in adults.";
    const researchDocument = await json(
      "/api/v1/documents",
      { title: `Synthetic research test ${marker}`, text: researchText },
      201,
    );
    for (const mode of ["discover", "fact_check"] as const) {
      const checked = await run(
        researchDocument.documentVersionId,
        mode,
        [],
        true,
        researchText.length,
      );
      assert.ok(
        checked.finished.usage.some(
          (entry: any) =>
            entry.provider === "exa" && entry.status === "complete",
        ),
      );
      const results = await json(`/api/v1/runs/${checked.id}/research`);
      assert.ok(
        results.items.some((entry: any) => entry.candidates.length > 0),
        `${mode} saved no research candidates.`,
      );
      for (const result of results.items)
        for (const selected of result.selections || [])
          assets.add(selected.assetId);
      console.log(
        `Live ${mode} research, usage, and persisted results passed.`,
      );
    }
  }
} finally {
  // Deleting sources removes dependent reports and queues durable bucket cleanup.
  // Only IDs created/retrieved in this isolated synthetic account are removed.
  if (cookie) {
    for (const id of runIds) {
      try {
        const results = await json(`/api/v1/runs/${id}/research`);
        for (const result of results.items)
          for (const selected of result.selections || [])
            assets.add(selected.assetId);
        const existing = await network(base + `/api/v1/runs/${id}`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(40_000),
        });
        if (
          existing.ok &&
          ["queued", "running"].includes((await existing.json()).status)
        )
          await json(`/api/v1/runs/${id}/cancel`, {}, 202);
      } catch {
        cleanupFailures.push("Run cancellation failed.");
      }
    }
    for (const id of assets) {
      try {
        let signedAt = 0;
        if (downloads.has(id)) {
          const refreshed = await json(`/api/v1/sources/${id}/download`);
          downloads.set(id, new URL(refreshed.url));
          signedAt = Date.now();
        }
        await request(`/api/v1/sources/${id}`, { method: "DELETE" }, 202);
        assert.ok(
          !(await json("/api/v1/sources?limit=100")).items.some(
            (source: any) => source.id === id,
          ),
        );
        const download = downloads.get(id);
        if (download)
          await waitFor(
            "Private bucket deletion",
            async () => {
              const response = await network(download, {
                signal: AbortSignal.timeout(40_000),
                redirect: "error",
              });
              await response.body?.cancel();
              return response.status;
            },
            (status) => {
              assert.ok(
                Date.now() - signedAt < 55_000,
                "Signed URL expired before bucket deletion could be verified.",
              );
              return [403, 404].includes(status);
            },
            45_000,
          );
      } catch {
        cleanupFailures.push("Synthetic source deletion failed.");
      }
    }
    try {
      await request("/api/session", { method: "DELETE" });
    } catch {
      cleanupFailures.push("Session logout failed.");
    }
  }
  if (cleanupFailures.length)
    throw new Error([...new Set(cleanupFailures)].join(" "));
  if (assets.size)
    console.log(
      downloads.size
        ? "Synthetic sources removed from the library. Original private test object deletion confirmed."
        : "Synthetic sources removed from the library and bucket cleanup queued.",
    );
}
console.log(
  "Cloud backend smoke passed. Synthetic accounts and draft records remain for audit; original test sources and dependent reports were deleted.",
);
