-- Reconcile legacy staging/prod databases where `workflows` pre-dates
-- the current schema and is missing columns introduced in 0000.
ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "is_system" boolean DEFAULT false NOT NULL;

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "template_id" uuid;

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "icon" varchar(50);

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "icon_color" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflows_template_id_workflow_templates_id_fk'
  ) THEN
    ALTER TABLE "workflows"
      ADD CONSTRAINT "workflows_template_id_workflow_templates_id_fk"
      FOREIGN KEY ("template_id")
      REFERENCES "public"."workflow_templates"("id")
      ON DELETE no action
      ON UPDATE no action;
  END IF;
END $$;
