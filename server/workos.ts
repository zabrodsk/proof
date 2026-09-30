import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { WorkOS } from "@workos-inc/node";
import { accountContext, accountStore } from "./accounts.js";

const keys = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
] as const;
export function workosConfigured() {
  return keys.some((key) => !!process.env[key]);
}
export function installWorkOS(app: Express) {
  for (const key of keys)
    if (!process.env[key]) throw new Error(`WorkOS requires ${key}.`);
  const password = process.env.WORKOS_COOKIE_PASSWORD!;
  if (password.length < 32)
    throw new Error(
      "WORKOS_COOKIE_PASSWORD must contain at least 32 characters.",
    );
  const redirectUri = new URL(process.env.WORKOS_REDIRECT_URI!);
  const hosted = process.env.PROOF_HOSTED === "true";
  if (
    redirectUri.pathname !== "/auth/callback" ||
    redirectUri.search ||
    redirectUri.hash ||
    redirectUri.username ||
    redirectUri.password
  )
    throw new Error(
      "WORKOS_REDIRECT_URI must point to /auth/callback without query or credentials.",
    );
  if (
    redirectUri.protocol !== "https:" &&
    (hosted ||
      redirectUri.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(redirectUri.hostname))
  )
    throw new Error("WorkOS requires HTTPS except on localhost.");
  const secure = redirectUri.protocol === "https:";
  const workos = new WorkOS(process.env.WORKOS_API_KEY!, {
    clientId: process.env.WORKOS_CLIENT_ID!,
  });
  const accounts = accountStore();
  const cookie = (req: Request, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1) || "";
  const setCookie = (res: Response, name: string, value: string, age: number) =>
    res.cookie(name, value, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: age,
    });
  const signature = (value: string) =>
    createHmac("sha256", password).update(value).digest("hex");
  const session = (req: Request) =>
    workos.userManagement.loadSealedSession({
      sessionData: cookie(req, "proof_workos"),
      cookiePassword: password,
    });
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(["/auth", "/api"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/auth/login", async (req, res) => {
    const { url, state, codeVerifier } =
      await workos.userManagement.getAuthorizationUrlWithPKCE({
        provider: "authkit",
        clientId: process.env.WORKOS_CLIENT_ID!,
        redirectUri: redirectUri.href,
        screenHint: req.query.screen === "sign-up" ? "sign-up" : "sign-in",
      });
    const value = Buffer.from(
      JSON.stringify({ state, codeVerifier, expires: Date.now() + 600_000 }),
    ).toString("base64url");
    setCookie(res, "proof_oauth", `${value}.${signature(value)}`, 600_000);
    res.redirect(url);
  });
  app.get("/auth/callback", async (req, res) => {
    const token = cookie(req, "proof_oauth");
    setCookie(res, "proof_oauth", "", 0);
    try {
      const [value, signed] = token.split(".");
      const expected = signature(value || "");
      if (
        !signed ||
        signed.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signed), Buffer.from(expected))
      )
        throw Error("Invalid state");
      const flow = JSON.parse(Buffer.from(value, "base64url").toString());
      if (
        flow.expires < Date.now() ||
        typeof req.query.state !== "string" ||
        req.query.state !== flow.state ||
        typeof req.query.code !== "string"
      )
        throw Error("Invalid callback");
      const { sealedSession } =
        await workos.userManagement.authenticateWithCode({
          clientId: process.env.WORKOS_CLIENT_ID!,
          code: req.query.code,
          codeVerifier: flow.codeVerifier,
          session: { sealSession: true, cookiePassword: password },
        });
      if (!sealedSession) throw Error("Missing session");
      setCookie(res, "proof_workos", sealedSession, 7 * 24 * 60 * 60_000);
      res.redirect("/app");
    } catch {
      res
        .status(400)
        .type("text")
        .send("Sign-in failed or expired. Return to /app and try again.");
    }
  });
  app.get("/auth/logout", async (req, res) => {
    let url = "/app";
    try {
      url = await session(req).getLogoutUrl({
        returnTo: new URL("/app", redirectUri).href,
      });
    } catch {
      /* Invalid sessions can still be cleared locally. */
    }
    setCookie(res, "proof_workos", "", 0);
    res.redirect(url);
  });
  app.post("/api/session", (_req, res) =>
    res
      .status(405)
      .json({ error: "Sign in through WorkOS.", loginUrl: "/auth/login" }),
  );
  app.delete("/api/session", (_req, res) => {
    setCookie(res, "proof_workos", "", 0);
    res.json({ authenticated: false });
  });
  app.use("/api", async (req, res, next) => {
    try {
      const sealed = session(req);
      let auth = await sealed.authenticate();
      if (!auth.authenticated && cookie(req, "proof_workos")) {
        const refreshed = await sealed.refresh();
        if (refreshed.authenticated) {
          setCookie(
            res,
            "proof_workos",
            refreshed.sealedSession!,
            7 * 24 * 60 * 60_000,
          );
          auth = await workos.userManagement
            .loadSealedSession({
              sessionData: refreshed.sealedSession!,
              cookiePassword: password,
            })
            .authenticate();
        }
      }
      if (!auth.authenticated) {
        if (req.path === "/session")
          return res.json({ authenticated: false, hosted, provider: "workos" });
        return res
          .status(401)
          .json({ error: "Sign in to Proof.", loginUrl: "/auth/login" });
      }
      const user = auth.user;
      const account = accounts.workos(
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
      );
      if (req.path === "/session")
        return res.json({
          authenticated: true,
          hosted,
          provider: "workos",
          user: {
            id: account.id,
            name: account.name,
            jevUsd: account.jevUsd,
            inputTokens: account.inputTokens,
          },
        });
      res.locals.proofSession = account.id;
      accountContext.run(
        { charge: (tokens, usd) => accounts.charge(account.id, tokens, usd) },
        next,
      );
    } catch {
      res
        .status(503)
        .json({ error: "Could not verify your session. Try again." });
    }
  });
}
