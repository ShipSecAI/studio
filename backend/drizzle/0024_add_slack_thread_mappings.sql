-- Add origin column to chat_sessions
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'web';

-- Create slack thread mappings table
CREATE TABLE IF NOT EXISTS slack_thread_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  slack_team_id TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  connection_id UUID NOT NULL,
  bot_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT slack_thread_mappings_thread_uidx UNIQUE (slack_team_id, slack_channel_id, slack_thread_ts)
);

CREATE INDEX IF NOT EXISTS slack_thread_mappings_session_idx ON slack_thread_mappings (session_id);
