import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { accountStore } from "./accounts.js";

export function inviteEnabled() {
  return process.env.PROOF_HOSTED === "true" || !!process.env.PROOF_INVITE_CODE;
}
export function hasInvite(account: { invitedAt?: string } | undefined) {
  return !inviteEnabled() || !!account?.invitedAt;
}

export function inviteGate(accounts: ReturnType<typeof accountStore>) {
  const code = process.env.PROOF_INVITE_CODE || "";
  if (code && !/^\d{4}$/.test(code))
    throw new Error("PROOF_INVITE_CODE must contain exactly four digits.");
  const attempts = new Map<string, { count: number; expires: number }>();
  return (req: Request, res: Response, id: string) => {
    if (req.method === "POST" && req.path === "/invite") {
      if (!accounts.get(id)) {
        res
          .status(401)
          .json({ error: "Sign in before entering your invite code." });
        return true;
      }
      if (hasInvite(accounts.get(id))) {
        res.json({ inviteRequired: false });
        return true;
      }
      if (!code) {
        res.status(503).json({
          error: "Invitations are not ready yet. Please try again later.",
        });
        return true;
      }
      const now = Date.now();
      // An account limit prevents guessing through multiple addresses; the address
      // limit prevents cycling through newly created accounts.
      const keys = [`account:${id}`, `address:${req.ip || "unknown"}`];
      for (const [key, bucket] of attempts)
        if (bucket.expires <= now) attempts.delete(key);
      if (
        attempts.size > 10000 ||
        keys.some((key) => (attempts.get(key)?.count || 0) >= 5)
      ) {
        res.setHeader("Retry-After", "900");
        res
          .status(429)
          .json({ error: "Too many attempts. Try again in 15 minutes." });
        return true;
      }
      const supplied = typeof req.body?.code === "string" ? req.body.code : "";
      if (
        !/^\d{4}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(code))
      ) {
        for (const key of keys) {
          const bucket = attempts.get(key) || {
            count: 0,
            expires: now + 900000,
          };
          bucket.count++;
          attempts.set(key, bucket);
        }
        res.status(400).json({
          error:
            "That invite code is not valid. Check the four digits and try again.",
        });
        return true;
      }
      accounts.acceptInvite(id);
      attempts.delete(keys[0]);
      res.json({ inviteRequired: false });
      return true;
    }
    if (!hasInvite(accounts.get(id))) {
      res.status(403).json({
        error: "Enter your invite code to open Proof.",
        inviteRequired: true,
      });
      return true;
    }
    return false;
  };
}
