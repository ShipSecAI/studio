ALTER TABLE "workflows" ADD COLUMN "last_run" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;