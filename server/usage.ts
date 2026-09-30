import { accountContext } from "./accounts.js";
import { AsyncLocalStorage } from "node:async_hooks";
export type UsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  unmeteredRequests: number;
  estimatedUsd: number;
  pricePerMillion: number;
};
const meter = new AsyncLocalStorage<UsageTotals>();
export function recordJevUsage(usage: unknown) {
  const current = meter.getStore();
  if (
    usage &&
    typeof usage === "object" &&
    "input_tokens" in usage &&
    typeof usage.input_tokens === "number" &&
    Number.isFinite(usage.input_tokens) &&
    usage.input_tokens >= 0
  )
    accountContext
      .getStore()
      ?.charge(usage.input_tokens, (usage.input_tokens * 0.042) / 1_000_000);
  if (!current) return;
  current.requests++;
  if (
    usage &&
    typeof usage === "object" &&
    "input_tokens" in usage &&
    typeof usage.input_tokens === "number"
  ) {
    current.inputTokens += usage.input_tokens;
    if ("output_tokens" in usage && typeof usage.output_tokens === "number")
      current.outputTokens += usage.output_tokens;
  } else current.unmeteredRequests++;
  current.estimatedUsd =
    (current.inputTokens * current.pricePerMillion) / 1_000_000;
}
export async function withUsage<T>(work: () => Promise<T>) {
  const usage: UsageTotals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    unmeteredRequests: 0,
    estimatedUsd: 0,
    pricePerMillion: 0.042,
  };
  const result = await meter.run(usage, work);
  return { result, usage };
}
