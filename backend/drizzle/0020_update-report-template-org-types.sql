ALTER TABLE report_templates
  DROP CONSTRAINT IF EXISTS report_templates_created_by_fkey,
  DROP CONSTRAINT IF EXISTS report_templates_org_id_fkey;

ALTER TABLE generated_reports
  DROP CONSTRAINT IF EXISTS generated_reports_org_id_fkey;

ALTER TABLE report_templates
  ALTER COLUMN created_by TYPE VARCHAR(191) USING created_by::text,
  ALTER COLUMN org_id TYPE VARCHAR(191) USING org_id::text;

ALTER TABLE generated_reports
  ALTER COLUMN org_id TYPE VARCHAR(191) USING org_id::text;
