CREATE TABLE "user_settings" (
	"user_id" varchar(191) PRIMARY KEY NOT NULL,
	"aws_external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
