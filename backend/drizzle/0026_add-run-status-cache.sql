ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "close_time" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "idx_workflow_runs_status" ON "workflow_runs" ("status");
