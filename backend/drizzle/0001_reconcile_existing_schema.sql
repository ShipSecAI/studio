-- Reconcile legacy clusters that were bootstrapped via schema push or partial migration chains.
-- This migration is additive and idempotent: no drops, renames, or destructive transforms.

CREATE TABLE IF NOT EXISTS "asm_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(191) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "scope_include" text[],
  "scope_exclude" text[],
  "monitoring_enabled" boolean DEFAULT false,
  "frequency" varchar(50),
  "last_scan_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "asm_domains_org_domain_unique"
  ON "asm_domains" USING btree ("organization_id", "domain")
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS "asm_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(191) NOT NULL,
  "domain_id" uuid NOT NULL REFERENCES "asm_domains"("id") ON DELETE cascade,
  "hostname" varchar(512) NOT NULL,
  "type" varchar(50) NOT NULL,
  "ip_addresses" text[],
  "tech_stack" text[],
  "ports" jsonb,
  "risk_score" numeric(4, 1),
  "dns_records" jsonb,
  "tls_info" jsonb,
  "first_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb,
  CONSTRAINT "asm_assets_domain_id_hostname_unique" UNIQUE("domain_id", "hostname")
);

CREATE TABLE IF NOT EXISTS "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "integration_id" uuid,
  "provider" varchar(64) NOT NULL,
  "account_identifier" varchar(255),
  "asset_type" varchar(64) NOT NULL,
  "external_id" text NOT NULL,
  "name" text,
  "region" varchar(64),
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "first_discovered_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "status" varchar(16) DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "assets_org_provider_type_external_uidx"
  ON "assets" USING btree ("organization_id", "provider", "asset_type", "external_id");
CREATE INDEX IF NOT EXISTS "assets_org_asset_type_idx"
  ON "assets" USING btree ("organization_id", "asset_type");
CREATE INDEX IF NOT EXISTS "assets_org_integration_idx"
  ON "assets" USING btree ("organization_id", "integration_id");
CREATE INDEX IF NOT EXISTS "assets_status_last_seen_idx"
  ON "assets" USING btree ("status", "last_seen_at");

CREATE TABLE IF NOT EXISTS "asset_scan_status" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE cascade,
  "scan_type" varchar(64) NOT NULL,
  "last_scanned_at" timestamp with time zone,
  "last_run_id" varchar(255),
  "finding_count" integer,
  "critical_count" integer,
  "high_count" integer,
  "status" varchar(16) DEFAULT 'unscanned'
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_scan_status_asset_scan_type_uidx"
  ON "asset_scan_status" USING btree ("asset_id", "scan_type");

CREATE TABLE IF NOT EXISTS "asset_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "integration_id" uuid NOT NULL,
  "account_identifier" varchar(255),
  "temporal_workflow_id" text,
  "temporal_run_id" text,
  "status" varchar(16) NOT NULL,
  "covered_regions" jsonb DEFAULT '[]'::jsonb,
  "assets_discovered" integer DEFAULT 0,
  "assets_created" integer DEFAULT 0,
  "assets_updated" integer DEFAULT 0,
  "assets_stale" integer DEFAULT 0,
  "errors" jsonb DEFAULT '[]'::jsonb,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "asset_sync_runs_org_integration_created_idx"
  ON "asset_sync_runs" USING btree ("organization_id", "integration_id", "created_at");
CREATE INDEX IF NOT EXISTS "asset_sync_runs_org_account_created_idx"
  ON "asset_sync_runs" USING btree ("organization_id", "account_identifier", "created_at");

CREATE TABLE IF NOT EXISTS "asset_sync_run_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sync_run_id" uuid NOT NULL REFERENCES "asset_sync_runs"("id") ON DELETE cascade,
  "asset_type" varchar(64) NOT NULL,
  "region" varchar(64) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_sync_run_scopes_run_type_region_uidx"
  ON "asset_sync_run_scopes" USING btree ("sync_run_id", "asset_type", "region");
CREATE INDEX IF NOT EXISTS "asset_sync_run_scopes_sync_run_idx"
  ON "asset_sync_run_scopes" USING btree ("sync_run_id");

CREATE TABLE IF NOT EXISTS "workflow_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" varchar(100),
  "description" text,
  "category" varchar(50) NOT NULL,
  "graph" jsonb NOT NULL,
  "icon" varchar(50),
  "screenshot_url" varchar(255),
  "is_featured" boolean DEFAULT false NOT NULL,
  "run_count" integer DEFAULT 0 NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_templates_slug_unique"
  ON "workflow_templates" USING btree ("slug");

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" varchar(191) PRIMARY KEY NOT NULL,
  "aws_external_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_org_created_at_idx"
  ON "audit_logs" USING btree ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_org_resource_idx"
  ON "audit_logs" USING btree ("organization_id", "resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_org_action_created_at_idx"
  ON "audit_logs" USING btree ("organization_id", "action", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_org_actor_created_at_idx"
  ON "audit_logs" USING btree ("organization_id", "actor_id", "created_at");

CREATE TABLE IF NOT EXISTS "billing_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" varchar(191) NOT NULL,
  "organization_id" varchar(191) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "channel" varchar(64) NOT NULL,
  "meter_key" varchar(64) NOT NULL,
  "units" bigint NOT NULL,
  "model" varchar(191),
  "provider" varchar(64),
  "workflow_id" uuid,
  "run_id" text,
  "node_ref" text,
  "agent_run_id" text,
  "actor_id" varchar(191),
  "request_id" text,
  "trace_id" text,
  "cost_micros" bigint,
  "pricing_version" varchar(32),
  "settlement_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "settled_at" timestamp with time zone,
  "raw_payload" jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_usage_events_idempotency_unique"
  ON "billing_usage_events" USING btree ("idempotency_key");
CREATE INDEX IF NOT EXISTS "billing_usage_events_org_occurred_idx"
  ON "billing_usage_events" USING btree ("organization_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "billing_usage_events_org_run_occurred_idx"
  ON "billing_usage_events" USING btree ("organization_id", "run_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "billing_usage_events_org_workflow_occurred_idx"
  ON "billing_usage_events" USING btree ("organization_id", "workflow_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "billing_usage_events_org_channel_occurred_idx"
  ON "billing_usage_events" USING btree ("organization_id", "channel", "occurred_at");
CREATE INDEX IF NOT EXISTS "billing_usage_events_request_idx"
  ON "billing_usage_events" USING btree ("organization_id", "request_id");

CREATE TABLE IF NOT EXISTS "subscription_plans" (
  "id" varchar(50) PRIMARY KEY NOT NULL,
  "display_name" varchar(100) NOT NULL,
  "price_usd_cents" integer NOT NULL,
  "workflow_runs_per_month" integer NOT NULL,
  "ai_budget_usd_cents" integer NOT NULL,
  "max_concurrent_runs" integer NOT NULL,
  "analytics_retention_days" integer NOT NULL,
  "max_workflows" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "subscription_plans" (
  "id",
  "display_name",
  "price_usd_cents",
  "workflow_runs_per_month",
  "ai_budget_usd_cents",
  "max_concurrent_runs",
  "analytics_retention_days",
  "max_workflows"
)
VALUES
  ('free', 'Free', 0, 50, 500, 1, 7, 5),
  ('pro', 'Pro', 4900, 500, 5000, 3, 30, -1),
  ('team', 'Team', 14900, 2000, 20000, 10, 90, -1),
  ('enterprise', 'Enterprise', 0, -1, -1, -1, 365, -1)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "organization_id" varchar(191),
  "title" text DEFAULT 'New Conversation' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "processing_status" text DEFAULT 'idle' NOT NULL,
  "active_run_id" uuid,
  "next_event_seq" integer DEFAULT 1 NOT NULL,
  "temporal_workflow_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE IF EXISTS "chat_sessions"
  ADD COLUMN IF NOT EXISTS "processing_status" text DEFAULT 'idle' NOT NULL;
ALTER TABLE IF EXISTS "chat_sessions"
  ADD COLUMN IF NOT EXISTS "active_run_id" uuid;
ALTER TABLE IF EXISTS "chat_sessions"
  ADD COLUMN IF NOT EXISTS "next_event_seq" integer DEFAULT 1 NOT NULL;

CREATE INDEX IF NOT EXISTS "chat_sessions_user_org_status_idx"
  ON "chat_sessions" USING btree ("user_id", "organization_id", "status");

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "parts" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_messages_session_created_idx"
  ON "chat_messages" USING btree ("session_id", "created_at");

CREATE TABLE IF NOT EXISTS "chat_partial_responses" (
  "session_id" uuid PRIMARY KEY REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "chat_stream_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "event" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_stream_events_session_run_seq_idx"
  ON "chat_stream_events" USING btree ("session_id", "run_id", "seq");
