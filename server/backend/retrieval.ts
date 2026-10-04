import type { Passage, Selection } from "../../shared/backend.js";
import type { Sql } from "./db.js";
import { embed, vector } from "./embeddings.js";
import { versions } from "./config.js";
export const pagePermitted = (page: number, selection: Selection) =>
  !selection.pageRanges.length ||
  selection.pageRanges.some((r) => page >= r.from && page <= r.to);
export async function retrieve(
  db: Sql,
  ws: string,
  selection: Selection,
  query: string,
  locator?: string,
  max = 10,
  embeddingOptions?: {
    enabled: boolean;
    revision: string | null;
    modelDirectory?: string;
  },
): Promise<{ passages: Passage[]; citedIds: string[]; locatorKnown: boolean }> {
  const embedding = await embed(query, "query", embeddingOptions);
  const labels = [
    ...new Set(
      (locator?.split(",") || []).flatMap((part) => {
        const value = part.trim();
        const range = value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (!range) return [value];
        const size = Number(range[2]) - Number(range[1]);
        return size >= 0 && size <= 100
          ? Array.from({ length: size + 1 }, (_, i) =>
              String(Number(range[1]) + i),
            )
          : [value];
      }),
    ),
  ];
  const params: any[] = [
    ws,
    selection.extractionId,
    selection.assetId,
    query,
    JSON.stringify(selection.pageRanges),
    embedding ? vector(embedding) : null,
    labels,
    `${versions.embedding}@${embeddingOptions?.revision ?? process.env.PROOF_EMBEDDING_REVISION ?? ""}`,
  ];
  const r = await db.query(
    `SELECT p.id,p.extraction_id AS "extractionId",e.asset_id AS "assetId",g.page_index AS "pageIndex",g.label AS "pageLabel",g.label_status AS "labelStatus",p.start_offset AS start,p.end_offset AS end,p.text,
    (g.label=ANY($7::text[]) AND g.label_status IN ('embedded','confirmed')) AS cited,
    (CASE WHEN position(lower($4) in lower(p.text))>0 THEN 10 ELSE 0 END + ts_rank_cd(p.search,plainto_tsquery('english',$4)) + CASE WHEN $6::vector IS NOT NULL AND p.embedding IS NOT NULL AND p.embedding_version=$8 THEN 1-(p.embedding <=> $6::vector) ELSE 0 END) AS rank
    FROM source_passages p JOIN source_pages g ON g.id=p.page_id AND g.workspace_id=p.workspace_id JOIN extractions e ON e.id=p.extraction_id AND e.workspace_id=p.workspace_id JOIN source_assets a ON a.id=e.asset_id AND a.workspace_id=e.workspace_id
    WHERE p.workspace_id=$1 AND p.extraction_id=$2 AND e.asset_id=$3 AND a.deleted_at IS NULL
    AND (jsonb_array_length($5::jsonb)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) ranges WHERE g.page_index BETWEEN (ranges->>'from')::int AND (ranges->>'to')::int))
    ORDER BY cited DESC NULLS LAST,rank DESC,g.page_index,p.start_offset`,
    params,
  );
  const cited = r.rows.filter((p) => p.cited);
  // All cited-page passages stay in the packet, even when similarity is low.
  const selected = [...cited, ...r.rows.filter((p) => !p.cited).slice(0, max)];
  const ids = new Set(selected.map((p) => p.id));
  // Adjacent passages only come from the already filtered permitted source set.
  for (const p of [...selected])
    for (const near of r.rows.filter(
      (q) =>
        q.pageIndex === p.pageIndex &&
        (q.end === p.start - 1 || q.start === p.end + 1),
    ))
      if (!ids.has(near.id)) {
        selected.push(near);
        ids.add(near.id);
      }
  return {
    passages: selected.map(({ cited, rank, ...p }) => p),
    citedIds: cited.map((p) => p.id),
    locatorKnown:
      labels.length > 0 &&
      labels.every((label) => cited.some((p) => p.pageLabel === label)),
  };
}
