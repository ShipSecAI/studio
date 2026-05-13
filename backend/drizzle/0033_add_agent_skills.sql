CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(191),
  "name" varchar(64) NOT NULL,
  "description" text NOT NULL,
  "content" text NOT NULL,
  "license" varchar(191),
  "compatibility" varchar(500),
  "metadata" jsonb DEFAULT NULL,
  "allowed_tools" varchar(1000),
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_skills_org_idx" ON "agent_skills" ("organization_id");
CREATE INDEX IF NOT EXISTS "agent_skills_enabled_idx" ON "agent_skills" ("is_enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_name_org_uidx" ON "agent_skills" ("name", "organization_id");
