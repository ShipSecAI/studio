ALTER TABLE "workflow_templates" ADD COLUMN "screenshot_url" varchar(255);
ALTER TABLE "workflow_templates" ADD COLUMN "is_featured" boolean NOT NULL DEFAULT false;
ALTER TABLE "workflow_templates" ADD COLUMN "run_count" integer NOT NULL DEFAULT 0;
