CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar(191),
  "actor_id" varchar(191),
  "actor_type" varchar(32) NOT NULL,
  "actor_display" varchar(191),
  "action" varchar(64) NOT NULL,
  "resource_type" varchar(32) NOT NULL,
  "resource_id" varchar(191),
  "resource_name" varchar(191),
  "metadata" jsonb,
  "ip" varchar(64),
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_org_created_at_idx" ON "audit_logs" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_org_resource_idx" ON "audit_logs" ("organization_id", "resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_org_action_created_at_idx" ON "audit_logs" ("organization_id", "action", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_org_actor_created_at_idx" ON "audit_logs" ("organization_id", "actor_id", "created_at" DESC);

