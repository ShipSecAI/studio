-- Create templates table
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author" varchar(255),
	"repository" varchar(255) NOT NULL,
	"path" varchar(500) NOT NULL,
	"branch" varchar(100) DEFAULT 'main' NOT NULL,
	"version" varchar(50),
	"commit_sha" varchar(100),
	"manifest" jsonb NOT NULL,
	"graph" jsonb,
	"required_secrets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Create templates_submissions table
CREATE TABLE "templates_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"repository" varchar(255) NOT NULL,
	"branch" varchar(100),
	"path" varchar(500) NOT NULL,
	"commit_sha" varchar(100),
	"pr_number" integer,
	"pr_url" varchar(500),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"submitted_by" varchar(191) NOT NULL,
	"organization_id" varchar(191),
	"manifest" jsonb,
	"graph" jsonb,
	"feedback" text,
	"reviewed_by" varchar(191),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Create indexes for templates
CREATE INDEX "templates_repository_path_idx" ON "templates" ("repository", "path");
CREATE INDEX "templates_category_idx" ON "templates" ("category");
CREATE INDEX "templates_is_active_idx" ON "templates" ("is_active");
CREATE INDEX "templates_popularity_idx" ON "templates" ("popularity" DESC);
--> statement-breakpoint
-- Create indexes for templates_submissions
CREATE INDEX "templates_submissions_pr_number_idx" ON "templates_submissions" ("pr_number");
CREATE INDEX "templates_submissions_submitted_by_idx" ON "templates_submissions" ("submitted_by");
CREATE INDEX "templates_submissions_status_idx" ON "templates_submissions" ("status");
CREATE INDEX "templates_submissions_organization_id_idx" ON "templates_submissions" ("organization_id");
