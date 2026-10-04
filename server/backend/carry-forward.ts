import { randomUUID } from "node:crypto";
import type { BackendFinding } from "../../shared/backend.js";
import { type Sql, event } from "./db.js";

export interface EditRegion {
  start: number;
  end: number;
  delta: number;
}

export function editRegion(before: string, after: string): EditRegion {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start++;
  let suffix = 0;
  while (
    suffix < limit - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return {
    start,
    end: before.length - suffix,
    delta: after.length - before.length,
  };
}

// A judgment can depend on the whole sentence, so any edit inside a sentence
// retires every finding in that sentence.
function sentenceBounds(text: string, region: EditRegion) {
  const boundary = /[.!?\n]/;
  let start = region.start;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  let end = region.end;
  while (end < text.length && !boundary.test(text[end])) end++;
  return { start, end: Math.min(text.length, end + 1) };
}

function moved(
  span: { start: number; end: number },
  bounds: { start: number; end: number },
  delta: number,
) {
  if (span.end <= bounds.start) return { start: span.start, end: span.end };
  if (span.start >= bounds.end)
    return { start: span.start + delta, end: span.end + delta };
  return undefined;
}

export function carriedFindings(
  findings: BackendFinding[],
  before: string,
  after: string,
  region: EditRegion,
  versionId: string,
  exclude?: string,
) {
  const bounds = sentenceBounds(before, region);
  const carried: { from: BackendFinding; to: BackendFinding }[] = [];
  for (const finding of findings) {
    if (finding.id === exclude || !finding.claim) continue;
    const claim = moved(finding.claim, bounds, region.delta);
    if (!claim || after.slice(claim.start, claim.end) !== finding.claim.text)
      continue;
    const next: BackendFinding = {
      ...finding,
      claim: { ...finding.claim, ...claim },
      ...(finding.citationChecks
        ? {
            citationChecks: finding.citationChecks.map((check) => ({
              ...check,
              start: check.start + claim.start - finding.claim.start,
              end: check.end + claim.start - finding.claim.start,
            })),
          }
        : {}),
    };
    delete next.fix;
    if (finding.fix) {
      const fix = moved(finding.fix, bounds, region.delta);
      if (fix && after.slice(fix.start, fix.end) === finding.fix.original)
        next.fix = { ...finding.fix, ...fix, documentVersionId: versionId };
    }
    carried.push({ from: finding, to: next });
  }
  return carried;
}

// Copies the latest finished report for the previous version onto the new
// version. The original run and its findings are left intact for the record.
export async function carryForward(
  tx: Sql,
  ws: string,
  from: { versionId: string; text: string },
  to: { versionId: string; text: string },
  region: EditRegion,
  reason: { kind: "edit" } | { kind: "fix"; findingId: string },
) {
  const source = (
    await tx.query(
      "SELECT * FROM runs WHERE workspace_id=$1 AND document_version_id=$2 AND invalidated=false AND cancel_requested=false AND status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1",
      [ws, from.versionId],
    )
  ).rows[0];
  if (!source) return undefined;
  const rows = (
    await tx.query(
      "SELECT f.id,f.ordinal,f.data,c.data AS claim FROM findings f JOIN claims c ON c.id=f.claim_id AND c.workspace_id=f.workspace_id WHERE f.workspace_id=$1 AND f.run_id=$2 ORDER BY f.ordinal",
      [ws, source.id],
    )
  ).rows as {
    id: string;
    ordinal: number;
    data: BackendFinding;
    claim: Record<string, unknown>;
  }[];
  const carried = carriedFindings(
    rows.map((row) => row.data),
    from.text,
    to.text,
    region,
    to.versionId,
    reason.kind === "fix" ? reason.findingId : undefined,
  );
  // An accepted fix keeps the report even when nothing else carries, so the
  // reviewer sees the check as finished rather than out of date.
  if (!carried.length && reason.kind === "edit") return undefined;
  const runId = randomUUID();
  await tx.query(
    "INSERT INTO runs(id,workspace_id,document_version_id,idempotency_key,request_hash,input,config,status,stage,coverage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      runId,
      ws,
      to.versionId,
      `carry:${runId}`,
      source.request_hash,
      JSON.stringify({ ...source.input, documentVersionId: to.versionId }),
      JSON.stringify(source.config),
      source.status,
      source.stage,
      JSON.stringify({
        ...source.coverage,
        carriedFrom: source.id,
        carriedFindings: carried.length,
        retiredFindings: rows.length - carried.length,
      }),
    ],
  );
  for (const { from: previous, to: next } of carried) {
    const row = rows.find((item) => item.id === previous.id)!;
    const claimId = randomUUID(),
      findingId = randomUUID();
    next.id = findingId;
    await tx.query(
      "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,$4,$5)",
      [
        claimId,
        ws,
        runId,
        row.ordinal,
        JSON.stringify(
          typeof row.claim.start === "number" &&
            typeof row.claim.end === "number"
            ? { ...row.claim, start: next.claim.start, end: next.claim.end }
            : row.claim,
        ),
      ],
    );
    await tx.query(
      "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,$5,$6)",
      [findingId, ws, runId, claimId, row.ordinal, JSON.stringify(next)],
    );
    const citations = await tx.query(
      "SELECT l.data FROM citation_links l JOIN findings f ON f.workspace_id=l.workspace_id AND f.claim_id=l.claim_id WHERE f.workspace_id=$1 AND f.id=$2",
      [ws, previous.id],
    );
    for (const citation of citations.rows)
      await tx.query(
        "INSERT INTO citation_links(id,workspace_id,claim_id,data) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          ws,
          claimId,
          JSON.stringify({ ...citation.data, checks: next.citationChecks }),
        ],
      );
    const links = await tx.query(
      "SELECT passage_id,data FROM evidence_links WHERE workspace_id=$1 AND finding_id=$2",
      [ws, previous.id],
    );
    for (const link of links.rows)
      await tx.query(
        "INSERT INTO evidence_links(id,workspace_id,finding_id,passage_id,data) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          ws,
          findingId,
          link.passage_id,
          JSON.stringify(link.data),
        ],
      );
  }
  await event(tx, ws, source.id, "carried_forward", {
    runId,
    documentVersionId: to.versionId,
    ...reason,
  });
  await event(tx, ws, runId, "derived", {
    runId: source.id,
    documentVersionId: from.versionId,
    ...reason,
  });
  return runId;
}
