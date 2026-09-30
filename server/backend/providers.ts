import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { HttpError, notFound } from "./config.js";
export const providerContext = new AsyncLocalStorage<{
  db: Database;
  ws: string;
  run: string;
  signal: AbortSignal;
  maxCalls: number;
  model: string;
}>();
export function providerKey(
  name: "EXA_API_KEY" | "OPENALEX_API_KEY" | "FIRECRAWL_API_KEY",
) {
  if (process.env[name]) return process.env[name]!;
  if (
    process.platform === "darwin" &&
    process.env.PROOF_USE_KEYCHAIN !== "false"
  )
    try {
      return execFileSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          {
            EXA_API_KEY: "exa.ai",
            OPENALEX_API_KEY: "openalex.org",
            FIRECRAWL_API_KEY: "firecrawl.dev",
          }[name],
          "-a",
          name,
          "-w",
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        },
      ).trim();
    } catch {
      /* not configured */
    }
  return "";
}
export function openAlexUrl(value: string) {
  const url = new URL(value);
  const key = providerKey("OPENALEX_API_KEY");
  if (key) url.searchParams.set("api_key", key);
  return url.href;
}
export async function providerFetch(
  input: string | URL,
  options: RequestInit = {},
): Promise<Response> {
  const ctx = providerContext.getStore();
  if (!ctx) return fetch(input, options);
  const hostname = new URL(input).hostname;
  const provider = hostname.includes("typesafe")
    ? "jev"
    : hostname.includes("exa.ai")
      ? "exa"
      : hostname.includes("firecrawl")
        ? "firecrawl"
        : hostname.includes("openalex")
          ? "openalex"
          : hostname.includes("crossref")
            ? "crossref"
            : "scholarly";
  for (let attempt = 0; ; attempt++) {
    ctx.signal.throwIfAborted();
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      const r = await tx.query(
        "SELECT cancel_requested,input FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ctx.ws, ctx.run],
      );
      if (!r.rows[0]) throw notFound();
      if (r.rows[0].cancel_requested)
        throw new HttpError(409, "Run cancelled.");
      if (!r.rows[0].input.allowProviderProcessing)
        throw new HttpError(
          403,
          "Provider processing is disabled for this run.",
        );
      if (r.rows[0].input.mode === "source_check" && ["exa"].includes(provider))
        throw new HttpError(
          403,
          "Source checks cannot search unrelated works.",
        );
      const count = await tx.query(
        "SELECT count(*)::int AS n FROM provider_calls WHERE workspace_id=$1 AND run_id=$2",
        [ctx.ws, ctx.run],
      );
      if (count.rows[0].n >= ctx.maxCalls)
        throw new HttpError(429, "Run provider-call budget exhausted.");
      await tx.query(
        "INSERT INTO provider_calls(id,workspace_id,run_id,provider,operation) VALUES($1,$2,$3,$4,$5)",
        [id, ctx.ws, ctx.run, provider, new URL(input).pathname],
      );
    });
    let response: Response;
    try {
      response = await fetch(input, {
        ...options,
        signal: AbortSignal.any([
          ctx.signal,
          options.signal || AbortSignal.timeout(40_000),
        ]),
      });
      let usage: any = { estimatedUsd: null, charge: "unknown" };
      if (response.ok)
        try {
          const data = await response.clone().json();
          usage = { ...usage, ...data.usage, costDollars: data.costDollars };
          if (
            provider === "jev" &&
            typeof data.usage?.input_tokens === "number"
          )
            usage.estimatedUsd = (data.usage.input_tokens * 0.042) / 1_000_000;
        } catch {
          /* unknown usage is explicit */
        }
      await ctx.db.query(
        "UPDATE provider_calls SET status=$4,usage=$5 WHERE workspace_id=$1 AND run_id=$2 AND id=$3",
        [
          ctx.ws,
          ctx.run,
          id,
          response.ok ? "complete" : `http_${response.status}`,
          JSON.stringify(usage),
        ],
      );
    } catch (e) {
      await ctx.db
        .query(
          "UPDATE provider_calls SET status=$4,usage=$5 WHERE workspace_id=$1 AND run_id=$2 AND id=$3",
          [
            ctx.ws,
            ctx.run,
            id,
            ctx.signal.aborted ? "cancelled" : "network_error",
            JSON.stringify({ estimatedUsd: null, charge: "unknown" }),
          ],
        )
        .catch(() => {});
      if (ctx.signal.aborted || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel();
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      continue;
    }
    return response;
  }
}
export async function exaSearch(query: string, count = 6) {
  const key = providerKey("EXA_API_KEY");
  if (!key) throw new Error("EXA_API_KEY is not configured.");
  const r = await providerFetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      type: "auto",
      category: "publication",
      numResults: count,
    }),
  });
  if (!r.ok) throw new Error(`Exa returned HTTP ${r.status}.`);
  const data = await r.json();
  return (data.results || [])
    .filter((r: any) => typeof r.url === "string")
    .map((r: any) => ({
      title: String(r.title || r.url),
      url: r.url,
      doi: r.doi as string | undefined,
    }));
}
