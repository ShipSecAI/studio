CREATE TABLE IF NOT EXISTS "security_wiki_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(191) NOT NULL,
  "provider" varchar(32) DEFAULT 'local' NOT NULL,
  "repo_owner" varchar(191),
  "repo_name" varchar(191) NOT NULL,
  "repo_url" text,
  "local_path" text,
  "default_branch" varchar(191) DEFAULT 'main' NOT NULL,
  "root_path" text DEFAULT '/' NOT NULL,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "path_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "security_wiki_configs_org_active_uidx"
  ON "security_wiki_configs" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "security_wiki_configs_org_idx"
  ON "security_wiki_configs" ("organization_id");

CREATE TABLE IF NOT EXISTS "security_wiki_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(191) NOT NULL,
  "wiki_config_id" uuid NOT NULL REFERENCES "security_wiki_configs"("id") ON DELETE cascade,
  "run_id" varchar(191) NOT NULL,
  "agent_name" varchar(191) NOT NULL,
  "repo_slug" varchar(255) NOT NULL,
  "repo_path" text,
  "repo_commit" varchar(128),
  "model" varchar(191),
  "branch_name" varchar(255),
  "wiki_base_commit" varchar(128),
  "output_commit" varchar(128),
  "merge_commit" varchar(128),
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "security_wiki_runs_org_run_uidx"
  ON "security_wiki_runs" ("organization_id", "run_id");

CREATE INDEX IF NOT EXISTS "security_wiki_runs_org_created_idx"
  ON "security_wiki_runs" ("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "security_wiki_runs_config_idx"
  ON "security_wiki_runs" ("wiki_config_id");
