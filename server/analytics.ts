import { Router } from "express";

// Only the public ingestion token is exposed. Personal API keys stay server-side.
export function analyticsConfig(env: NodeJS.ProcessEnv = process.env) {
  // Enable only after the operator approves the destination and event payload.
  if (env.PROOF_POSTHOG_ENABLED !== "true") return { enabled: false } as const;
  const token = env.PROOF_POSTHOG_TOKEN?.trim();
  if (!token || !/^phc_[a-zA-Z0-9_-]+$/.test(token))
    return { enabled: false } as const;
  const host = env.PROOF_POSTHOG_HOST || "https://eu.i.posthog.com";
  if (!["https://eu.i.posthog.com", "https://us.i.posthog.com"].includes(host))
    return { enabled: false } as const;
  return { enabled: true, token, host } as const;
}

export function analyticsRouter() {
  const router = Router();
  router.get("/api/analytics/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(analyticsConfig());
  });
  return router;
}
