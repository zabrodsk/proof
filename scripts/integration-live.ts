import assert from "node:assert/strict";
import {
  fixture,
  alice,
  input,
  source,
  saveSource,
} from "../tests/integrations/helpers.js";
import { processRun } from "../server/backend/engine.js";
import { apiKey } from "../server/judge.js";
if (process.env.PROOF_INTEGRATION_LIVE !== "true")
  throw Error(
    "Set PROOF_INTEGRATION_LIVE=true for the paid-provider smoke test, capped at a $0.01 reservation.",
  );
if (!apiKey())
  throw Error("Jev is not configured. No paid requests were made.");
const f = await fixture();
try {
  const s = source();
  s.text =
    "The fictional classroom trial included 120 adults. It measured sleep duration and did not measure reading scores. The mean sleep duration was seven hours.";
  await saveSource(f.store, s);
  const r = await f.store.createRun(
    alice,
    input({
      kind: "check_sources",
      text: "The fictional classroom trial included 120 adults. The fictional trial measured reading scores.",
      sources: [{ id: s.id, version: s.version }],
      budgetUsd: 0.01,
    }),
  );
  await processRun(f.db, f.blobs, r.workspace_id, r.id);
  const report = await f.service.get(alice, r.id);
  assert.equal(report.status, "complete");
  assert.equal(report.findings.length, 2);
  assert.equal(report.findings[1].support === "supported", false);
  assert.ok(report.reservedUsd <= 0.01);
  for (const finding of report.findings)
    for (const id of finding.evidenceIds)
      await f.service.evidence(alice, r.id, id);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        findings: report.findings.map((v: any) => ({
          support: v.support,
          coverage: v.coverage,
          evidenceCount: v.evidenceIds.length,
        })),
        coverage: report.coverage,
        reservedUsd: report.reservedUsd,
        usage: report.usage,
        notice:
          "Shared backend with live Jev and controlled source text. Pipeline smoke test, not host-client certification or an accuracy estimate.",
      },
      null,
      2,
    ),
  );
} finally {
  await f.close();
}
