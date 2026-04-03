CREATE TABLE IF NOT EXISTS slack_turn_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE UNIQUE,
  primary_message_ts TEXT,
  continuation_message_ts JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slack_turn_posts_session_idx ON slack_turn_posts (session_id);
CREATE INDEX IF NOT EXISTS slack_turn_posts_turn_idx ON slack_turn_posts (turn_id);
