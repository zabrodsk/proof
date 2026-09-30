import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { accountStore, accountContext } from "./accounts.js";

export function installAccess(app: Express) {
  const hosted = process.env.PROOF_HOSTED === "true";
  const secret = process.env.PROOF_ACCESS_KEY || "";
  if (hosted && secret.length < 24)
    throw new Error(
      "Hosted Proof requires PROOF_ACCESS_KEY of at least 24 characters.",
    );
  const accounts = accountStore();
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const equal = (a: string, b: string) =>
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const sessionId = (req: Request) => {
    const token =
      req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("proof_session="))
        ?.slice(14) || "";
    const [expires, id, signature] = token.split(".");
    return !!id &&
      !!signature &&
      Number(expires) > Date.now() &&
      equal(signature, sign(`${expires}.${id}`)) &&
      !!accounts.get(id)
      ? id
      : undefined;
  };
  const authenticated = (req: Request) => !hosted || !!sessionId(req);
  const attempts = new Map<string, { count: number; since: number }>();
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const session = (req: Request) => {
    const a = accounts.get(sessionId(req) || "");
    return {
      authenticated: authenticated(req),
      hosted,
      user: a
        ? {
            id: a.id,
            name: a.name,
            jevUsd: a.jevUsd,
            inputTokens: a.inputTokens,
          }
        : undefined,
    };
  };
  app.get("/api/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(session(req));
  });
  app.delete("/api/session", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      "proof_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
        (hosted ? "; Secure" : ""),
    );
    res.json({ authenticated: false });
  });
  app.post("/api/session", (req, res) => {
    const address = req.ip || "unknown";
    const bucket = attempts.get(address);
    const recent =
      bucket && Date.now() - bucket.since < 15 * 60_000
        ? bucket
        : { count: 0, since: Date.now() };
    if (recent.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again in 15 minutes." });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (
      name.length < 2 ||
      name.length > 60 ||
      password.length < 10 ||
      password.length > 128
    )
      return res.status(400).json({
        error:
          "Use a username of 2–60 characters and a password of 10–128 characters.",
      });
    let account;
    if (req.body.register === true) {
      account = accounts.create(name, password);
      if (!account)
        return res.status(409).json({
          error: "That username is taken. Choose another or sign in.",
        });
    } else account = accounts.login(name, password);
    if (account) {
      attempts.delete(address);
      const expires = String(Date.now() + 7 * 24 * 60 * 60_000);
      const value = `${expires}.${account.id}`;
      res.setHeader(
        "Set-Cookie",
        `proof_session=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${hosted ? "; Secure" : ""}`,
      );
      return res.json({
        authenticated: true,
        hosted,
        user: {
          id: account.id,
          name: account.name,
          jevUsd: account.jevUsd,
          inputTokens: account.inputTokens,
        },
      });
    }
    recent.count++;
    attempts.set(address, recent);
    if (attempts.size > 2000)
      for (const [key, v] of attempts)
        if (Date.now() - v.since > 15 * 60_000) attempts.delete(key);
    return res.status(401).json({
      error:
        "Could not sign in. Check your username and password, or create an account if this is your first visit.",
    });
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!authenticated(req))
      return res
        .status(401)
        .json({ error: "Sign in with your username and password." });
    res.locals.proofSession = sessionId(req) || "local";
    const id = sessionId(req);
    if (id)
      accountContext.run(
        { charge: (tokens, usd) => accounts.charge(id, tokens, usd) },
        next,
      );
    else next();
  });
}
