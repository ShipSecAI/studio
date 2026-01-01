ALTER TABLE workflow_runs
ADD COLUMN parent_run_id text REFERENCES workflow_runs(run_id) ON DELETE SET NULL;

ALTER TABLE workflow_runs
ADD COLUMN parent_node_ref text;

CREATE INDEX IF NOT EXISTS workflow_runs_parent_run_idx ON workflow_runs(parent_run_id);

