CREATE TABLE "workflow_runs" (
  "run_id" text PRIMARY KEY,
  "workflow_id" uuid NOT NULL,
  "temporal_run_id" text,
  "total_actions" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
