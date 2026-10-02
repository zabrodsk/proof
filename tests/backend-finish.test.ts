import { after, before, test } from "node:test";
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
function deps(judge: EngineDeps["judge"]): EngineDeps {
  return { judge, research: noResearch, resolveReferences: noResearch };
}

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
    "Jane Smith\nIoanna Mavridou\n4G2 English\n14 January 2026\n\nThe trial included 218 adults.\nJohn was born on the Reservation.";
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
  assert.equal(run.config.claimSelection, "proof-claims-2");
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
