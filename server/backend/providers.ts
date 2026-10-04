import { reserveConnectorCall } from "../integrations/budgets.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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

export async function reserveProviderRequest(
  input: string | URL,
  provider: string,
  bytes = 0,
  signal = providerContext.getStore()?.signal,
) {
  const ctx = providerContext.getStore();
  if (!ctx) return undefined;
  signal?.throwIfAborted();
  const id = randomUUID();
  await reserveConnectorCall(
    ctx.db,
    ctx.ws,
    ctx.run,
    provider,
    bytes,
    async (tx) => {
      const r = await tx.query(
        "SELECT cancel_requested,input,invalidated FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ctx.ws, ctx.run],
      );
      if (!r.rows[0]) throw notFound();
      if (r.rows[0].cancel_requested || r.rows[0].invalidated)
        throw new HttpError(409, "Run cancelled or invalidated.");
      if (!r.rows[0].input.allowProviderProcessing)
        throw new HttpError(
          403,
          "Provider processing is disabled for this run.",
        );
      if (r.rows[0].input.mode === "source_check" && provider === "exa")
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
      signal?.throwIfAborted();
      await tx.query(
        "INSERT INTO provider_calls(id,workspace_id,run_id,provider,operation) VALUES($1,$2,$3,$4,$5)",
        [id, ctx.ws, ctx.run, provider, new URL(input).pathname],
      );
    },
  );
  return { ctx, id };
}
export async function recordProviderRequest(
  ticket: Awaited<ReturnType<typeof reserveProviderRequest>>,
  status: string,
  usage: Record<string, unknown>,
) {
  if (!ticket) return;
  await ticket.ctx.db.query(
    "UPDATE provider_calls SET status=$4,usage=$5 WHERE workspace_id=$1 AND run_id=$2 AND id=$3",
    [ticket.ctx.ws, ticket.ctx.run, ticket.id, status, JSON.stringify(usage)],
  );
}

export async function providerFetch(
  input: string | URL,
  options: RequestInit = {},
): Promise<Response> {
  const ctx = providerContext.getStore();
  if (!ctx) return fetch(input, options);
  const signal = AbortSignal.any([
    ctx.signal,
    options.signal || AbortSignal.timeout(120_000),
  ]);
  const release = await acquireProviderSlot(ctx, signal);
  try {
    let url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new TypeError(
        "Provider requests require an HTTPS URL without credentials.",
      );
    let requestOptions = { ...options };
    let redirects = 0;
    for (let attempt = 0; ; attempt++) {
      const hostname = url.hostname;
      const belongsTo = (domain: string) =>
        hostname === domain || hostname.endsWith(`.${domain}`);
      const provider = belongsTo("typesafe.ai")
        ? "jev"
        : belongsTo("exa.ai")
          ? "exa"
          : belongsTo("firecrawl.dev")
            ? "firecrawl"
            : belongsTo("openalex.org")
              ? "openalex"
              : belongsTo("crossref.org")
                ? "crossref"
                : "scholarly";
      // Expired caller deadlines never reserve or dispatch another attempt.
      signal.throwIfAborted();
      const ticket = await reserveProviderRequest(
        url,
        provider,
        Buffer.byteLength(
          typeof requestOptions.body === "string" ? requestOptions.body : "",
        ),
        signal,
      );
      let response: Response;
      try {
        signal.throwIfAborted();
        response = await fetch(url, {
          ...requestOptions,
          // A followed redirect is another external request. Handle it here so
          // every dispatch gets its own atomic reservation and ledger entry.
          redirect: "manual",
          signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
        });
      } catch (error) {
        await ctx.db
          .query(
            "UPDATE provider_calls SET status=$4,usage=$5 WHERE workspace_id=$1 AND run_id=$2 AND id=$3",
            [
              ctx.ws,
              ctx.run,
              ticket!.id,
              signal.aborted ? "cancelled" : "network_error",
              JSON.stringify({ estimatedUsd: null, charge: "unknown" }),
            ],
          )
          .catch(() => {});
        if (signal.aborted || attempt >= 2) throw error;
        await delay(250 * 2 ** attempt, undefined, { signal });
        continue;
      }
      // Accounting errors occur after dispatch. They must never retry a paid
      // request that has already returned successfully.
      let usage: any = {
        estimatedUsd: null,
        charge: "unknown",
        attempt: attempt + 1,
      };
      if (response.ok) {
        try {
          const data = await response.clone().json();
          usage = { ...usage, ...data.usage, costDollars: data.costDollars };
          if (
            provider === "jev" &&
            typeof data.usage?.input_tokens === "number"
          )
            usage.estimatedUsd = (data.usage.input_tokens * 0.042) / 1_000_000;
        } catch {
          /* non-JSON downloads retain unknown usage */
        }
      }
      await ctx.db
        .query(
          "UPDATE provider_calls SET status=$4,usage=$5 WHERE workspace_id=$1 AND run_id=$2 AND id=$3",
          [
            ctx.ws,
            ctx.run,
            ticket!.id,
            response.ok ? "complete" : `http_${response.status}`,
            JSON.stringify(usage),
          ],
        )
        .catch(() => {
          // The durable reservation remains pending with unknown usage. Preserve
          // the paid response so a failed accounting write cannot requeue it.
          console.error(
            "Provider usage update failed; the reserved request retains unknown usage.",
          );
        });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (options.redirect === "manual") return response;
        if (options.redirect === "error") {
          await response.body?.cancel();
          throw new TypeError(
            "Provider redirects are disabled for this request.",
          );
        }
        const location = response.headers.get("Location");
        if (!location) return response;
        if (redirects >= 10) {
          await response.body?.cancel();
          throw new TypeError("Provider redirect limit exceeded.");
        }
        const next = new URL(location, url);
        if (next.protocol !== "https:" || next.username || next.password) {
          await response.body?.cancel();
          throw new TypeError(
            "Provider redirects require an HTTPS URL without credentials.",
          );
        }
        const headers = new Headers(requestOptions.headers);
        if (next.origin !== url.origin) {
          headers.delete("authorization");
          headers.delete("cookie");
          headers.delete("proxy-authorization");
          headers.delete("x-api-key");
          headers.delete("api-key");
          headers.delete("x-auth-token");
        }
        const method = (requestOptions.method || "GET").toUpperCase();
        const dropsBody =
          (response.status === 303 && method !== "GET" && method !== "HEAD") ||
          ((response.status === 301 || response.status === 302) &&
            method === "POST");
        if (
          next.origin !== url.origin &&
          !dropsBody &&
          method !== "GET" &&
          method !== "HEAD" &&
          requestOptions.body != null
        ) {
          await response.body?.cancel();
          throw new TypeError(
            "Provider redirects cannot forward a request body to another origin.",
          );
        }
        if (
          (response.status === 303 && method !== "GET" && method !== "HEAD") ||
          ((response.status === 301 || response.status === 302) &&
            method === "POST")
        ) {
          requestOptions = {
            ...requestOptions,
            method: "GET",
            body: undefined,
          };
          headers.delete("content-length");
          headers.delete("content-type");
        }
        requestOptions.headers = headers;
        await response.body?.cancel();
        url = next;
        redirects++;
        attempt = -1;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retryAfter = response.headers.get("Retry-After");
        const requested = retryAfter
          ? /^\d+(?:\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - Date.now()
          : 0;
        // A long provider cooldown cannot be shortened into extra paid calls.
        // Return its response and leave follow-up to a later permitted run.
        if (Number.isFinite(requested) && requested > 5000) return response;
        const wait = Math.max(
          250 * 2 ** attempt,
          Math.min(5000, Number.isFinite(requested) ? requested : 0),
        );
        await response.body?.cancel();
        await delay(wait, undefined, { signal });
        continue;
      }
      return response;
    }
  } finally {
    release();
  }
}

type ProviderRun = NonNullable<ReturnType<typeof providerContext.getStore>>;
const providerSlots = new WeakMap<
  ProviderRun,
  { active: number; queue: (() => void)[] }
>();
async function acquireProviderSlot(ctx: ProviderRun, signal: AbortSignal) {
  signal.throwIfAborted();
  let slots = providerSlots.get(ctx);
  if (!slots) providerSlots.set(ctx, (slots = { active: 0, queue: [] }));
  if (slots.active >= 4) {
    await new Promise<void>((resolve, reject) => {
      const begin = () => {
        signal.removeEventListener("abort", abort);
        slots!.active++;
        resolve();
      };
      const abort = () => {
        const index = slots!.queue.indexOf(begin);
        if (index >= 0) slots!.queue.splice(index, 1);
        reject(signal.reason);
      };
      slots!.queue.push(begin);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  } else slots.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    slots!.active--;
    slots!.queue.shift()?.();
  };
}

const sharedRequests = new WeakMap<
  NonNullable<ReturnType<typeof providerContext.getStore>>,
  Map<string, Promise<unknown>>
>();
export async function coalesceRunRequest<T>(
  key: string,
  request: () => Promise<T>,
  retainCompleted = false,
): Promise<T> {
  const ctx = providerContext.getStore();
  if (!ctx) return request();
  ctx.signal.throwIfAborted();
  let requests = sharedRequests.get(ctx);
  if (!requests) sharedRequests.set(ctx, (requests = new Map()));
  const scopedKey = JSON.stringify([ctx.ws, ctx.run, key]);
  let pending = requests.get(scopedKey) as Promise<T> | undefined;
  if (!pending) {
    pending = request();
    requests.set(scopedKey, pending);
    void pending.then(
      () => {
        if (!retainCompleted) requests!.delete(scopedKey);
      },
      () => requests!.delete(scopedKey),
    );
  }
  const result = await pending;
  ctx.signal.throwIfAborted();
  // Callers can attach claim-specific intents without mutating a shared result.
  return structuredClone(result);
}

export async function exaSearch(
  query: string,
  count = 6,
  options: { domains?: readonly string[]; scope?: "academic" | "public" } = {},
) {
  const key = providerKey("EXA_API_KEY");
  if (!key) throw new Error("EXA_API_KEY is not configured.");
  const body = JSON.stringify({
    query,
    type: "auto",
    ...(options.domains
      ? { includeDomains: options.domains }
      : options.scope === "public"
        ? {}
        : { category: "publication" }),
    numResults: count,
  });
  return coalesceRunRequest(
    `exa:${options.scope || "academic"}:${body}`,
    async () => {
      const r = await providerFetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body,
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
    },
    true,
  );
}
