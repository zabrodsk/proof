import { after, before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  migrate,
  workspace,
  type Database,
  type Sql,
} from "../server/backend/db.js";
import { createAsset, ingestAsset } from "../server/backend/library.js";
import { createRun, ownedRun } from "../server/backend/service.js";
import { processRun, type EngineDeps } from "../server/backend/engine.js";
import { runInput, type Selection } from "../shared/backend.js";
import type { BlobStore } from "../server/backend/storage.js";
import test23 from "./fixtures/test23-citations.json";

let pg: PGlite;
let db: Database;
const previousEmbeddings = process.env.PROOF_EMBEDDINGS;
function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) return { rows: (await connection.query(sql, values)).rows };
      return { rows: (await connection.exec(sql)).at(-1)?.rows || [] };
    },
  };
}
before(async () => {
  process.env.PROOF_EMBEDDINGS = "false";
  pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
});
after(async () => {
  await db.close();
  if (previousEmbeddings === undefined) delete process.env.PROOF_EMBEDDINGS;
  else process.env.PROOF_EMBEDDINGS = previousEmbeddings;
});
async function fixture(text: string, pages: string[], automatic = false) {
  const ws = await workspace(db, randomUUID());
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    async put(key, body) {
      files.set(key, Buffer.from(body));
    },
    async get(key) {
      return files.get(key)!;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  const body = Buffer.from(pages[0]);
  const saved = await db.transaction((tx) =>
    createAsset(
      tx,
      ws,
      {
        title: "Controlled study",
        authors: ["Brown"],
        year: "2024",
      },
      "study.txt",
      "text/plain",
      body.length,
    ),
  );
  await blobs.put(saved.key, body, "text/plain");
  const extractionId = await ingestAsset(db, blobs, ws, saved.id);
  await db.query(
    "UPDATE source_assets SET eligibility='eligible' WHERE workspace_id=$1 AND id=$2",
    [ws, saved.id],
  );
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [extractionId],
  );
  // Keep every paragraph on the cited page. This forces separate judgment packets.
  for (let i = 1; i < pages.length; i++) {
    const start = i * 1000;
    await db.query(
      "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) SELECT $1,$2,$3,id,$4,$5,$6 FROM source_pages WHERE extraction_id=$3",
      [
        randomUUID(),
        ws,
        extractionId,
        start,
        start + pages[i].length,
        pages[i],
      ],
    );
  }
  const documentId = randomUUID(),
    versionId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,'Draft',$3)",
    [documentId, ws, versionId],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [versionId, ws, documentId, text],
  );
  const selection: Selection = {
    assetId: saved.id,
    extractionId,
    pageRanges: [],
  };
  const run = await createRun(
    db,
    ws,
    runInput.parse({
      documentVersionId: versionId,
      mode: "source_check",
      selectedSources: [selection],
      allowProviderProcessing: true,
      ...(automatic ? {} : { claimSpans: [{ start: 0, end: text.length }] }),
    }),
    randomUUID(),
  );
  return { ws, blobs, run, assetId: saved.id };
}
const noResearch = async () => ({
  selections: [] as Selection[],
  candidates: [],
  notices: [] as string[],
});

test("Sparrow narrative citation is supported by an indexed abstract with explicit provenance", async () => {
  const sentence =
    "Sparrow, Liu, and Wegner (2011) found that when people expected information to remain accessible later, they showed lower recall for the information itself while remembering more about where it could be found.";
  const abstract =
    "When people expect to have future access to information, they have lower rates of recall of the information itself and enhanced recall instead for where to access it.";
  const f = await fixture(sentence, [abstract]);
  const config = structuredClone(f.run.config);
  const metadata = {
    title:
      "Google effects on memory: Cognitive consequences of having information at our fingertips",
    authors: ["Betsy Sparrow", "Jenny Liu", "Daniel M. Wegner"],
    authorDetails: [
      { family: "Sparrow", given: "Betsy" },
      { family: "Liu", given: "Jenny" },
      { family: "Wegner", given: "Daniel M." },
    ],
    year: "2011",
    doi: "10.1126/science.1207745",
    containerTitle: "Science",
  };
  config.sourceSnapshots[f.assetId] = {
    ...config.sourceSnapshots[f.assetId],
    metadata,
    access: "abstract",
  };
  config.references = [
    {
      id: randomUUID(),
      asset_id: f.assetId,
      status: "matched_ready",
      parsed: metadata,
    },
  ];
  await db.query("UPDATE runs SET config=$2 WHERE id=$1", [
    f.run.id,
    JSON.stringify(config),
  ]);
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, source, passages) => {
      assert.equal(source.access, "abstract");
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        explanation:
          "The abstract reports lower content recall and better location recall under the same condition.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(finding.support, "supported");
  assert.equal(finding.citationChecks[0].support, "supported");
  assert.equal(
    finding.citationChecks[0].text,
    "Sparrow, Liu, and Wegner (2011)",
  );
  assert.equal(finding.citationChecks[0].sourceAccess, "abstract");
  assert.equal(finding.evidence[0].sourceAccess, "abstract");
  assert.equal(finding.evidence[0].text, abstract);
  assert.equal(finding.evidenceGap, undefined);
  assert.equal((await ownedRun(db, f.ws, f.run.id)).status, "complete");
});
function deps(judge: EngineDeps["judge"]): EngineDeps {
  return { judge, research: noResearch, resolveReferences: noResearch };
}

test("different assertions citing the same source never reuse each other’s cached verdict", async () => {
  const text =
    "Brown (2024) found an improvement, although Brown (2024) reported no improvement.";
  const f = await fixture(text, [
    "The treatment improved symptoms in the studied group.",
  ]);
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => ({
      ...claim,
      status: claim.text.includes("no improvement")
        ? "contradicted"
        : "supported",
      method: "Jev",
      evidence: passages![0],
      explanation: "Compared the assertion with the reported improvement.",
    })),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.deepEqual(
    finding.citationChecks.map((check: any) => check.support),
    ["supported", "contradicted"],
  );
  assert.equal(finding.support, "mixed");
});

async function citationSource(
  f: Awaited<ReturnType<typeof fixture>>,
  title: string,
  authors: string[],
  text = "The treatment reduced symptoms in the studied group.",
) {
  const body = Buffer.from(text);
  const saved = await createAsset(
    db,
    f.ws,
    { title, authors, year: "2024" },
    "source.txt",
    "text/plain",
    body.length,
  );
  await f.blobs.put(saved.key, body, "text/plain");
  const extractionId = await ingestAsset(db, f.blobs, f.ws, saved.id);
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [extractionId],
  );
  return { assetId: saved.id, extractionId, pageRanges: [] };
}

async function checkCitations(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Selection[] = [],
) {
  const run = await createRun(
    db,
    f.ws,
    {
      ...f.run.input,
      selectedSources: [...f.run.input.selectedSources, ...extra],
    },
    randomUUID(),
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    run.id,
    deps(async (claim, _source, passages) => {
      const evidence = passages!.find((p) => p.includes("reduced symptoms"));
      return {
        ...claim,
        method: "Jev",
        status: evidence ? "supported" : "not_addressed",
        evidence,
        checkedPassages: passages,
        explanation: "Controlled evidence assessment.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  return { run, finding };
}

test("test23 maps nine citation occurrences and inspects abstracts without assuming topical support", async () => {
  const f = await fixture(
    test23.text,
    ["This abstract provides a summary of a research study."],
    true,
  );
  const extra: Selection[] = [];
  for (const [index, source] of test23.sources.entries()) {
    const selection =
      index === 0
        ? f.run.input.selectedSources[0]
        : await citationSource(
            f,
            source.metadata.title,
            source.metadata.authors,
          );
    await db.query(
      "UPDATE source_assets SET metadata=$3,access='abstract' WHERE workspace_id=$1 AND id=$2",
      [f.ws, selection.assetId, JSON.stringify(source.metadata)],
    );
    if (index > 0) extra.push(selection);
  }
  const run = await createRun(
    db,
    f.ws,
    {
      ...f.run.input,
      selectedSources: [...f.run.input.selectedSources, ...extra],
    },
    randomUUID(),
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    run.id,
    deps(async (claim) => ({
      ...claim,
      method: "Jev",
      status: "not_addressed",
      explanation:
        "These fixture abstracts do not address the draft's specific findings.",
    })),
  );
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [run.id],
    )
  ).rows.map((row) => row.data);
  assert.equal(findings.length, 9);
  assert.ok(
    findings.some((finding) =>
      finding.claim.text.startsWith("These findings mean"),
    ),
  );
  const checks = findings.flatMap((finding) => finding.citationChecks);
  assert.equal(checks.length, 9);
  assert.equal(checks.filter((check) => check.status === "matched").length, 7);
  assert.equal(new Set(checks.flatMap((check) => check.sourceIds)).size, 4);
  assert.ok(
    findings.every(
      (finding) =>
        finding.support === "not_verified" &&
        finding.checkedPassageIds.length > 0,
    ),
  );
  const { citationPlan } = await import("../server/backend/citation-plans.js");
  const plan = await citationPlan(db, f.ws, run.id);
  assert.equal(plan.audit!.counts.occurrences, 9);
  assert.equal(plan.audit!.counts.distinctCitedWorks, 4);
  assert.equal(
    plan.audit!.bibliographyIssues.filter((issue) => issue.kind === "unused")
      .length,
    0,
  );
});

test("citation checks resolve narrative page-only and author-only references", async () => {
  for (const text of [
    "Brown reports that the treatment reduced symptoms (1).",
    "The treatment reduced symptoms (Brown).",
  ]) {
    const f = await fixture(text, [
      "The treatment reduced symptoms in the studied group.",
    ]);
    const { finding } = await checkCitations(f);
    assert.equal(finding.citation, "correct");
    assert.deepEqual(finding.citationChecks[0].sourceIds, [f.assetId]);
    assert.equal(finding.citationChecks[0].support, "supported");
  }
});

test("citation checks use titles to distinguish works by the same author", async () => {
  const f = await fixture(
    'The treatment reduced symptoms (Brown, "Other study" 1).',
    ["Recruitment methods only."],
  );
  const other = await citationSource(f, "Other study", ["Brown"]);
  const { finding } = await checkCitations(f, [other]);
  assert.equal(finding.support, "supported");
  assert.equal(finding.citation, "correct");
  assert.deepEqual(finding.citationChecks[0].sourceIds, [other.assetId]);
  assert.ok(finding.evidence.every((e: any) => e.assetId === other.assetId));
});

test("combined citations retain each source verdict in findings, links and the audit", async () => {
  const { citationPlan } = await import("../server/backend/citation-plans.js");
  for (const otherSupports of [true, false]) {
    const f = await fixture(
      "The treatment reduced symptoms (Brown 1; Green 1).",
      ["The treatment reduced symptoms in the studied group."],
    );
    const other = await citationSource(
      f,
      "Other study",
      ["Green"],
      otherSupports
        ? "The treatment reduced symptoms in the studied group."
        : "This passage describes recruitment methods without assessing treatment outcomes.",
    );
    const { run, finding } = await checkCitations(f, [other]);
    assert.equal(finding.support, "supported");
    assert.equal(
      finding.citation,
      otherSupports ? "correct" : "wrong_source",
      JSON.stringify(finding.citationChecks),
    );
    assert.deepEqual(
      finding.citationChecks.map((c: any) => [c.text, c.citation]),
      [
        ["Brown 1", "correct"],
        ["Green 1", otherSupports ? "correct" : "wrong_source"],
      ],
    );
    const link = (
      await db.query(
        "SELECT data FROM citation_links WHERE claim_id=(SELECT id FROM claims WHERE run_id=$1)",
        [run.id],
      )
    ).rows[0].data;
    assert.deepEqual(link.checks, finding.citationChecks);
    const plan = await citationPlan(db, f.ws, run.id);
    assert.deepEqual(
      plan.audit!.occurrences[0].items!.map((c: any) => c.citation),
      ["correct", otherSupports ? "correct" : "wrong_source"],
    );
    assert.equal(
      plan.operations.filter((op) => op.kind === "citation").length,
      0,
    );
  }
});

test("citation checks keep repeated references to different pages separate", async () => {
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1; Brown 2).",
    ["The treatment reduced symptoms in the studied group."],
  );
  const selection = f.run.input.selectedSources[0];
  const pageId = randomUUID();
  const text = "Recruitment methods only.";
  await db.query(
    "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label,label_status,text,status) VALUES($1,$2,$3,2,'2','confirmed',$4,'readable')",
    [pageId, f.ws, selection.extractionId, text],
  );
  await db.query(
    "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
    [randomUUID(), f.ws, selection.extractionId, pageId, text.length, text],
  );
  const { finding } = await checkCitations(f);
  assert.equal(finding.citation, "wrong_locator");
  assert.deepEqual(
    finding.citationChecks.map((c: any) => [c.locator, c.citation]),
    [
      ["1", "correct"],
      ["2", "wrong_locator"],
    ],
  );
});

test("citation page lists inspect every listed page and withhold correctness for missing pages", async () => {
  for (const missing of [false, true]) {
    const f = await fixture("The treatment reduced symptoms (Brown 1, 3).", [
      "The treatment reduced symptoms in the studied group.",
    ]);
    const selection = f.run.input.selectedSources[0];
    let passageId: string | undefined;
    if (!missing) {
      const pageId = randomUUID();
      passageId = randomUUID();
      const text = "Recruitment methods only.";
      await db.query(
        "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label,label_status,text,status) VALUES($1,$2,$3,2,'3','confirmed',$4,'readable')",
        [pageId, f.ws, selection.extractionId, text],
      );
      await db.query(
        "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
        [passageId, f.ws, selection.extractionId, pageId, text.length, text],
      );
    }
    const { finding } = await checkCitations(f);
    assert.equal(finding.citation, missing ? "ambiguous" : "correct");
    assert.equal(finding.citationChecks[0].locator, "1, 3");
    if (passageId)
      assert.ok(
        finding.citationChecks[0].checkedPassageIds.includes(passageId),
      );
  }
});

test("an incomplete cited-source assessment stays unchecked even when another cited source supports the claim", async () => {
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1; Green 1).",
    [
      "The treatment reduced symptoms in the studied group.",
      ...Array.from({ length: 5 }, () => "Recruitment methods only."),
      "Provider timeout fixture.",
    ],
  );
  const other = await citationSource(f, "Other study", ["Green"]);
  const run = await createRun(
    db,
    f.ws,
    {
      ...f.run.input,
      selectedSources: [...f.run.input.selectedSources, other],
    },
    randomUUID(),
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    run.id,
    deps(async (claim, _source, passages) => {
      const failed = passages!.some((p) => p.includes("Provider timeout"));
      const evidence = passages!.find((p) => p.includes("reduced symptoms"));
      return {
        ...claim,
        method: failed ? "unverified" : "Jev",
        status: failed ? "uncertain" : evidence ? "supported" : "not_addressed",
        evidence: failed ? undefined : evidence,
        checkedPassages: failed ? undefined : passages,
        explanation: failed
          ? "Controlled timeout."
          : "Controlled evidence assessment.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(finding.processing, "partial");
  assert.equal(finding.citation, "not_checked");
  assert.deepEqual(
    finding.citationChecks.map((c: any) => c.citation),
    ["not_checked", "correct"],
  );
});

test("conflicting evidence in another work cannot label the cited work as the wrong source", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "Recruitment methods only.",
  ]);
  const other = await citationSource(f, "Other study", ["Green"]);
  const run = await createRun(
    db,
    f.ws,
    {
      ...f.run.input,
      selectedSources: [...f.run.input.selectedSources, other],
    },
    randomUUID(),
  );
  for (let i = 1; i <= 6; i++) {
    const text =
      i === 6
        ? "The treatment increased symptoms in the studied group."
        : "Recruitment methods only.";
    await db.query(
      "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) SELECT $1,$2,$3,id,$4,$5,$6 FROM source_pages WHERE extraction_id=$3",
      [
        randomUUID(),
        f.ws,
        other.extractionId,
        i * 1000,
        i * 1000 + text.length,
        text,
      ],
    );
  }
  await processRun(
    db,
    f.blobs,
    f.ws,
    run.id,
    deps(async (claim, _source, passages) => {
      const conflict = passages!.find((p) => p.includes("increased symptoms"));
      const evidence =
        conflict || passages!.find((p) => p.includes("reduced symptoms"));
      return {
        ...claim,
        method: "Jev",
        status: conflict
          ? "contradicted"
          : evidence
            ? "supported"
            : "not_addressed",
        evidence,
        checkedPassages: passages,
        explanation: "Controlled evidence assessment.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(finding.citation, "not_checked");
  assert.equal(finding.citationChecks[0].citation, "not_checked");
});

test("ambiguous citation candidates keep all inspected passages without borrowing another citation verdict", async () => {
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1; Green 1).",
    ["The treatment reduced symptoms in the studied group."],
  );
  const otherBrown = await citationSource(f, "Another Brown study", ["Brown"]);
  const green = await citationSource(f, "Green study", ["Green"]);
  const { finding } = await checkCitations(f, [otherBrown, green]);
  assert.equal(finding.citation, "ambiguous");
  assert.equal(finding.citationChecks[0].support, "not_verified");
  assert.equal(finding.citationChecks[0].citation, "ambiguous");
  assert.equal(finding.citationChecks[1].citation, "correct");
  const assetIds = (
    await db.query(
      "SELECT DISTINCT e.asset_id FROM source_passages p JOIN extractions e ON e.id=p.extraction_id WHERE p.id=ANY($1::uuid[])",
      [finding.citationChecks[0].checkedPassageIds],
    )
  ).rows
    .map((r) => r.asset_id)
    .sort();
  assert.deepEqual(assetIds, [f.assetId, otherBrown.assetId].sort());
});

test("carrying a report after an earlier edit preserves shifted citation checks and their links", async () => {
  const { carryForward, editRegion } =
    await import("../server/backend/carry-forward.js");
  const text = "Introduction.\n\nThe treatment reduced symptoms (Brown 1).";
  const f = await fixture(text, [
    "The treatment reduced symptoms in the studied group.",
  ]);
  f.run.input.claimSpans = [
    { start: text.indexOf("The treatment"), end: text.length },
  ];
  const { finding } = await checkCitations(f);
  const after = text.replace("Introduction", "A revised introduction");
  const versionId = randomUUID();
  const carriedRun = await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO document_versions(id,workspace_id,document_id,text) SELECT $1,$2,document_id,$3 FROM document_versions WHERE id=$4",
      [versionId, f.ws, after, f.run.document_version_id],
    );
    return carryForward(
      tx,
      f.ws,
      { versionId: f.run.document_version_id, text },
      { versionId, text: after },
      editRegion(text, after),
      { kind: "edit" },
    );
  });
  assert.ok(carriedRun);
  const carried = (
    await db.query(
      "SELECT f.data,l.data AS link FROM findings f LEFT JOIN citation_links l ON l.claim_id=f.claim_id WHERE f.run_id=$1",
      [carriedRun],
    )
  ).rows[0];
  assert.equal(carried.data.citationChecks[0].start, after.indexOf("(Brown"));
  assert.equal(
    carried.data.citationChecks[0].end,
    after.indexOf("(Brown") + "(Brown 1)".length,
  );
  assert.deepEqual(carried.link.checks, carried.data.citationChecks);
  assert.equal(finding.citationChecks[0].start, text.indexOf("(Brown"));
});

test("a queued run uses its frozen source identity and publication status", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  await db.query(
    "UPDATE source_assets SET eligibility='ineligible',metadata=metadata||$3::jsonb WHERE workspace_id=$1 AND id=$2",
    [
      f.ws,
      f.assetId,
      JSON.stringify({ authors: ["Green"], publicationWarning: true }),
    ],
  );
  let calls = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, source, passages) => {
      calls++;
      assert.deepEqual(source.authors, ["Brown"]);
      assert.equal(source.publicationWarning, undefined);
      return {
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "The cited passage supports the claim.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(calls, 1);
  assert.equal(finding.citation, "correct");
  assert.equal(finding.eligibility, "eligible");
  assert.equal(
    (await ownedRun(db, f.ws, f.run.id)).config.sourceSnapshots[f.assetId]
      .metadata.authors[0],
    "Brown",
  );
});

test("contradiction without an evidence quote prevents approving a mixed cited page", async () => {
  const paragraphs = Array.from(
    { length: 7 },
    (_, i) =>
      `${i === 6 ? "CONFLICT" : "SUPPORT"} The treatment was studied in this paragraph. ${i}`,
  );
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1).",
    paragraphs,
  );
  let calls = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => {
      calls++;
      const conflict = passages!.some((p) => p.startsWith("CONFLICT"));
      return {
        ...claim,
        method: "Jev",
        status: conflict ? "contradicted" : "supported",
        ...(conflict ? {} : { evidence: passages![0] }),
        checkedPassages: passages,
        explanation: conflict
          ? "The cited page conflicts with the claim."
          : "Part of the cited page supports the claim.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(calls, 2);
  assert.equal(finding.support, "mixed");
  assert.equal(finding.citation, "not_checked");
});

test("older runs without frozen source metadata abstain instead of reading current eligibility", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  await db.query(
    "UPDATE runs SET config=config-'sourceSnapshots' WHERE id=$1",
    [f.run.id],
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async () => {
      throw new Error(
        "An old source must not be assessed against current metadata.",
      );
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(finding.support, "not_verified");
  assert.equal(finding.processing, "partial");
  assert.equal(finding.eligibility, "unknown");
  assert.ok(
    finding.explanation.some((notice: string) =>
      notice.includes("Start a new check"),
    ),
  );
});

test("automatic review checks the essay body, records skipped header spans, and retains exact provenance", async () => {
  const text =
    "Jane Smith\nIoanna Mavridou\n4G2 English\n14 January 2026\n\nThe trial included 218 adults (Brown 1).\nJohn was born on the Reservation (Brown 1).";
  const f = await fixture(
    text,
    ["The trial included 218 adults. John was born on the Reservation."],
    true,
  );
  const assessed: string[] = [];
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim) => {
      assessed.push(claim.text);
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        explanation: "Synthetic matching passage.",
        evidence:
          "The trial included 218 adults. John was born on the Reservation.",
      };
    }),
  );
  assert.equal(assessed.length, 2);
  assert.ok(
    assessed.every((c) => !c.includes("Jane Smith") && !c.includes("English")),
  );
  const run = await ownedRun(db, f.ws, f.run.id);
  assert.equal(run.coverage.totalClaims, 2);
  assert.equal(run.coverage.completedClaims, 2);
  assert.equal(run.coverage.skippedSpans.length, 4);
  assert.equal(run.config.claimSelection, "proof-claims-6");
  const findings = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows;
  assert.equal(findings.length, 2);
  for (const { data } of findings)
    assert.equal(text.slice(data.claim.start, data.claim.end), data.claim.text);
});

test("metadata-only review finishes without provider calls or supported findings", async () => {
  const f = await fixture(
    "Jane Smith\n4G2 English\n14 January 2026",
    ["A valid source passage long enough to be indexed for the fixture."],
    true,
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async () => {
      throw Error("Metadata must not be assessed");
    }),
  );
  const run = await ownedRun(db, f.ws, f.run.id);
  assert.equal(run.status, "complete");
  assert.equal(run.coverage.totalClaims, 0);
  assert.equal(run.coverage.completedClaims, 0);
  assert.equal(run.coverage.skippedSpans.length, 3);
  assert.equal(
    (await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id]))
      .rows.length,
    0,
  );
});

test("selected evidence avoids research and reuses its assessment in the final finding", async () => {
  const f = await fixture("The trial included 218 adults.", [
    "The trial included 218 adults.",
  ]);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      ...f.run.input,
      mode: "fact_check",
      externalAccess: "research",
      sourcePolicy: "matched",
    }),
    randomUUID(),
  );
  let judgments = 0,
    searches = 0;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async () => {
      searches++;
      return noResearch();
    },
    judge: async (claim, _source, passages) => {
      judgments++;
      return {
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Controlled agreement fixture.",
      };
    },
  });
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(searches, 0);
  assert.equal(judgments, 1);
  assert.equal(finding.support, "supported");
  assert.equal(finding.basis, "supplied_text");
  assert.equal(finding.evidence[0].text, "The trial included 218 adults.");
});

test("related claims share research but keep separate evidence judgments and original offsets", async () => {
  const text =
    "Tutoring improves adult reading scores. Tutoring does not improve adult reading scores.";
  const f = await fixture(text, [text], true);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      documentVersionId: f.run.document_version_id,
      mode: "fact_check",
      externalAccess: "research",
      sourcePolicy: "matched",
      allowProviderProcessing: true,
    }),
    randomUUID(),
  );
  const queries = new Set<string>();
  let judgments = 0;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async (_db, _blobs, _ws, _id, query) => {
      queries.add(query);
      return {
        selections: f.run.input.selectedSources,
        candidates: [],
        notices: [],
      };
    },
    judge: async (claim, _source, passages) => {
      judgments++;
      return {
        ...claim,
        method: "Jev",
        status: claim.text.includes("not") ? "contradicted" : "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Controlled opposite-direction fixture.",
      };
    },
  });
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [run.id],
    )
  ).rows.map((r) => r.data);
  assert.equal(queries.size, 1);
  assert.equal(judgments, 2);
  assert.deepEqual(
    findings.map((f) => f.support),
    ["supported", "contradicted"],
  );
  assert.notEqual(findings[0].claim.start, findings[1].claim.start);
  for (const f of findings)
    assert.equal(text.slice(f.claim.start, f.claim.end), f.claim.text);
});

test("personal and literary claims without original text never enter public search", async () => {
  const text =
    "I visited Prague last summer. The moon symbolizes isolation in this poem.";
  const f = await fixture(
    text,
    ["Unrelated source passage for this fixture."],
    true,
  );
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      documentVersionId: f.run.document_version_id,
      mode: "fact_check",
      externalAccess: "research",
      sourcePolicy: "matched",
      allowProviderProcessing: true,
    }),
    randomUUID(),
  );
  let searches = 0;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async () => {
      searches++;
      return noResearch();
    },
    judge: async () => {
      throw Error("No source text is available.");
    },
  });
  assert.equal(searches, 0);
  const findings = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows.map((r) => r.data);
  assert.equal(findings.length, 2);
  assert.ok(
    findings.every(
      (f) => f.support === "not_verified" && f.evidence.length === 0,
    ),
  );
});

for (const gap of ["abstract", "partial"])
  test(`${gap} supplied evidence never suppresses external research`, async () => {
    const f = await fixture(
      "The trial included 218 adults.",
      ["The trial included 218 adults."],
      true,
    );
    const source = f.run.input.selectedSources[0];
    if (gap === "abstract")
      await db.query("UPDATE source_assets SET access='abstract' WHERE id=$1", [
        source.assetId,
      ]);
    else
      await db.query(
        "UPDATE extractions SET status='partial',coverage=coverage||'{\"unreadablePages\":[2]}'::jsonb WHERE id=$1",
        [source.extractionId],
      );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        ...f.run.input,
        mode: "fact_check",
        externalAccess: "research",
        sourcePolicy: "matched",
      }),
      randomUUID(),
    );
    let searches = 0;
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async () => {
        searches++;
        return noResearch();
      },
      judge: async (claim, _source, passages) => ({
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Controlled agreement with limited source.",
      }),
    });
    assert.equal(searches, 1);
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.notEqual(finding.support, "supported");
  });

for (const lateStatus of ["contradicted", "uncertain"] as const)
  test(`academic reading includes low-ranked later sections and withholds approval for ${lateStatus} evidence`, async () => {
    const claim = "The treatment reduced symptoms.";
    const f = await fixture(claim, [claim], true);
    const source = f.run.input.selectedSources[0];
    // Put each section on its own physical page so adjacency cannot rescue an
    // omitted, low-ranked limitation after the top ten retrieval results.
    for (let index = 2; index <= 13; index++) {
      const page = randomUUID();
      const text =
        index === 13
          ? "LATE LIMITATION: uncertainty and adverse outcomes were reported."
          : `${claim} Measured section ${index}.`;
      await db.query(
        "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label_status,status,text) VALUES($1,$2,$3,$4,'unknown','native',$5)",
        [page, f.ws, source.extractionId, index, text],
      );
      await db.query(
        "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
        [randomUUID(), f.ws, source.extractionId, page, text.length, text],
      );
    }
    await db.query(
      "UPDATE extractions SET coverage=coverage||'{\"totalPages\":13}'::jsonb WHERE id=$1",
      [source.extractionId],
    );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        ...f.run.input,
        mode: "fact_check",
        externalAccess: "research",
        sourcePolicy: "academic",
      }),
      randomUUID(),
    );
    const inspected = new Set<string>();
    let searched = 0;
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async () => {
        searched++;
        return noResearch();
      },
      judge: async (claim, _source, passages) => {
        passages!.forEach((p) => inspected.add(p));
        return {
          ...claim,
          method: "Jev",
          status: passages!.some((p) => p.startsWith("LATE LIMITATION"))
            ? lateStatus
            : "supported",
          evidence: passages![0],
          checkedPassages: passages,
          explanation: "Controlled whole-article fixture.",
        };
      },
    });
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(inspected.size, 13);
    assert.equal(searched, 1);
    assert.notEqual(finding.support, "supported");
    assert.equal(finding.fix, undefined);
    assert.equal(finding.checkedPassageIds.length, 13);
  });

for (const [sourcePolicy, expectedRoute] of [
  ["public", "public"],
  ["academic", "academic"],
  ["matched", "authoritative"],
] as const)
  test(`${sourcePolicy} scope routes a public fact to ${expectedRoute} discovery`, async () => {
    const f = await fixture(
      "Paris is the capital of France.",
      ["Paris is the capital of France."],
      true,
    );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        documentVersionId: f.run.document_version_id,
        mode: "fact_check",
        externalAccess: "research",
        sourcePolicy,
        allowProviderProcessing: true,
      }),
      randomUUID(),
    );
    let actualRoute: string | undefined;
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async (
        _db,
        _blobs,
        _ws,
        _run,
        _query,
        _mode,
        _limit,
        route,
      ) => {
        actualRoute = route;
        return {
          selections: f.run.input.selectedSources,
          candidates: [],
          notices: [],
        };
      },
      judge: async (claim, _source, passages) => ({
        ...claim,
        method: "Jev",
        status: "supported",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Controlled exact source support.",
      }),
    });
    assert.equal(actualRoute, expectedRoute);
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(finding.support, "supported");
    assert.equal(
      finding.basis,
      sourcePolicy === "academic" ? "academic_research" : "public_sources",
    );
  });
for (const sourcePolicy of ["academic", "public"] as const)
  test(`${sourcePolicy} scope never sends personal or original-work claims to public discovery`, async () => {
    const f = await fixture(
      "I visited Prague last summer. The moon symbolizes isolation in this poem.",
      ["Unrelated controlled source text."],
      true,
    );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        documentVersionId: f.run.document_version_id,
        mode: "fact_check",
        externalAccess: "research",
        sourcePolicy,
        allowProviderProcessing: true,
      }),
      randomUUID(),
    );
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async () => {
        throw Error(
          "This private or original-work claim must not be sent to discovery.",
        );
      },
      judge: async () => {
        throw Error("No selected evidence was supplied.");
      },
    });
    const findings = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows;
    assert.equal(findings.length, 2);
    assert.ok(
      findings.every(
        (row) =>
          row.data.support === "not_verified" &&
          row.data.basis === "supplied_text",
      ),
    );
  });
test("All sources keeps scientific eligibility requirements for selected material", async () => {
  const f = await fixture(
    "The trial reduced patient symptoms.",
    ["The trial reduced patient symptoms."],
    true,
  );
  await db.query("UPDATE source_assets SET eligibility='unknown' WHERE id=$1", [
    f.assetId,
  ]);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      ...f.run.input,
      mode: "fact_check",
      externalAccess: "research",
      sourcePolicy: "public",
    }),
    randomUUID(),
  );
  let route: string | undefined;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async (
      _db,
      _blobs,
      _ws,
      _run,
      _query,
      _mode,
      _limit,
      selectedRoute,
    ) => {
      route = selectedRoute;
      return noResearch();
    },
    judge: async () => {
      throw Error(
        "Ineligible scientific evidence cannot be assessed as academic support.",
      );
    },
  });
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(route, "academic");
  assert.equal(finding.support, "not_verified");
  assert.equal(finding.evidenceGap, "source_requirements");
  assert.equal(finding.fix, undefined);
});

for (const lateStatus of ["contradicted", "uncertain"] as const)
  test(`public inspection keeps a low-ranked later ${lateStatus} section`, async () => {
    const claim = "Paris is the capital of France.";
    const f = await fixture(claim, [claim], true);
    const source = f.run.input.selectedSources[0];
    await db.query(
      "UPDATE source_assets SET eligibility='unknown' WHERE id=$1",
      [f.assetId],
    );
    for (let index = 2; index <= 13; index++) {
      const page = randomUUID();
      const text =
        index === 13
          ? "LATE QUALIFICATION: this public source disagrees with the claim."
          : `${claim} Background section ${index}.`;
      await db.query(
        "INSERT INTO source_pages(id,workspace_id,extraction_id,page_index,label_status,status,text) VALUES($1,$2,$3,$4,'unknown','native',$5)",
        [page, f.ws, source.extractionId, index, text],
      );
      await db.query(
        "INSERT INTO source_passages(id,workspace_id,extraction_id,page_id,start_offset,end_offset,text) VALUES($1,$2,$3,$4,0,$5,$6)",
        [randomUUID(), f.ws, source.extractionId, page, text.length, text],
      );
    }
    await db.query(
      "UPDATE extractions SET coverage=coverage||'{\"totalPages\":13}'::jsonb WHERE id=$1",
      [source.extractionId],
    );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        ...f.run.input,
        mode: "fact_check",
        externalAccess: "research",
        sourcePolicy: "public",
      }),
      randomUUID(),
    );
    const inspected = new Set<string>();
    let searches = 0,
      judgments = 0;
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async () => {
        searches++;
        return noResearch();
      },
      judge: async (claim, _source, passages) => {
        judgments++;
        passages!.forEach((text) => inspected.add(text));
        return {
          ...claim,
          status: passages!.some((text) =>
            text.startsWith("LATE QUALIFICATION"),
          )
            ? lateStatus
            : "supported",
          method: "Jev",
          evidence: passages![0],
          checkedPassages: passages,
          explanation: "Controlled complete public source fixture.",
        };
      },
    });
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(inspected.size, 13);
    assert.equal(
      judgments,
      3,
      "the final result reuses all three source-first assessment packets",
    );
    assert.equal(
      searches,
      1,
      "a qualification cannot suppress the permitted follow-up search",
    );
    assert.notEqual(finding.support, "supported");
    assert.equal(finding.fix, undefined);
    assert.equal(finding.checkedPassageIds.length, 13);
  });

test("every assessment adapter needs an exact evidence passage before suppressing research or approving support", async () => {
  const f = await fixture(
    "Paris is the capital of France.",
    ["Paris is the capital of France."],
    true,
  );
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      ...f.run.input,
      mode: "fact_check",
      externalAccess: "research",
      sourcePolicy: "public",
    }),
    randomUUID(),
  );
  let judgments = 0,
    searches = 0;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async () => {
      searches++;
      return noResearch();
    },
    judge: async (claim) => {
      judgments++;
      return {
        ...claim,
        method: "Jev",
        status: "supported",
        explanation: "Adapter claimed support without a source passage.",
        fix: "An unsupported automatic edit.",
      };
    },
  });
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
  ).rows[0].data;
  const assessment = (
    await db.query("SELECT data FROM assessments WHERE run_id=$1", [run.id])
  ).rows[0].data;
  assert.equal(judgments, 1, "the abstaining assessment is safely reused");
  assert.equal(
    searches,
    1,
    "unsupported adapter output cannot suppress research",
  );
  assert.equal(assessment.status, "uncertain");
  assert.equal(assessment.fix, undefined);
  assert.equal(finding.support, "not_verified");
  assert.equal(finding.evidence.length, 0);
  assert.equal(finding.fix, undefined);
  assert.ok(
    finding.explanation.some((text: string) =>
      text.includes("exact assessed source passage"),
    ),
  );
});

for (const mode of ["source_check", "discover"] as const)
  test(`${mode} citation workflow keeps uncited common knowledge without assessing accuracy or making provider calls`, async () => {
    const text = "A triangle has three sides.";
    const f = await fixture(
      text,
      ["A triangle has three sides. A square has four sides."],
      true,
    );
    const run =
      mode === "source_check"
        ? f.run
        : await createRun(
            db,
            f.ws,
            runInput.parse({
              ...f.run.input,
              mode,
              citationOutput: "generate",
              sourcePolicy: "public",
              externalAccess: "research",
            }),
            randomUUID(),
          );
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: async () => {
        throw Error("Reference resolution was not requested.");
      },
      research: async () => {
        throw Error("An uncited common fact cannot trigger citation research.");
      },
      judge: async () => {
        throw Error(
          "Factual accuracy is outside this citation-only exemption.",
        );
      },
    });
    const savedRun = await ownedRun(db, f.ws, run.id);
    if (mode === "source_check") {
      assert.equal(savedRun.status, "complete");
      assert.equal(savedRun.coverage.totalClaims, 0);
      assert.equal(savedRun.coverage.completedClaims, 0);
      assert.equal(savedRun.coverage.excludedSpans.length, 1);
      assert.equal(
        (await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id]))
          .rows.length,
        0,
      );
      return;
    }
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    const claim = (
      await db.query("SELECT data FROM claims WHERE run_id=$1", [run.id])
    ).rows[0].data;
    const links = (
      await db.query(
        "SELECT data FROM citation_links WHERE claim_id IN (SELECT id FROM claims WHERE run_id=$1)",
        [run.id],
      )
    ).rows;
    assert.equal(savedRun.status, "complete");
    assert.equal(savedRun.coverage.totalClaims, 1);
    assert.equal(savedRun.coverage.completedClaims, 1);
    assert.equal(claim.citationRequirement, "common_knowledge");
    assert.equal(finding.claim.citationRequirement, "common_knowledge");
    assert.equal(finding.support, "not_verified");
    assert.equal(finding.citation, "not_required");
    assert.equal(finding.processing, "complete");
    assert.equal(finding.evidenceGap, undefined);
    assert.deepEqual(finding.evidence, []);
    assert.equal(finding.fix, undefined);
    assert.deepEqual(finding.explanation, [
      "Common knowledge does not require a citation. Factual accuracy was not assessed in this citation workflow.",
    ]);
    assert.equal(links[0].data.status, "not_required");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM assessments WHERE run_id=$1",
          [run.id],
        )
      ).rows[0].n,
      0,
    );
  });
test("common-knowledge exemptions do not override an explicit bibliography resolution request", async () => {
  const text = "Paris is the capital of France.";
  const f = await fixture(text, [text], true);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      ...f.run.input,
      externalAccess: "resolve_selected_references",
    }),
    randomUUID(),
  );
  let resolutions = 0;
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: async () => {
      resolutions++;
      return noResearch();
    },
    research: async () => {
      throw Error("Source checks cannot perform new-source discovery.");
    },
    judge: async () => {
      throw Error(
        "The uncited common claim is exempt from citation evidence assessment.",
      );
    },
  });
  assert.equal(resolutions, 1);
  assert.equal(
    (await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])).rows
      .length,
    0,
  );
});
for (const mode of ["fact_check", "discover"] as const)
  test(`${mode} general research still checks the accuracy of selected common facts`, async () => {
    const text = "A triangle has three sides.";
    const f = await fixture(
      text,
      ["A triangle has three sides. A square has four sides."],
      true,
    );
    const run = await createRun(
      db,
      f.ws,
      runInput.parse({
        documentVersionId: f.run.document_version_id,
        mode,
        sourcePolicy: "public",
        externalAccess: "research",
        allowProviderProcessing: true,
      }),
      randomUUID(),
    );
    let searches = 0,
      judgments = 0;
    await processRun(db, f.blobs, f.ws, run.id, {
      resolveReferences: noResearch,
      research: async () => {
        searches++;
        return {
          selections: f.run.input.selectedSources,
          candidates: [],
          notices: [],
        };
      },
      judge: async (claim, _source, passages) => {
        judgments++;
        return {
          ...claim,
          status: "supported",
          method: "Jev",
          evidence: passages![0],
          checkedPassages: passages,
          explanation: "Accuracy was actually checked against this source.",
        };
      },
    });
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])
    ).rows[0].data;
    assert.equal(searches, 1);
    assert.equal(judgments, 1);
    assert.equal(finding.support, "supported");
    assert.equal(finding.citation, "not_required");
    assert.ok(finding.evidence.length > 0);
    assert.equal(finding.fix, undefined);
  });
test("existing citations on common facts are still assessed without creating citation requirements", async () => {
  const f = await fixture(
    "Paris is the capital of France (Brown 1).",
    ["Paris is the capital of France."],
    true,
  );
  let judgments = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => {
      judgments++;
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Existing cited passage matches the fact.",
      };
    }),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(judgments, 1);
  assert.equal(finding.support, "supported");
  assert.equal(finding.citation, "not_required");
  assert.ok(
    finding.explanation.some((message: string) =>
      message.includes("existing citation was assessed as correct"),
    ),
  );
  assert.equal(finding.fix, undefined);
});
test("requiring a citation manually does not bring an uncited claim into citation checking", async () => {
  const text = "Paris is the capital of France.";
  const f = await fixture(text, [text], true);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      ...f.run.input,
      claimSpans: [
        { start: 0, end: text.length, citationRequirement: "required" },
      ],
    }),
    randomUUID(),
  );
  let judgments = 0;
  await processRun(
    db,
    f.blobs,
    f.ws,
    run.id,
    deps(async (claim, _source, passages) => {
      judgments++;
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Explicitly requested citation evidence was assessed.",
      };
    }),
  );
  assert.equal(judgments, 0);
  assert.equal(
    (await db.query("SELECT data FROM findings WHERE run_id=$1", [run.id])).rows
      .length,
    0,
  );
});
test("mixed citation generation excludes common facts from shared research queries", async () => {
  const text =
    "Paris is the capital of France.\n\nThe trial included 218 adults.";
  const f = await fixture(text, ["The trial included 218 adults."], true);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      documentVersionId: f.run.document_version_id,
      mode: "discover",
      citationOutput: "generate",
      sourcePolicy: "public",
      externalAccess: "research",
      allowProviderProcessing: true,
    }),
    randomUUID(),
  );
  const queries: string[] = [];
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async (_db, _store, _ws, _run, query) => {
      queries.push(query);
      return {
        selections: f.run.input.selectedSources,
        candidates: [],
        notices: [],
      };
    },
    judge: async (claim, _source, passages) => ({
      ...claim,
      status: "supported",
      method: "Jev",
      evidence: passages![0],
      checkedPassages: passages,
      explanation: "This specialized trial result requires evidence.",
    }),
  });
  assert.deepEqual(queries, ["The trial included 218 adults."]);
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [run.id],
    )
  ).rows.map((row) => row.data);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].citation, "not_required");
  assert.equal(findings[0].support, "not_verified");
  assert.equal(findings[1].claim.citationRequirement, "required");
  assert.equal(findings[1].support, "supported");
});

test("an existing common-knowledge citation without supplied text cannot trigger citation-generation research", async () => {
  const text =
    "Paris is the capital of France (Brown 1).\n\nThe trial included 218 adults.";
  const f = await fixture(text, ["The trial included 218 adults."], true);
  const run = await createRun(
    db,
    f.ws,
    runInput.parse({
      documentVersionId: f.run.document_version_id,
      mode: "discover",
      citationOutput: "generate",
      sourcePolicy: "public",
      externalAccess: "research",
      allowProviderProcessing: true,
    }),
    randomUUID(),
  );
  const queries: string[] = [];
  await processRun(db, f.blobs, f.ws, run.id, {
    resolveReferences: noResearch,
    research: async (_db, _store, _ws, _run, query) => {
      queries.push(query);
      return noResearch();
    },
    judge: async () => {
      throw Error("There is no supplied source text to assess.");
    },
  });
  assert.deepEqual(queries, ["The trial included 218 adults."]);
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [run.id],
    )
  ).rows.map((row) => row.data);
  assert.equal(findings[0].citation, "not_required");
  assert.equal(findings[0].support, "not_verified");
  assert.equal(findings[0].processing, "complete");
  assert.equal(findings[0].evidenceGap, undefined);
  assert.equal(findings[0].fix, undefined);
});

test("an uploaded Works Cited list matches citations without becoming evidence or spending judgment calls", async () => {
  const { citationPlan } = await import("../server/backend/citation-plans.js");
  const bibliography = `Works Cited\n\nBrown, Maria, and Fabio Green. “The Act of 2017: A Study?” Space Policy, vol. 47, Feb. 2019, pp. 1–6.\n\nJones, Jason. “A Treaty Turns 50.” ABA\nJournal, Apr. 2017, p. 1.\n\nLee, Yong Bum. “Public Space, Private Patents.” Harvard Journal of Law & Technology, vol. 33, no. 1, Fall 2019.\n\nSmith, Alexander P. “Updating the Liability Regime\nin Outer Space.” William & Mary Law Review, 2020.`;
  const text =
    "A second space race involves private firms (Smith 15). The firms supply the station (Smith 18). The U.S. therefore supports scientific development (Lee 8). The U.S. It also adjusts regulation (Brown and Green 8). The bill increases agency budgets (Jones 14).";
  const f = await fixture(text, [bibliography], true);
  assert.equal(f.run.config.references.length, 4);
  assert.deepEqual(f.run.input.selectedSources, []);
  assert.deepEqual(f.run.config.bibliographyAssets, [f.assetId]);
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async () => {
      throw Error("A bibliography must not be sent for evidence judgment.");
    }),
  );
  const findings = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows.map((r) => r.data);
  assert.ok(findings.length >= 5);
  assert.ok(
    findings.every(
      (f) =>
        f.support === "not_verified" &&
        f.evidenceGap === "source_unavailable" &&
        !f.fix,
    ),
  );
  assert.ok(findings.every((f) => !f.evidence.length));
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.audit?.counts.occurrences, 5);
  assert.equal(plan.audit?.counts.distinctCitedWorks, 4);
  assert.equal(plan.audit?.counts.bibliographyEntries, 4);
  assert.ok(plan.audit?.occurrences.every((o) => o.status === "matched"));
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.previewText, text);
  assert.equal((await ownedRun(db, f.ws, f.run.id)).status, "partial");
  assert.equal(
    (await ownedRun(db, f.ws, f.run.id)).coverage.unresolvedReferences.length,
    4,
  );
});

for (const access of ["abstract", "metadata", "unavailable"])
  test(`selected-reference retrieval upgrades an existing ${access} asset and checks its new text`, async () => {
    const { resolveSelectedReferences } =
      await import("../server/backend/research.js");
    const uncited = "The treatment reduced symptoms.";
    const text = `${uncited} The treatment reduced symptoms (Brown 2024).`;
    const f = await fixture(text, [
      "Only a summary of the study is available here.",
    ]);
    const metadata = {
      title: "Controlled study",
      authors: ["Brown"],
      authorDetails: [{ family: "Brown", given: "Maria" }],
      year: "2024",
      doi: "10.1234/upgrade",
      ...(access === "abstract"
        ? {
            assetKind: "retrieved_text_snapshot",
            textFingerprint: "cached-abstract",
            retrievedAt: new Date().toISOString(),
          }
        : {}),
    };
    await db.query(
      "UPDATE source_assets SET access=$2,metadata=$3 WHERE id=$1",
      [f.assetId, access, JSON.stringify(metadata)],
    );
    const config = structuredClone(f.run.config);
    config.sourceSnapshots[f.assetId] = {
      ...config.sourceSnapshots[f.assetId],
      metadata,
      access,
    };
    config.references = [
      {
        id: randomUUID(),
        asset_id: f.assetId,
        parsed: metadata,
        status: access === "abstract" ? "matched_ready" : "matched_needs_pdf",
        candidates: [],
      },
    ];
    const input = {
      ...f.run.input,
      externalAccess: "resolve_selected_references",
      claimSpans: [
        { start: 0, end: uncited.length },
        { start: uncited.length + 1, end: text.length },
      ],
    };
    if (access !== "abstract") {
      input.selectedSources = [];
      await db.query(
        "UPDATE source_assets SET status='unavailable' WHERE id=$1",
        [f.assetId],
      );
    }
    await db.query("UPDATE runs SET input=$2,config=$3 WHERE id=$1", [
      f.run.id,
      JSON.stringify(input),
      JSON.stringify(config),
    ]);
    const fetch = mock.method(globalThis, "fetch", async (url: any) => {
      if (String(url).includes("api.crossref.org/works/"))
        return Response.json({
          message: {
            DOI: metadata.doi,
            type: "journal-article",
            title: [metadata.title],
            author: [{ family: "Brown", given: "Maria" }],
            published: { "date-parts": [[2024]] },
            "container-title": ["Evidence Journal"],
            volume: "4",
            issue: "2",
            page: "21-28",
          },
        });
      if (String(url).includes("/search?"))
        return Response.json({
          resultList: {
            result: [
              {
                doi: metadata.doi,
                pmcid: "PMC123456",
                isOpenAccess: "Y",
              },
            ],
          },
        });
      assert.match(String(url), /PMC123456\/fullTextXML$/);
      return new Response(
        "<article><body><p>The treatment reduced symptoms in the studied group.</p></body></article>",
      );
    });
    try {
      await processRun(db, f.blobs, f.ws, f.run.id, {
        research: noResearch,
        resolveReferences: resolveSelectedReferences,
        judge: async (claim, _source, passages) => ({
          ...claim,
          status: "supported",
          method: "Jev",
          evidence: passages![0],
          checkedPassages: passages,
          explanation: "Controlled full-text evidence.",
        }),
      });
      const run = await ownedRun(db, f.ws, f.run.id);
      const ref = run.config.references[0];
      assert.ok(
        ref.resolvedAssetId,
        "The placeholder must not suppress retrieval.",
      );
      assert.notEqual(ref.resolvedAssetId, f.assetId);
      assert.equal(ref.access, "full_text");
      assert.deepEqual(run.coverage.unresolvedReferences, []);
      const findings = (
        await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
      ).rows.map((r) => r.data);
      assert.equal(findings.length, 1);
      assert.ok(findings.every((finding) => finding.support === "supported"));
      const finding = findings.find(
        (finding) => finding.citationChecks.length,
      )!;
      assert.equal(finding.support, "supported");
      assert.equal(finding.citation, "correct");
      assert.deepEqual(finding.citationChecks[0].sourceIds, [
        ref.resolvedAssetId,
      ]);
      assert.ok(finding.evidence.every((e: any) => e.assetId !== f.assetId));
    } finally {
      fetch.mock.restore();
    }
  });

test("readable uploaded references are reused without external provider calls", async () => {
  const { resolveSelectedReferences } =
    await import("../server/backend/research.js");
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  const config = structuredClone(f.run.config);
  config.references = [
    {
      id: randomUUID(),
      asset_id: f.assetId,
      status: "matched_ready",
      parsed: { title: "Controlled study", authors: ["Brown"], year: "2024" },
    },
  ];
  await db.query(
    "UPDATE runs SET input=jsonb_set(input,'{externalAccess}','\"resolve_selected_references\"'),config=$2 WHERE id=$1",
    [f.run.id, JSON.stringify(config)],
  );
  const fetch = mock.method(globalThis, "fetch", async () => {
    throw new Error("Uploaded full text must not trigger retrieval.");
  });
  try {
    await processRun(db, f.blobs, f.ws, f.run.id, {
      ...deps(async (claim, _source, passages) => ({
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Uploaded evidence.",
      })),
      resolveReferences: resolveSelectedReferences,
    });
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
    ).rows[0].data;
    assert.equal(finding.support, "supported");
    assert.deepEqual(finding.citationChecks[0].sourceIds, [f.assetId]);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    fetch.mock.restore();
  }
});

test("an identified bibliography source without text is an access gap, not an unmatched work", async () => {
  const { citationPlan } = await import("../server/backend/citation-plans.js");
  const entry =
    "Brown, M. (2024). Controlled study. Evidence Journal. https://doi.org/10.1234/identified";
  const f = await fixture(
    `The treatment reduced symptoms (Brown 2024).\n\nReferences\n${entry}`,
    ["Only a summary of the study is available here."],
    true,
  );
  const config = structuredClone(f.run.config);
  config.references = [
    {
      id: randomUUID(),
      asset_id: f.assetId,
      status: "matched_needs_pdf",
      parsed: {
        title: "Controlled study",
        authors: ["Brown"],
        year: "2024",
        doi: "10.1234/identified",
      },
    },
  ];
  await db.query(
    "UPDATE source_assets SET status='unavailable',access='metadata' WHERE id=$1",
    [f.assetId],
  );
  await db.query(
    "UPDATE runs SET input=jsonb_set(input,'{selectedSources}','[]'),config=$2 WHERE id=$1",
    [f.run.id, JSON.stringify(config)],
  );
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async () => {
      throw new Error("Unavailable text cannot establish evidence.");
    }),
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.ok(
    plan.audit?.bibliographyIssues.some((i) => i.kind === "source_access"),
  );
  assert.ok(
    !plan.audit?.bibliographyIssues.some((i) => i.kind === "unmatched"),
  );
  assert.equal(plan.bibliography.entries[0].referenceId, f.assetId);
  assert.equal(plan.operations.length, 0);
});

test("abstract support is assessed but cannot confirm a printed-page locator", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 1).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  const config = structuredClone(f.run.config);
  config.sourceSnapshots[f.assetId].access = "abstract";
  await db.query("UPDATE runs SET config=$2 WHERE id=$1", [
    f.run.id,
    JSON.stringify(config),
  ]);
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => ({
      ...claim,
      status: "supported",
      method: "Jev",
      evidence: passages![0],
      explanation: "The abstract supports this narrowly scoped finding.",
    })),
  );
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(finding.support, "supported");
  assert.equal(finding.citation, "ambiguous");
  assert.equal(finding.fix, undefined);
  assert.ok(
    finding.explanation.some((x: string) => x.includes("Abstract available")),
  );
});

test("indexed abstracts resolve bibliography identity and retain their evidence provenance", async () => {
  const f = await fixture("The treatment reduced symptoms (Brown 2024).", [
    "The treatment reduced symptoms in the studied group.",
  ]);
  const config = structuredClone(f.run.config);
  config.sourceSnapshots[f.assetId].access = "abstract";
  config.references = [
    {
      id: randomUUID(),
      asset_id: f.assetId,
      status: "matched_ready",
      parsed: { title: "Controlled study", authors: ["Brown"], year: "2024" },
    },
  ];
  await db.query("UPDATE runs SET config=$2 WHERE id=$1", [
    f.run.id,
    JSON.stringify(config),
  ]);
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => ({
      ...claim,
      status: "supported",
      method: "Jev",
      evidence: passages![0],
      explanation: "The abstract directly supports the result.",
    })),
  );
  const run = await ownedRun(db, f.ws, f.run.id);
  assert.equal(run.status, "complete");
  assert.deepEqual(run.coverage.unresolvedReferences, []);
});

test("selected-reference snapshots are reused without searches and author mismatches stay visible", async () => {
  const { resolveSelectedReferences } =
    await import("../server/backend/research.js");
  const { checksum } = await import("../server/backend/library.js");
  const f = await fixture(
    "The treatment reduced symptoms (Brown 1).",
    [
      "Works Cited\nBrown, Maria. “Private Space Operations.” Example Journal, 2020.",
    ],
    true,
  );
  const ref = f.run.config.references[0];
  const body = Buffer.from(
    "Private Space Operations.\nThe treatment reduced symptoms in the studied group.",
  );
  const metadata = {
    title: ref.parsed.title,
    authors: ["Maria Green"],
    authorDetails: [{ given: "Maria", family: "Green" }],
    year: "2020",
    url: "https://example.edu/source.pdf",
    referenceFingerprint: checksum(JSON.stringify(ref.parsed)),
    textFingerprint: checksum(body),
    assetKind: "retrieved_text_snapshot",
  };
  const cached = await createAsset(
    db,
    f.ws,
    metadata,
    "cached.txt",
    "text/plain",
    body.length,
  );
  await f.blobs.put(cached.key, body, "text/plain");
  const extractionId = await ingestAsset(db, f.blobs, f.ws, cached.id);
  await db.query("UPDATE source_assets SET access='full_text' WHERE id=$1", [
    cached.id,
  ]);
  await db.query(
    "UPDATE source_pages SET label='1',label_status='confirmed' WHERE extraction_id=$1",
    [extractionId],
  );
  await db.query(
    "UPDATE runs SET input=jsonb_set(input,'{externalAccess}','\"resolve_selected_references\"') WHERE id=$1",
    [f.run.id],
  );
  let judgments = 0;
  await processRun(db, f.blobs, f.ws, f.run.id, {
    research: noResearch,
    resolveReferences: resolveSelectedReferences,
    judge: async (claim, source, passages) => {
      judgments++;
      assert.deepEqual(source.authors, ["Maria Green"]);
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Controlled full-text evidence.",
      };
    },
  });
  const run = await ownedRun(db, f.ws, f.run.id);
  assert.equal(run.config.references[0].resolvedAssetId, cached.id);
  assert.ok(
    run.config.references[0].identityWarnings.some((w: string) =>
      w.includes("Green"),
    ),
  );
  assert.ok(judgments > 0);
  const finding = (
    await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
  ).rows[0].data;
  assert.equal(finding.support, "supported");
  assert.equal(finding.citation, "wrong_source");
  assert.ok(finding.explanation.some((w: string) => w.includes("Green")));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM provider_calls WHERE run_id=$1",
        [f.run.id],
      )
    ).rows[0].n,
    0,
  );
});

test("cited-first checks skip alternative judgments only after inspected support", async () => {
  for (const citedSupports of [true, false]) {
    const f = await fixture("The treatment reduced symptoms (Brown 1).", [
      "The treatment reduced symptoms in the studied group.",
    ]);
    const body = Buffer.from(
      "The treatment reduced symptoms in the studied group.",
    );
    const metadata = { title: "Other work", authors: ["Green"], year: "2024" };
    const alternative = await createAsset(
      db,
      f.ws,
      metadata,
      "other.txt",
      "text/plain",
      body.length,
    );
    await f.blobs.put(alternative.key, body, "text/plain");
    const extractionId = await ingestAsset(db, f.blobs, f.ws, alternative.id);
    const input = {
      ...f.run.input,
      selectedSources: [
        { assetId: alternative.id, extractionId, pageRanges: [] },
        ...f.run.input.selectedSources,
      ],
    };
    const config = structuredClone(f.run.config);
    const row = (
      await db.query("SELECT * FROM source_assets WHERE id=$1", [
        alternative.id,
      ])
    ).rows[0];
    config.sourceSnapshots[alternative.id] = {
      metadata: row.metadata,
      eligibility: row.eligibility,
      access: row.access,
      created_at: row.created_at,
    };
    await db.query("UPDATE runs SET input=$2,config=$3 WHERE id=$1", [
      f.run.id,
      JSON.stringify(input),
      JSON.stringify(config),
    ]);
    const judged: string[] = [];
    await processRun(
      db,
      f.blobs,
      f.ws,
      f.run.id,
      deps(async (claim, source, passages) => {
        judged.push(source.id);
        const supports = source.id !== f.assetId || citedSupports;
        return {
          ...claim,
          status: supports ? "supported" : "not_addressed",
          method: "Jev",
          evidence: supports ? passages![0] : undefined,
          checkedPassages: passages,
          explanation: "Controlled source assessment.",
        };
      }),
    );
    assert.deepEqual(
      judged,
      citedSupports ? [f.assetId] : [f.assetId, alternative.id],
    );
    const finding = (
      await db.query("SELECT data FROM findings WHERE run_id=$1", [f.run.id])
    ).rows[0].data;
    assert.equal(finding.citation, citedSupports ? "correct" : "wrong_source");
  }
});

test("citation review excludes uncited follow-on claims from assessment and coverage", async () => {
  const text =
    "The trial included 218 adults (Brown 1).\nThese findings mean the treatment cures depression.\nThe trial included 218 adults (Unknown 1).";
  const f = await fixture(text, ["The trial included 218 adults."], true);
  const assessed: string[] = [];
  await processRun(
    db,
    f.blobs,
    f.ws,
    f.run.id,
    deps(async (claim, _source, passages) => {
      assessed.push(claim.text);
      return {
        ...claim,
        status: "supported",
        method: "Jev",
        evidence: passages![0],
        checkedPassages: passages,
        explanation: "Matching source passage.",
      };
    }),
  );
  const run = await ownedRun(db, f.ws, f.run.id);
  const findings = (
    await db.query(
      "SELECT data FROM findings WHERE run_id=$1 ORDER BY ordinal",
      [f.run.id],
    )
  ).rows.map((r) => r.data);
  assert.equal(run.coverage.totalClaims, 2);
  assert.equal(run.coverage.completedClaims, 2);
  assert.equal(run.coverage.excludedSpans.length, 1);
  assert.equal(findings.length, 2);
  assert.ok(!assessed.some((text) => text.startsWith("These findings")));
  assert.ok(findings.every((f) => f.citationChecks.length > 0));
  assert.equal(findings[1].citation, "ambiguous");
});
