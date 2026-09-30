import { classRoster } from "../shared/class-roster.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { accountStore, accountContext } from "./accounts.js";
import { installWorkOS, workosConfigured } from "./workos.js";

export function installAccess(app: Express) {
  if (workosConfigured()) return installWorkOS(app);
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
      roster: classRoster.map((name) => ({
        name,
        claimed: accounts.claimed(name),
      })),
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
          "Use a name of 2–60 characters and a password of 10–128 characters.",
      });
    let account;
    if (req.body.register === true) {
      if (
        typeof req.body.key === "string" &&
        equal(req.body.key.trim(), secret)
      ) {
        const selected = classRoster.find(
          (n) => n.toLowerCase() === name.toLowerCase(),
        );
        if (!selected)
          return res
            .status(400)
            .json({ error: "Choose your first name from the class list." });
        account = accounts.create(selected, password);
        if (!account)
          return res.status(409).json({
            error:
              "That account has already been claimed. Sign in with your password.",
          });
      }
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
        req.body.register === true
          ? "The class join code is incorrect. Paste the code shared by Dusan, not your password."
          : "Could not sign in. Check your name and password. If this is your first visit, claim your account first.",
    });
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!authenticated(req))
      return res
        .status(401)
        .json({ error: "Sign in with your name and password." });
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
