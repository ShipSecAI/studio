ALTER TABLE "workflow_traces"
  ADD COLUMN "level" text NOT NULL DEFAULT 'info',
  ADD COLUMN "data" jsonb;
