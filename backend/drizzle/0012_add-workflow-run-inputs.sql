ALTER TABLE "workflow_runs"
ADD COLUMN "inputs" jsonb NOT NULL DEFAULT '{}'::jsonb;
