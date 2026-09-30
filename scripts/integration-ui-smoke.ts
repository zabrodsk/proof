// Local visual QA only. This fixture is never installed by the production server.
import express from "express";
import {
  fixture,
  alice,
  source,
  saveSource,
  input,
  runFixture,
  finishImports,
} from "../tests/integrations/helpers.js";
import {
  integrationApi,
  integrationErrors,
} from "../server/integrations/http.js";
import { readFile } from "node:fs/promises";
const f = await fixture();
const pdf = await readFile(
  new URL("../tests/fixtures/research.pdf", import.meta.url),
);
const imported = await f.service.import(alice, {
  idempotencyKey: crypto.randomUUID(),
  items: [
    {
      kind: "file",
      title: "Chapter mapping QA",
      filename: "book.pdf",
      contentType: "application/pdf",
      base64: pdf.toString("base64"),
    },
  ],
});
await finishImports(f, imported.id);
const s = await saveSource(f.store, source());
const run = await f.store.createRun(
  alice,
  input({ kind: "check_sources", sources: [{ id: s.id, version: s.version }] }),
);
await runFixture(f, run.id);
const app = express();
app.use(express.json());
app.get("/api/session", (_req, res) =>
  res.json({
    authenticated: true,
    hosted: false,
    user: { id: alice.owner, name: "Local QA fixture" },
  }),
);
app.use((_req, res, next) => {
  res.locals.proofSession = alice.owner;
  next();
});
app.use("/api/integrations", integrationApi(f.service));
integrationErrors(app);
app.use(express.static("dist"));
app.get("/{*path}", (_req, res) =>
  res.sendFile("index.html", { root: process.cwd() + "/dist" }),
);
app.listen(4329, "127.0.0.1", () =>
  console.log(`Local fixture: http://127.0.0.1:4329/app/checks/${run.id}`),
);
