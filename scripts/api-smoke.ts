import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = "http://127.0.0.1:4317";
const check = async (
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(
    base + path,
    body
      ? {
          method: "POST",
          headers:
            body instanceof FormData
              ? headers
              : { "Content-Type": "application/json", ...headers },
          body: body instanceof FormData ? body : JSON.stringify(body),
        }
      : undefined,
  );
const health = await check("/api/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);
const blocked = await check(
  "/api/audit",
  { text: "A deliberately synthetic test document." },
  { Origin: "https://unrelated.example" },
);
assert.equal(blocked.status, 403);
const invalid = await check("/api/sources/resolve", { doi: "not-a-doi" });
assert.equal(invalid.status, 400);
for (const ext of ["pdf", "docx"]) {
  const data = new FormData();
  data.append(
    "file",
    new Blob([
      await readFile(
        new URL(`../tests/fixtures/research.${ext}`, import.meta.url),
      ),
    ]),
    `research.${ext}`,
  );
  const response = await check("/api/documents/import", data);
  assert.equal(response.status, 200);
  assert.match((await response.json()).text, /218 trials/);
}
const invalidUpload = new FormData();
invalidUpload.append(
  "file",
  new Blob(["This is not a PDF, despite the filename."]),
  "fake.pdf",
);
assert.equal((await check("/api/documents/import", invalidUpload)).status, 400);
const strict = await check("/api/audit", {
  text: "Regular exercise improves long-term academic performance.",
  mode: "strict",
  sourceIds: [],
});
assert.equal(strict.status, 200);
assert.equal((await strict.json()).findings[0].status, "citation_missing");
const uploaded = new FormData();
uploaded.append("title", "Synthetic source");
uploaded.append("author", "Fixture Author");
uploaded.append("year", "2024");
uploaded.append(
  "text",
  "In this synthetic test source, participants completed a sample questionnaire.",
);
const uploadResponse = await check("/api/sources/upload", uploaded);
assert.equal(uploadResponse.status, 200);
assert.equal((await uploadResponse.json()).access, "uploaded");
assert.equal((await check("/api/unknown")).status, 404);
console.log(
  "API smoke passed: health, origin protection, validation, PDF and Word import, strict audit, source upload, and missing route.",
);

const exportResponse = await check("/api/exports", {
  name: "test-export.txt",
  text: "Synthetic export test.",
  type: "text/plain",
});
assert.equal(exportResponse.status, 200);
const exportUrl = (await exportResponse.json()).url;
const file = await check(exportUrl);
assert.match(file.headers.get("Content-Disposition") || "", /attachment/);
assert.equal(await file.text(), "Synthetic export test.");
assert.equal((await check(exportUrl)).status, 404);
console.log(
  "Export smoke passed: attachment response, exact content, and single-use expiration.",
);
