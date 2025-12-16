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
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("is_active","organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");
