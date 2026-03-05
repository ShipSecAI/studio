ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "steer_target_turn_id" uuid,
  ADD COLUMN IF NOT EXISTS "steer_requested_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "chat_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "client_message_id" text,
  "user_message" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "run_id" uuid,
  "generation_id" text,
  "queued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_turns_status_check"
    CHECK ("status" IN ('queued', 'running', 'completed', 'interrupted', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "chat_turns_session_queued_idx"
  ON "chat_turns" USING btree ("session_id", "queued_at");

CREATE UNIQUE INDEX IF NOT EXISTS "chat_turns_session_client_message_uidx"
  ON "chat_turns" USING btree ("session_id", "client_message_id")
  WHERE "client_message_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_turns_one_running_per_session_uidx"
  ON "chat_turns" USING btree ("session_id")
  WHERE "status" = 'running';

CREATE TABLE IF NOT EXISTS "chat_session_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE cascade,
  "turn_id" uuid NOT NULL REFERENCES "chat_turns"("id") ON DELETE cascade,
  "run_id" uuid,
  "generation_id" text,
  "event_id" text NOT NULL,
  "seq" integer NOT NULL,
  "chunk" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_session_events_session_seq_uidx"
  ON "chat_session_events" USING btree ("session_id", "seq");

CREATE UNIQUE INDEX IF NOT EXISTS "chat_session_events_turn_event_uidx"
  ON "chat_session_events" USING btree ("turn_id", "event_id");

CREATE INDEX IF NOT EXISTS "chat_session_events_session_seq_idx"
  ON "chat_session_events" USING btree ("session_id", "seq");

CREATE TABLE IF NOT EXISTS "chat_turn_drafts" (
  "turn_id" uuid PRIMARY KEY NOT NULL REFERENCES "chat_turns"("id") ON DELETE cascade,
  "assistant_message_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seq" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
