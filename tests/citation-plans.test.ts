import { createFixtureRun as createRun } from "./fixtures/work-sources.js";
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

import {
  citationPlan,
  applyCitationPlan,
  applyVerifiedFixes,
  documentExport,
} from "../server/backend/citation-plans.js";
import { renderCitationPlan } from "../shared/citation-plan.js";
import type { BackendFinding } from "../shared/backend.js";
import type { BlobStore } from "../server/backend/storage.js";

let pg: PGlite, db: Database;
function adapter(connection: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query(sql, values) {
      if (values) {
        const r = await connection.query(sql, values);
        return { rows: r.rows, rowCount: r.affectedRows };
      }
      const r = (await connection.exec(sql)).at(-1);
      return { rows: r?.rows || [], rowCount: r?.affectedRows };
    },
  };
}
before(async () => {
  pg = new PGlite({ extensions: { vector } });
  db = {
    ...adapter(pg),
    transaction: (f) => pg.transaction((tx) => f(adapter(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
  await migrate(db);
});
after(async () => {
  await db?.close();
});

async function fixture(
  text = "The trial included 218 adults.\n\nThe Moon is made of cheese.",
) {
  const ws = await workspace(db, `citation-test:${randomUUID()}`),
    documentId = randomUUID(),
    versionId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,workspace_id,title,current_version_id) VALUES($1,$2,'Draft',$3)",
    [documentId, ws, versionId],
  );
  await db.query(
    "INSERT INTO document_versions(id,workspace_id,document_id,text) VALUES($1,$2,$3,$4)",
    [versionId, ws, documentId, text],
  );
  const files = new Map<string, Buffer>();
  const blobs: BlobStore = {
    put: async (k, b) => {
      files.set(k, Buffer.from(b));
    },
    get: async (k) => files.get(k)!,
    delete: async (k) => {
      files.delete(k);
    },
  };
  const body = Buffer.from("The trial included 218 adults.\nPrinted page 21.");
  const source = await createAsset(
    db,
    ws,
    {
      type: "article-journal",
      title: "Citable Evidence",
      authors: ["Brown, Maria"],
      year: "2024",
      containerTitle: "Evidence Journal",
      volume: "4",
      issue: "2",
      pages: "21-28",
      doi: "10.1234/fixture",
    },
    "source.txt",
    "text/plain",
    body.length,
  );
  await blobs.put(source.key, body, "text/plain");
  const extractionId = await ingestAsset(db, blobs, ws, source.id);
  // The fixture explicitly confirms its printed label. Production never guesses it.
  await db.query(
    "UPDATE source_pages SET label='21',label_status='confirmed' WHERE workspace_id=$1 AND extraction_id=$2",
    [ws, extractionId],
  );
  await db.query(
    "UPDATE source_assets SET eligibility='eligible' WHERE workspace_id=$1 AND id=$2",
    [ws, source.id],
  );
  const run = await createRun(
    db,
    ws,
    {
      documentVersionId: versionId,
      mode: "discover",
      sourcePolicy: "academic",
      externalAccess: "research",
      citationOutput: "generate",
      selectedSources: [{ assetId: source.id, extractionId, pageRanges: [] }],
    },
    randomUUID(),
  );
  const p = (
    await db.query(
      "SELECT p.*,g.page_index,g.label,g.label_status FROM source_passages p JOIN source_pages g ON g.id=p.page_id WHERE p.workspace_id=$1 AND p.extraction_id=$2",
      [ws, extractionId],
    )
  ).rows[0];
  const evidence = {
    id: p.id,
    assetId: source.id,
    extractionId,
    pageIndex: p.page_index,
    pageLabel: p.label,
    labelStatus: p.label_status,
    start: p.start_offset,
    end: p.end_offset,
    text: p.text,
    role: "research",
    support: "supported",
  } as const;
  const claimText = text.split("\n\n")[0];
  const finding: BackendFinding = {
    id: randomUUID(),
    claim: {
      text: claimText,
      start: 0,
      end: claimText.length,
      kind: "fact",
      context: text,
    },
    support: "supported",
    citation: "not_checked",
    eligibility: "eligible",
    processing: "complete",
    evidence: [evidence],
    explanation: [],
    checkedPassageIds: [p.id],
  };
  const save = async (f: BackendFinding, ordinal: number) => {
    const claimId = randomUUID();
    await db.query(
      "INSERT INTO claims(id,workspace_id,run_id,ordinal,data) VALUES($1,$2,$3,$4,$5)",
      [claimId, ws, run.id, ordinal, JSON.stringify(f.claim)],
    );
    await db.query(
      "INSERT INTO findings(id,workspace_id,run_id,claim_id,ordinal,data) VALUES($1,$2,$3,$4,$5,$6)",
      [f.id, ws, run.id, claimId, ordinal, JSON.stringify(f)],
    );
  };
  await save(finding, 0);
  if (text.includes("The Moon")) {
    const start = text.indexOf("The Moon");
    await save(
      {
        ...finding,
        id: randomUUID(),
        claim: {
          ...finding.claim,
          text: text.slice(start),
          start,
          end: text.length,
        },
        support: "contradicted",
        evidence: [],
      },
      1,
    );
  }
  await db.query(
    "UPDATE runs SET status='complete',coverage=$3 WHERE workspace_id=$1 AND id=$2",
    [
      ws,
      run.id,
      JSON.stringify({
        totalClaims: text.includes("The Moon") ? 2 : 1,
        completedClaims: text.includes("The Moon") ? 2 : 1,
      }),
    ],
  );
  return {
    ws,
    documentId,
    versionId,
    text,
    source,
    extractionId,
    run,
    finding,
    save,
  };
}

test("citation generation stores exact evidence and saves only supported citations, bibliography and durable gaps", async () => {
  const f = await fixture();
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.gaps.length, 1);
  assert.equal(plan.operations[0].evidence[0].pageLabel, "21");
  assert.match(plan.previewText, /adults \(Brown 21\)\./);
  assert.match(plan.previewText, /The Moon is made of cheese\.\n\nWorks Cited/);
  assert.equal((await citationPlan(db, f.ws, f.run.id)).id, plan.id);
  const key = randomUUID();
  const saved = await applyCitationPlan(
    db,
    f.ws,
    f.documentId,
    plan.id,
    f.versionId,
    [plan.operations[0].id],
    key,
  );
  assert.equal(saved.text, plan.previewText);
  assert.equal(
    (
      await applyCitationPlan(
        db,
        f.ws,
        f.documentId,
        plan.id,
        f.versionId,
        [plan.operations[0].id],
        key,
      )
    ).id,
    saved.id,
  );
  await assert.rejects(
    () =>
      applyCitationPlan(
        db,
        f.ws,
        f.documentId,
        plan.id,
        f.versionId,
        [plan.operations[0].id],
        randomUUID(),
      ),
    /changed|already applied/,
  );
  const restored = await citationPlan(db, f.ws, f.run.id);
  assert.equal(restored.status, "applied");
  assert.equal(restored.resultVersionId, saved.id);
  assert.equal(restored.gaps.length, 1);
  const old = (
    await db.query(
      "SELECT text FROM document_versions WHERE workspace_id=$1 AND id=$2",
      [f.ws, f.versionId],
    )
  ).rows[0];
  assert.equal(old.text, f.text);
  const output = await documentExport(db, f.ws, f.documentId, saved.id);
  assert.equal(output.text, saved.text);
  assert.match(output.html, /<i>Evidence Journal<\/i>/);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM document_versions WHERE workspace_id=$1 AND document_id=$2",
        [f.ws, f.documentId],
      )
    ).rows[0].n,
    2,
  );
});
test("common knowledge receives no citation or uncited-gap warning, even with supporting evidence", async () => {
  const f = await fixture("Paris is the capital of France.");
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.gaps.length, 0);
  assert.equal(plan.exemptions?.length, 1);
  assert.equal(plan.coverage.citationExemptClaims, 1);
  assert.equal(plan.coverage.citableClaims, 0);
  assert.equal(plan.previewText, f.text);
});
test("a manual common-knowledge choice cannot exempt a direct quotation or study statistic", async () => {
  for (const text of [
    'The report states, "Paris is the capital of France."',
    "The trial included 218 adults.",
  ]) {
    const f = await fixture(text);
    await db.query(
      "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
      [
        f.ws,
        f.finding.id,
        JSON.stringify({
          ...f.finding,
          claim: {
            ...f.finding.claim,
            citationRequirement: "common_knowledge",
          },
        }),
      ],
    );
    const plan = await citationPlan(db, f.ws, f.run.id);
    assert.equal(plan.exemptions?.length, 0);
    assert.equal(plan.operations.length, 1);
  }
});
test("stale source metadata, changed passages and another owner cannot apply a stored plan", async () => {
  const f = await fixture();
  const plan = await citationPlan(db, f.ws, f.run.id);
  const other = await workspace(db, `other:${randomUUID()}`);
  await assert.rejects(
    () =>
      applyCitationPlan(
        db,
        other,
        f.documentId,
        plan.id,
        f.versionId,
        [plan.operations[0].id],
        randomUUID(),
      ),
    /Not found/i,
  );
  await db.query(
    'UPDATE source_assets SET metadata=metadata || \'{"title":"Changed title"}\'::jsonb WHERE workspace_id=$1 AND id=$2',
    [f.ws, f.source.id],
  );
  await assert.rejects(
    () =>
      applyCitationPlan(
        db,
        f.ws,
        f.documentId,
        plan.id,
        f.versionId,
        [plan.operations[0].id],
        randomUUID(),
      ),
    /source|metadata/i,
  );
  assert.equal(
    (
      await db.query(
        "SELECT current_version_id FROM documents WHERE workspace_id=$1 AND id=$2",
        [f.ws, f.documentId],
      )
    ).rows[0].current_version_id,
    f.versionId,
  );
});
test("a correct existing citation can add its missing bibliography without changing the body", async () => {
  const f = await fixture("The trial included 218 adults (Brown 21).");
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id, JSON.stringify({ ...f.finding, citation: "correct" })],
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].kind, "bibliography");
  assert.ok(plan.previewText.startsWith(f.text + "\n\nWorks Cited"));
  const saved = await applyCitationPlan(
    db,
    f.ws,
    f.documentId,
    plan.id,
    f.versionId,
    [plan.operations[0].id],
    randomUUID(),
  );
  assert.equal(saved.text, plan.previewText);
  assert.match(saved.text, /Brown, Maria/);
});
test("selecting one duplicate bibliography entry changes only its exact occurrence", async () => {
  const entry =
    'Brown, Maria. "Citable Evidence." Evidence Journal, 2024. https://doi.org/10.1234/fixture';
  const f = await fixture(
    `The trial included 218 adults (Brown 21).\n\nWorks Cited\n\n${entry}\n\n${entry}`,
  );
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id, JSON.stringify({ ...f.finding, citation: "correct" })],
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  const operations = plan.operations.filter((o) => o.kind === "bibliography");
  assert.equal(operations.length, 2);
  assert.notEqual(operations[0].start, operations[1].start);
  const preview = renderCitationPlan(f.text, plan, [operations[0].id]);
  assert.equal(preview.split(entry).length - 1, 1);
  assert.equal(preview.split(operations[0].replacement).length - 1, 1);
});
test("generated quotation citations place terminal punctuation after the reference", async () => {
  for (const [draft, expected] of [
    [
      'The source states, "The trial included 218 adults."',
      'The source states, "The trial included 218 adults" (Brown 21).',
    ],
    [
      "The source asks, “Is Paris the capital of France?”",
      "The source asks, “Is Paris the capital of France?” (Brown 21).",
    ],
  ]) {
    const f = await fixture(draft);
    const plan = await citationPlan(db, f.ws, f.run.id);
    assert.equal(plan.operations[0].replacement, expected);
  }
});
test("a verified citation after the period is repaired without rewriting the claim", async () => {
  const f = await fixture("The trial included 218 adults. (Brown 21)");
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id, JSON.stringify({ ...f.finding, citation: "correct" })],
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  const operation = plan.operations.find((o) => o.kind === "citation")!;
  assert.equal(
    operation.replacement,
    "The trial included 218 adults (Brown 21).",
  );
});
test("a title match does not rewrite an existing entry from another publication year", async () => {
  const entry = 'Brown, Maria. "Citable Evidence." Evidence Journal, 2020.';
  const f = await fixture(
    `The trial included 218 adults (Brown 21).\n\nWorks Cited\n\n${entry}`,
  );
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id, JSON.stringify({ ...f.finding, citation: "correct" })],
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.ok(
    plan.audit?.bibliographyIssues.some(
      (issue) => issue.kind === "unmatched" && issue.text === entry,
    ),
  );
  assert.ok(plan.operations.every((o) => o.original !== entry));
  assert.ok(plan.previewText.includes(entry));
  assert.match(plan.previewText, /2024/);
});
test("needed bibliography entries deduplicate by verified identity across source aliases", async () => {
  const f = await fixture();
  const plan = await citationPlan(db, f.ws, f.run.id);
  const alias = {
    ...plan.references[0],
    id: randomUUID(),
    assetId: randomUUID(),
    text: "Alternative author rendering for the same verified work.",
  };
  plan.references.push(alias);
  plan.operations[0].referenceIds.push(alias.id);
  const result = renderCitationPlan(f.text, plan, [plan.operations[0].id]);
  assert.ok(result.includes(plan.references[0].text));
  assert.ok(!result.includes(alias.text));
});
test("selected citation proposals add only the needed entries and preserve unused existing entries", async () => {
  const f = await fixture();
  const plan = await citationPlan(db, f.ws, f.run.id);
  const text = f.text + "\n\nWorks Cited\n\nZed, Unused. Existing Book. 2020.";
  const p = structuredClone(plan);
  p.bibliography.start = f.text.length + 2;
  p.bibliography.end = text.length;
  p.bibliography.entries = [{ original: "Zed, Unused. Existing Book. 2020." }];
  const result = renderCitationPlan(text, p, [p.operations[0].id]);
  assert.match(result, /Brown, Maria/);
  assert.match(result, /Zed, Unused\. Existing Book\. 2020\./);
  assert.equal(renderCitationPlan(text, p, []), text);
  await assert.rejects(
    () =>
      applyCitationPlan(
        db,
        f.ws,
        f.documentId,
        plan.id,
        f.versionId,
        [randomUUID()],
        randomUUID(),
      ),
    /unavailable/,
  );
  assert.throws(
    () => renderCitationPlan(text, p, [p.operations[0].id, p.operations[0].id]),
    /only once/,
  );
});
test("a batch of verified fixes produces one version and rejects overlap without a partial edit", async () => {
  const f = await fixture(
    "Paris has 300 districts.\n\nFrance has 500 regions.",
  );
  const one = {
    ...f.finding,
    support: "contradicted" as const,
    fix: {
      original: "300",
      replacement: "20",
      start: 10,
      end: 13,
      documentVersionId: f.versionId,
      kind: "number" as const,
    },
  };
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, one.id, JSON.stringify(one)],
  );
  const at = f.text.indexOf("500");
  const two = {
    ...one,
    id: randomUUID(),
    claim: {
      ...one.claim,
      start: f.text.indexOf("France"),
      end: f.text.length,
      text: "France has 500 regions.",
    },
    fix: {
      ...one.fix,
      original: "500",
      replacement: "18",
      start: at,
      end: at + 3,
    },
  };
  await f.save(two, 1);
  const key = randomUUID();
  const saved = await applyVerifiedFixes(
    db,
    f.ws,
    f.documentId,
    f.versionId,
    [one.id, two.id],
    key,
  );
  assert.equal(saved.text, "Paris has 20 districts.\n\nFrance has 18 regions.");
  assert.equal(
    (
      await applyVerifiedFixes(
        db,
        f.ws,
        f.documentId,
        f.versionId,
        [two.id, one.id],
        key,
      )
    ).id,
    saved.id,
  );
  await assert.rejects(
    () =>
      applyVerifiedFixes(db, f.ws, f.documentId, f.versionId, [one.id], key),
    /different edits/,
  );
  const g = await fixture("Paris has 300 districts.");
  const a = {
    ...g.finding,
    support: "contradicted" as const,
    fix: { ...one.fix, documentVersionId: g.versionId },
  };
  const b = { ...a, id: randomUUID() };
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [g.ws, a.id, JSON.stringify(a)],
  );
  await g.save(b, 1);
  await assert.rejects(
    () =>
      applyVerifiedFixes(
        db,
        g.ws,
        g.documentId,
        g.versionId,
        [a.id, b.id],
        randomUUID(),
      ),
    /overlap/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT current_version_id FROM documents WHERE workspace_id=$1 AND id=$2",
        [g.ws, g.documentId],
      )
    ).rows[0].current_version_id,
    g.versionId,
  );
});
test("incomplete checks and provisional metadata never generate a citation", async () => {
  const f = await fixture();
  await db.query(
    "UPDATE findings SET data=jsonb_set(data,'{processing}','\"partial\"') WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id],
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.gaps.length, 2);
});

test("verified fixes reject a refreshed ineligible source without changing the document", async () => {
  const f = await fixture("The trial included 300 adults.");
  const finding = {
    ...f.finding,
    support: "contradicted",
    fix: {
      original: f.text,
      replacement: "The trial included 218 adults.",
      start: 0,
      end: f.text.length,
      documentVersionId: f.versionId,
      kind: "number",
    },
  };
  await db.query(
    "UPDATE findings SET data=$3 WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.finding.id, JSON.stringify(finding)],
  );
  await db.query(
    "UPDATE source_assets SET eligibility='ineligible', metadata=metadata||$3::jsonb WHERE workspace_id=$1 AND id=$2",
    [f.ws, f.source.id, JSON.stringify({ publicationWarning: true })],
  );
  await assert.rejects(
    applyVerifiedFixes(
      db,
      f.ws,
      f.documentId,
      f.versionId,
      [f.finding.id],
      randomUUID(),
    ),
    /evidence behind this edit changed/,
  );
  const saved = await documentExport(db, f.ws, f.documentId);
  assert.equal(saved.text, f.text);
  assert.equal(saved.versionId, f.versionId);
});

test("selective approval persists pending changes and the actual saved preview", async () => {
  const claim = "The trial included 218 adults.";
  const f = await fixture(claim + "\n\n" + claim);
  const start = claim.length + 2;
  await f.save(
    {
      ...f.finding,
      id: randomUUID(),
      claim: {
        ...f.finding.claim,
        text: claim,
        start,
        end: start + claim.length,
      },
    },
    1,
  );
  const plan = await citationPlan(db, f.ws, f.run.id);
  assert.equal(plan.operations.length, 2);
  await applyCitationPlan(
    db,
    f.ws,
    f.documentId,
    plan.id,
    f.versionId,
    [plan.operations[0].id],
    randomUUID(),
  );
  const saved = await documentExport(db, f.ws, f.documentId);
  const review = await citationPlan(db, f.ws, f.run.id);
  assert.deepEqual(review.appliedOperationIds, [plan.operations[0].id]);
  assert.equal(review.deferredOperationIds?.length, 1);
  assert.equal(review.previewText, saved.text);
  assert.equal(review.status, "applied");
  assert.equal(review.gaps.length, 1);
  assert.match(review.gaps[0].reason, /not applied/);
  assert.ok(saved.text.includes("\n\n" + claim + "\n\nWorks Cited"));
});
