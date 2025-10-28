CREATE TABLE "workflow_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "graph" jsonb NOT NULL,
  "compiled_definition" jsonb DEFAULT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "workflow_versions_workflow_version_uidx"
  ON "workflow_versions" ("workflow_id", "version");

ALTER TABLE "workflow_runs" ADD COLUMN "workflow_version_id" uuid;
ALTER TABLE "workflow_runs" ADD COLUMN "workflow_version" integer;

INSERT INTO "workflow_versions" (
  "workflow_id",
  "version",
  "graph",
  "compiled_definition",
  "created_at"
)
SELECT
  w."id",
  1 AS "version",
  w."graph",
  w."compiled_definition",
  COALESCE(w."updated_at", w."created_at")
FROM "workflows" w;

UPDATE "workflow_runs"
SET "workflow_version" = 1
WHERE "workflow_version" IS NULL;

UPDATE "workflow_runs" wr
SET "workflow_version_id" = v."id"
FROM "workflow_versions" v
WHERE wr."workflow_id" = v."workflow_id"
  AND wr."workflow_version" = v."version"
  AND wr."workflow_version_id" IS NULL;
