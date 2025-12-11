CREATE TABLE IF NOT EXISTS "workflow_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL,
  "workflow_version_id" uuid,
  "workflow_version" integer,
  "name" text NOT NULL,
  "description" text,
  "cron_expression" text NOT NULL,
  "timezone" text NOT NULL,
  "human_label" text,
  "overlap_policy" text NOT NULL DEFAULT 'skip',
  "catchup_window_seconds" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "last_run_at" timestamptz,
  "next_run_at" timestamptz,
  "input_payload" jsonb NOT NULL DEFAULT '{"runtimeInputs":{},"nodeOverrides":{}}'::jsonb,
  "temporal_schedule_id" text,
  "temporal_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "organization_id" varchar(191),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_schedules_workflow_idx" ON "workflow_schedules" ("workflow_id", "status");

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trigger_type" text NOT NULL DEFAULT 'manual';
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trigger_source" text;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trigger_label" text NOT NULL DEFAULT 'Manual run';
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "input_preview" jsonb NOT NULL DEFAULT '{"runtimeInputs":{},"nodeOverrides":{}}'::jsonb;
