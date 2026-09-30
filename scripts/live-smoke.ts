import { writeFile } from "node:fs/promises";
import { auditDocument } from "../server/audit.js";
import { demoText } from "../shared/demo.js";
import { apiKey } from "../server/judge.js";
if (!apiKey()) throw new Error("Jev is not configured.");
const start = Date.now();
const result = await auditDocument(demoText, "strict", []);
await writeFile("/tmp/proof-live-audit.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      seconds: (Date.now() - start) / 1000,
      sources: result.sources.map((s) => ({
        title: s.title,
        access: s.access,
        passages: s.passages.length,
      })),
      findings: result.findings.map((f) => ({
        claim: f.text,
        status: f.status,
        confidence: f.confidence,
        method: f.method,
        evidence: f.evidence?.slice(0, 200),
      })),
      notices: result.notices,
    },
    null,
    2,
  ),
);
if (result.findings.some((f) => f.method === "unverified"))
  process.exitCode = 1;
