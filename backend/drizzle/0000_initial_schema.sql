CREATE TYPE "public"."human_input_status" AS ENUM('pending', 'resolved', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."human_input_type" AS ENUM('approval', 'form', 'selection', 'review', 'acknowledge');--> statement-breakpoint
CREATE TABLE "agent_trace_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"node_ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"part_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_hint" varchar(8) NOT NULL,
	"permissions" jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"organization_id" varchar(191) NOT NULL,
	"created_by" varchar(191) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"rate_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid,
	"component_id" text,
	"component_ref" text NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" varchar(150) NOT NULL,
	"size" bigint NOT NULL,
	"destinations" jsonb DEFAULT '["run"]'::jsonb NOT NULL,
	"metadata" jsonb,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asm_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"domain_id" uuid NOT NULL,
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
	CONSTRAINT "asm_assets_domain_id_hostname_unique" UNIQUE("domain_id","hostname")
);
--> statement-breakpoint
CREATE TABLE "asm_domains" (
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
--> statement-breakpoint
CREATE TABLE "asset_scan_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"scan_type" varchar(64) NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"last_run_id" varchar(255),
	"finding_count" integer,
	"critical_count" integer,
	"high_count" integer,
	"status" varchar(16) DEFAULT 'unscanned'
);
--> statement-breakpoint
CREATE TABLE "asset_sync_run_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"asset_type" varchar(64) NOT NULL,
	"region" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_sync_runs" (
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
--> statement-breakpoint
CREATE TABLE "assets" (
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
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191),
	"actor_id" varchar(191),
	"actor_type" varchar(32) NOT NULL,
	"actor_display" varchar(191),
	"action" varchar(64) NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"resource_id" varchar(191),
	"resource_name" varchar(191),
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_partial_responses" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
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
--> statement-breakpoint
CREATE TABLE "chat_stream_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"organization_id" varchar(191),
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "github_app_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" integer NOT NULL,
	"account_type" varchar(32) NOT NULL,
	"account_login" varchar(191) NOT NULL,
	"account_id" integer NOT NULL,
	"account_avatar_url" text,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"repository_selection" varchar(32) DEFAULT 'selected',
	"organization_id" varchar(191) NOT NULL,
	"installed_by" varchar(191),
	"is_active" boolean DEFAULT true NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"repo_id" integer NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"name" varchar(191) NOT NULL,
	"owner" varchar(191) NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"default_branch" varchar(191) DEFAULT 'main',
	"description" text,
	"language" varchar(64),
	"clone_url" text,
	"html_url" text,
	"organization_id" varchar(191) NOT NULL,
	"scans_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_scan_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"workflow_run_id" varchar(191) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"pr_number" integer,
	"branch" varchar(191),
	"commit_sha" varchar(64),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{"critical":0,"high":0,"medium":0,"low":0,"info":0}'::jsonb,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb,
	"check_run_id" bigint,
	"pr_comment_id" bigint,
	"pr_review_id" bigint,
	"results_url" text,
	"error_message" text,
	"trigger_rule_id" uuid,
	"organization_id" varchar(191) NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_trigger_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"repository_pattern" varchar(255) NOT NULL,
	"event" varchar(64) NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"branches" jsonb DEFAULT '[]'::jsonb,
	"workflow_id" uuid NOT NULL,
	"post_pr_comment" boolean DEFAULT true NOT NULL,
	"create_check_run" boolean DEFAULT true NOT NULL,
	"post_pr_review" boolean DEFAULT false NOT NULL,
	"fail_on" varchar(32) DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"created_by" varchar(191),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_input_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_ref" text NOT NULL,
	"status" "human_input_status" DEFAULT 'pending' NOT NULL,
	"input_type" "human_input_type" DEFAULT 'approval' NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb,
	"title" text NOT NULL,
	"description" text,
	"context" jsonb DEFAULT '{}'::jsonb,
	"resolve_token" text NOT NULL,
	"timeout_at" timestamp with time zone,
	"response_data" jsonb,
	"responded_at" timestamp with time zone,
	"responded_by" text,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_input_requests_resolve_token_unique" UNIQUE("resolve_token")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"graph" jsonb NOT NULL,
	"organization_id" varchar(191),
	"is_system" boolean DEFAULT false NOT NULL,
	"template_id" uuid,
	"compiled_definition" jsonb DEFAULT 'null'::jsonb,
	"icon" text,
	"icon_color" text,
	"last_run" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"organization_id" varchar(191),
	"compiled_definition" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_traces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" text,
	"organization_id" varchar(191),
	"type" text NOT NULL,
	"node_ref" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"message" text,
	"error" jsonb,
	"output_summary" jsonb,
	"level" text DEFAULT 'info' NOT NULL,
	"data" jsonb,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid,
	"workflow_version" integer,
	"temporal_run_id" text,
	"parent_run_id" text,
	"parent_node_ref" text,
	"total_actions" integer DEFAULT 0 NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"trigger_source" text,
	"trigger_label" text DEFAULT 'Manual run' NOT NULL,
	"input_preview" jsonb DEFAULT '{"runtimeInputs":{},"nodeOverrides":{}}'::jsonb NOT NULL,
	"organization_id" varchar(191),
	"status" text,
	"close_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_log_streams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_ref" text NOT NULL,
	"stream" text NOT NULL,
	"organization_id" varchar(191),
	"labels" jsonb NOT NULL,
	"first_timestamp" timestamp with time zone NOT NULL,
	"last_timestamp" timestamp with time zone NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"encryption_key_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(191),
	"organization_id" varchar(191),
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT 'null'::jsonb,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "platform_workflow_links" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"platform_agent_id" varchar(191) NOT NULL,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_workflow_links_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "workflow_roles" (
	"workflow_id" uuid NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"organization_id" varchar(191),
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_roles_workflow_id_user_id_pk" PRIMARY KEY("workflow_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"organization_id" varchar(255),
	"code_verifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_provider_configs" (
	"provider" varchar(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(191) NOT NULL,
	"client_secret" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"credential_type" varchar(32) DEFAULT 'oauth' NOT NULL,
	"display_name" varchar(191) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token" jsonb NOT NULL,
	"refresh_token" jsonb DEFAULT 'null'::jsonb,
	"token_type" varchar(32) DEFAULT 'Bearer',
	"expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" varchar(16),
	"last_validation_error" text,
	"last_used_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid,
	"workflow_version" integer,
	"name" text NOT NULL,
	"description" text,
	"cron_expression" text NOT NULL,
	"timezone" text NOT NULL,
	"human_label" text,
	"overlap_policy" text DEFAULT 'skip' NOT NULL,
	"catchup_window_seconds" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"input_payload" jsonb DEFAULT '{"runtimeInputs":{},"nodeOverrides":{}}'::jsonb NOT NULL,
	"temporal_schedule_id" text,
	"temporal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid,
	"workflow_version" integer,
	"name" text NOT NULL,
	"description" text,
	"webhook_path" varchar(255) NOT NULL,
	"parsing_script" text NOT NULL,
	"expected_inputs" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"organization_id" varchar(191),
	"created_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_configurations_webhook_path_unique" UNIQUE("webhook_path")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"workflow_run_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb,
	"parsed_data" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_terminal_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text,
	"node_ref" text NOT NULL,
	"stream" text NOT NULL,
	"file_id" uuid NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"first_chunk_index" integer,
	"last_chunk_index" integer,
	"organization_id" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_group_servers" (
	"group_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"default_selected" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_group_servers_group_id_server_id_pk" PRIMARY KEY("group_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"credential_contract_name" varchar(191) NOT NULL,
	"credential_mapping" jsonb DEFAULT 'null'::jsonb,
	"default_docker_image" varchar(255),
	"template_hash" varchar(64),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mcp_server_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"tool_name" varchar(191) NOT NULL,
	"description" text,
	"input_schema" jsonb DEFAULT 'null'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"transport_type" varchar(32) NOT NULL,
	"endpoint" text,
	"command" text,
	"args" jsonb DEFAULT 'null'::jsonb,
	"headers" jsonb DEFAULT 'null'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_check_url" text,
	"last_health_check" timestamp with time zone,
	"last_health_status" varchar(32),
	"group_id" uuid,
	"organization_id" varchar(191),
	"created_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_io" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_ref" text NOT NULL,
	"workflow_id" text,
	"organization_id" varchar(191),
	"component_id" text NOT NULL,
	"inputs" jsonb,
	"inputs_size" integer DEFAULT 0 NOT NULL,
	"inputs_spilled" boolean DEFAULT false NOT NULL,
	"inputs_storage_ref" text,
	"outputs" jsonb,
	"outputs_size" integer DEFAULT 0 NOT NULL,
	"outputs_spilled" boolean DEFAULT false NOT NULL,
	"outputs_storage_ref" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" varchar(191) PRIMARY KEY NOT NULL,
	"analytics_retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" varchar(191) PRIMARY KEY NOT NULL,
	"aws_external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asm_assets" ADD CONSTRAINT "asm_assets_domain_id_asm_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."asm_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_scan_status" ADD CONSTRAINT "asset_scan_status_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sync_run_scopes" ADD CONSTRAINT "asset_sync_run_scopes_sync_run_id_asset_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."asset_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_partial_responses" ADD CONSTRAINT "chat_partial_responses_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_stream_events" ADD CONSTRAINT "chat_stream_events_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_installation_id_github_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_scan_results" ADD CONSTRAINT "github_scan_results_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_scan_results" ADD CONSTRAINT "github_scan_results_trigger_rule_id_github_trigger_rules_id_fk" FOREIGN KEY ("trigger_rule_id") REFERENCES "public"."github_trigger_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_roles" ADD CONSTRAINT "workflow_roles_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhook_configurations_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_group_servers" ADD CONSTRAINT "mcp_group_servers_group_id_mcp_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."mcp_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_group_servers" ADD CONSTRAINT "mcp_group_servers_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_tools" ADD CONSTRAINT "mcp_server_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_group_id_mcp_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."mcp_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_trace_events_run_idx" ON "agent_trace_events" USING btree ("agent_run_id","sequence");--> statement-breakpoint
CREATE INDEX "agent_trace_events_workflow_idx" ON "agent_trace_events" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("is_active","organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asm_domains_org_domain_unique" ON "asm_domains" USING btree ("organization_id","domain") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_scan_status_asset_scan_type_uidx" ON "asset_scan_status" USING btree ("asset_id","scan_type");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_sync_run_scopes_run_type_region_uidx" ON "asset_sync_run_scopes" USING btree ("sync_run_id","asset_type","region");--> statement-breakpoint
CREATE INDEX "asset_sync_run_scopes_sync_run_idx" ON "asset_sync_run_scopes" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "asset_sync_runs_org_integration_created_idx" ON "asset_sync_runs" USING btree ("organization_id","integration_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_sync_runs_org_account_created_idx" ON "asset_sync_runs" USING btree ("organization_id","account_identifier","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_provider_type_external_uidx" ON "assets" USING btree ("organization_id","provider","asset_type","external_id");--> statement-breakpoint
CREATE INDEX "assets_org_asset_type_idx" ON "assets" USING btree ("organization_id","asset_type");--> statement-breakpoint
CREATE INDEX "assets_org_integration_idx" ON "assets" USING btree ("organization_id","integration_id");--> statement-breakpoint
CREATE INDEX "assets_status_last_seen_idx" ON "assets" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_at_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_resource_idx" ON "audit_logs" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_created_at_idx" ON "audit_logs" USING btree ("organization_id","action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_actor_created_at_idx" ON "audit_logs" USING btree ("organization_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_session_created_idx" ON "chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_user_org_status_idx" ON "chat_sessions" USING btree ("user_id","organization_id","status");--> statement-breakpoint
CREATE INDEX "chat_stream_events_session_run_seq_idx" ON "chat_stream_events" USING btree ("session_id","run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_installation_id_uidx" ON "github_app_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installations_org_idx" ON "github_app_installations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_login_idx" ON "github_app_installations" USING btree ("account_login");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repos_repo_id_uidx" ON "github_repositories" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "github_repos_installation_idx" ON "github_repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_repos_org_idx" ON "github_repositories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_repos_full_name_idx" ON "github_repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "github_scan_results_repo_idx" ON "github_scan_results" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "github_scan_results_org_idx" ON "github_scan_results" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_scan_results_pr_idx" ON "github_scan_results" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX "github_scan_results_status_idx" ON "github_scan_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "github_scan_results_workflow_run_idx" ON "github_scan_results" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "github_scan_results_trigger_rule_idx" ON "github_scan_results" USING btree ("trigger_rule_id","created_at");--> statement-breakpoint
CREATE INDEX "github_trigger_rules_org_idx" ON "github_trigger_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_trigger_rules_event_idx" ON "github_trigger_rules" USING btree ("event");--> statement-breakpoint
CREATE INDEX "github_trigger_rules_enabled_idx" ON "github_trigger_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_workflow_version_uidx" ON "workflow_versions" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_traces_run_idx" ON "workflow_traces" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_workflow_created" ON "workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_org_created" ON "workflow_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_log_streams_run_node_stream_idx" ON "workflow_log_streams" USING btree ("run_id","node_ref","stream");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_log_streams_run_node_stream_uidx" ON "workflow_log_streams" USING btree ("run_id","node_ref","stream");--> statement-breakpoint
CREATE INDEX "platform_workflow_links_agent_idx" ON "platform_workflow_links" USING btree ("platform_agent_id");--> statement-breakpoint
CREATE INDEX "platform_workflow_links_org_idx" ON "platform_workflow_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_roles_org_idx" ON "workflow_roles" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "workflow_roles_user_idx" ON "workflow_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_states_state_uidx" ON "integration_oauth_states" USING btree ("state");--> statement-breakpoint
CREATE INDEX "integration_tokens_user_idx" ON "integration_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_tokens_org_idx" ON "integration_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_tokens_org_provider_type_name_uidx" ON "integration_tokens" USING btree ("organization_id","provider","credential_type","display_name");--> statement-breakpoint
CREATE INDEX "mcp_group_servers_group_idx" ON "mcp_group_servers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "mcp_group_servers_server_idx" ON "mcp_group_servers" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_groups_slug_idx" ON "mcp_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "mcp_groups_enabled_idx" ON "mcp_groups" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "mcp_server_tools_server_idx" ON "mcp_server_tools" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_tools_server_tool_uidx" ON "mcp_server_tools" USING btree ("server_id","tool_name");--> statement-breakpoint
CREATE INDEX "mcp_servers_org_idx" ON "mcp_servers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_enabled_idx" ON "mcp_servers" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "mcp_servers_group_idx" ON "mcp_servers" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_name_org_uidx" ON "mcp_servers" USING btree ("name","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "node_io_run_node_idx" ON "node_io" USING btree ("run_id","node_ref");--> statement-breakpoint
CREATE INDEX "node_io_run_idx" ON "node_io" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "node_io_workflow_idx" ON "node_io" USING btree ("workflow_id");
