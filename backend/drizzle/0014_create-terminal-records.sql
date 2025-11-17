CREATE TABLE IF NOT EXISTS workflow_terminal_records (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  node_ref TEXT NOT NULL,
  stream TEXT NOT NULL,
  file_id UUID NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  first_chunk_index INTEGER,
  last_chunk_index INTEGER,
  organization_id VARCHAR(191),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflow_terminal_records_run_idx
  ON workflow_terminal_records (run_id, node_ref);
