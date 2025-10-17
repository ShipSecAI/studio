CREATE TABLE "workflow_traces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workflow_id" text,
	"type" text NOT NULL,
	"node_ref" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"message" text,
	"error" text,
	"output_summary" jsonb,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workflow_traces_run_idx" ON "workflow_traces" USING btree ("run_id","sequence");