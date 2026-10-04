CREATE TABLE IF NOT EXISTS document_sources (
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, document_id, asset_id),
  FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES source_assets(workspace_id,id) ON DELETE CASCADE
);
-- Recover associations only when persisted provenance identifies the work.
INSERT INTO document_sources
SELECT DISTINCT a.workspace_id,d.id,a.id FROM source_assets a
JOIN documents d ON d.workspace_id=a.workspace_id
WHERE COALESCE(a.metadata->'importedDocumentIds','[]'::jsonb) ? d.id::text
ON CONFLICT DO NOTHING;
INSERT INTO document_sources
SELECT DISTINCT a.workspace_id,d.id,a.id FROM source_imports i
JOIN documents d ON d.workspace_id=i.workspace_id AND d.id::text=i.input->>'documentId'
JOIN source_assets a ON a.workspace_id=i.workspace_id AND a.id::text=i.input->>'assetId'
ON CONFLICT DO NOTHING;
INSERT INTO document_sources
SELECT DISTINCT a.workspace_id,v.document_id,a.id FROM runs r
JOIN document_versions v ON v.workspace_id=r.workspace_id AND v.id=r.document_version_id
JOIN source_assets a ON a.workspace_id=r.workspace_id
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.input->'selectedSources','[]'::jsonb)) s WHERE s->>'assetId'=a.id::text)
   OR a.metadata->>'retrievedByRunId'=r.id::text
   OR COALESCE(r.config->'sourceSnapshots','{}'::jsonb) ? a.id::text
ON CONFLICT DO NOTHING;

UPDATE reference_imports r SET settings=r.settings || jsonb_build_object('documentId',i.input->>'documentId')
FROM source_imports i WHERE i.workspace_id=r.workspace_id AND i.id=r.id AND i.input->>'documentId' IS NOT NULL;
INSERT INTO document_sources
SELECT DISTINCT a.workspace_id,v.document_id,a.id FROM research_results rr
JOIN runs r ON r.workspace_id=rr.workspace_id AND r.id=rr.run_id
JOIN document_versions v ON v.workspace_id=r.workspace_id AND v.id=r.document_version_id
JOIN source_assets a ON a.workspace_id=r.workspace_id
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(rr.data->'selections','[]'::jsonb)) s WHERE s->>'assetId'=a.id::text)
ON CONFLICT DO NOTHING;
