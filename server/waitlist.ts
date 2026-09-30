import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .email()
    .transform((value) => value.toLowerCase()),
  website: z.string().max(500).default(""),
  consent: z.literal(true),
  source: z.enum(["hero", "footer"]).default("hero"),
});
const entrySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  joinedAt: z.string().datetime(),
  consent: z.literal("early-access-v1"),
  source: z.enum(["hero", "footer"]),
});
type Entry = z.infer<typeof entrySchema>;

/** One local server writes this file. Keep it on a persistent disk when hosting. */
export function createWaitlistStore(file: string) {
  let queue = Promise.resolve();
  return {
    add(email: string, source: Entry["source"]) {
      const operation = queue.then(async () => {
        let entries: Entry[];
        try {
          entries = z
            .array(entrySchema)
            .parse(JSON.parse(await readFile(file, "utf8")));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          entries = [];
        }
        if (entries.some((entry) => entry.email === email)) return;
        entries.push({
          id: randomUUID(),
          email,
          source,
          joinedAt: new Date().toISOString(),
          consent: "early-access-v1",
        });
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(JSON.stringify(entries, null, 2) + "\n");
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

export function createWaitlistRouter(
  options: { file?: string; limit?: number; windowMs?: number } = {},
) {
  const router = Router();
  const store = createWaitlistStore(
    options.file ||
      process.env.WAITLIST_FILE ||
      path.resolve(".data/waitlist.json"),
  );
  const requests = new Map<string, { count: number; expires: number }>();
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60 * 60 * 1000;
  router.post("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    for (const [ip, bucket] of requests)
      if (bucket.expires <= now) requests.delete(ip);
    const ip = req.ip || "unknown";
    const bucket = requests.get(ip) || { count: 0, expires: now + windowMs };
    if (
      bucket.count >= limit ||
      (!requests.has(ip) && requests.size >= 10000)
    ) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.expires - now) / 1000)),
      );
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again in an hour." });
    }
    bucket.count++;
    requests.set(ip, bucket);
    const input = signupSchema.safeParse(req.body);
    if (!input.success)
      return res.status(400).json({
        error: "Enter a valid email address and agree to early-access updates.",
      });
    // Do not let automated form fillers add addresses to the list.
    if (input.data.website) return res.status(200).json({ ok: true });
    try {
      await store.add(input.data.email, input.data.source);
      // The same response protects existing members' email addresses.
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(503).json({
        error: "We could not save your email. Please try again shortly.",
      });
    }
  });
  return router;
}
