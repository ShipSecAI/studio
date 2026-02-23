-- Add processing_status to chat_sessions for detachable session support
ALTER TABLE chat_sessions ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'idle';

-- Partial responses table: holds the in-flight assistant response during streaming
CREATE TABLE IF NOT EXISTS chat_partial_responses (
  session_id UUID PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  parts      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
