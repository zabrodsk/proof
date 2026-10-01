import { randomUUID } from "node:crypto";
import type { Database } from "../backend/db.js";
import { HttpError } from "../backend/config.js";
import { lock } from "./database.js";
export async function reserveConnectorCall(
  db: Database,
  ws: string,
  runId: string,
  provider: string,
  bytes: number,
) {
  const receipt = (
    await db.query("SELECT * FROM proof_connector_submissions WHERE id=$1", [
      runId,
    ])
  ).rows[0];
  if (!receipt) return; // Website runs without a connector receipt retain the shared engine's native call budget.
  const price =
    provider === "jev"
      ? Number(process.env.PROOF_JEV_USD_PER_MILLION || 0.042)
      : 0;
  const amount =
    provider === "jev"
      ? ((bytes + 8192) * price) / 1_000_000
      : ["exa", "firecrawl"].includes(provider)
        ? Number(
            process.env[`PROOF_${provider.toUpperCase()}_RESERVATION_USD`] ||
              0.02,
          )
        : 0;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    (["jev", "exa", "firecrawl"].includes(provider) && amount === 0)
  )
    throw new HttpError(503, "Invalid provider budget configuration.");
  const permitted = await db.transaction(async (tx) => {
    await lock(tx, "connector-provider-budgets");
    const row = (
      await tx.query(
        "SELECT c.*,r.input AS native_input,r.status,r.cancel_requested FROM proof_connector_submissions c JOIN runs r ON c.id=r.id WHERE r.workspace_id=$1 AND r.id=$2 FOR UPDATE OF r,c",
        [ws, runId],
      )
    ).rows[0];
    if (
      !row ||
      row.cancel_requested ||
      !["queued", "running"].includes(row.status)
    )
      throw new HttpError(409, "Run cancelled or no longer active.");
    if (row.grant_id) {
      const g = (
        await tx.query(
          "SELECT * FROM proof_platform_grants WHERE id=$1 AND active=true",
          [row.grant_id],
        )
      ).rows[0];
      if (
        !g ||
        !g.scopes.includes("checks:run") ||
        row.native_input.selectedSources.some(
          (s: any) => !g.source_ids.includes(s.assetId),
        )
      )
        throw new HttpError(
          403,
          "Platform authorization or selected-source access was revoked.",
        );
    }
    const buckets = [`owner:${row.owner}:${provider}`, `provider:${provider}`];
    const usdLimits = [
      Number(process.env.PROOF_USER_DAILY_BUDGET_USD || 1),
      Number(process.env.PROOF_PROVIDER_DAILY_BUDGET_USD || 20),
    ];
    let exhausted = row.reserved_usd + amount > row.budget_usd;
    for (const [i, bucket] of buckets.entries()) {
      const b = (
        await tx.query(
          "SELECT * FROM proof_connector_budgets WHERE bucket=$1 AND day=CURRENT_DATE",
          [bucket],
        )
      ).rows[0];
      exhausted ||=
        (b?.usd || 0) + amount > usdLimits[i] ||
        (b?.calls || 0) >= [1000, 10000][i];
    }
    if (exhausted) {
      await tx.query(
        "UPDATE runs SET status='partial',cancel_requested=true,error='Provider spending reservation exhausted. Unfinished claims need more evidence.',updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ws, runId],
      );
      return false;
    }
    for (const bucket of buckets)
      await tx.query(
        "INSERT INTO proof_connector_budgets(bucket,day,usd,calls) VALUES($1,CURRENT_DATE,$2,1) ON CONFLICT(bucket,day) DO UPDATE SET usd=proof_connector_budgets.usd+EXCLUDED.usd,calls=proof_connector_budgets.calls+1",
        [bucket, amount],
      );
    await tx.query(
      "UPDATE proof_connector_submissions SET reserved_usd=reserved_usd+$2 WHERE id=$1",
      [runId, amount],
    );
    return true;
  });
  if (!permitted)
    throw new HttpError(429, "Run provider spending reservation exhausted.");
}
