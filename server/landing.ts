import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWaitlistRouter } from "./waitlist.js";

const app = express();
const appUrl = new URL(
  process.env.PROOF_APP_URL || "http://127.0.0.1:4317/app",
);
if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:")
  throw new Error("PROOF_APP_URL must use HTTPS in production.");
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host)
        return res
          .status(403)
          .json({ error: "Cross-site requests are not allowed." });
    } catch {
      return res.status(403).json({ error: "Invalid origin." });
    }
  }
  next();
});
app.use(express.json({ limit: "8kb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get(["/app", "/app/{*path}"], (_req, res) =>
  res.redirect(302, appUrl.href),
);
app.use("/api/waitlist", createWaitlistRouter());
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown API route." }),
);
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
app.use(express.static(dist));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ error: "The request could not be read." });
  },
);
app.listen(Number(process.env.PORT || 4318), "0.0.0.0");
