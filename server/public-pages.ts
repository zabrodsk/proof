import { Router } from "express";
import { fileURLToPath } from "node:url";

/** Script-free public pages are reachable before account middleware in every mode. */
export function publicPages() {
  const router = Router();
  for (const page of ["privacy", "terms", "support"]) {
    router.get([`/${page}`, `/${page}/`], (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.sendFile(
        fileURLToPath(new URL(`../public/${page}/index.html`, import.meta.url)),
      );
    });
  }
  return router;
}
