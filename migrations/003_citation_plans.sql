CREATE TABLE IF NOT EXISTS citation_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  fingerprint text NOT NULL,
  data jsonb NOT NULL,
  source_snapshots jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,run_id,fingerprint),
  FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,document_version_id) REFERENCES document_versions(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS document_edit_receipts (
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,document_id,idempotency_key),
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE
);
