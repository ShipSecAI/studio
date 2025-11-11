CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" text NOT NULL,
  "workflow_id" uuid NOT NULL,
  "workflow_version_id" uuid,
  "component_id" text,
  "component_ref" text NOT NULL,
  "file_id" uuid NOT NULL REFERENCES "files"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "mime_type" varchar(150) NOT NULL,
  "size" bigint NOT NULL,
  "destinations" jsonb NOT NULL DEFAULT '["run"]'::jsonb,
  "metadata" jsonb,
  "organization_id" varchar(191),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "artifacts_run_idx" ON "artifacts" ("run_id", "created_at");
