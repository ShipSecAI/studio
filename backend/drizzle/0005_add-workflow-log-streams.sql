CREATE TABLE IF NOT EXISTS "workflow_log_streams" (
    "id" bigserial PRIMARY KEY,
    "run_id" text NOT NULL,
    "node_ref" text NOT NULL,
    "stream" text NOT NULL,
    "labels" jsonb NOT NULL,
    "first_timestamp" timestamptz NOT NULL,
    "last_timestamp" timestamptz NOT NULL,
    "line_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_log_streams_run_node_stream_idx"
    ON "workflow_log_streams" ("run_id", "node_ref", "stream");
