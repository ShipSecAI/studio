ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "active_turn_id" uuid,
  ADD COLUMN IF NOT EXISTS "active_generation_id" integer NOT NULL DEFAULT 0;
