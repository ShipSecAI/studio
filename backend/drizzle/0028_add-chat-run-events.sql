ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS active_run_id UUID;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS next_event_seq INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS chat_stream_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  seq INTEGER NOT NULL,
  event JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, run_id, seq)
);

CREATE INDEX IF NOT EXISTS chat_stream_events_session_run_seq_idx
  ON chat_stream_events(session_id, run_id, seq);
