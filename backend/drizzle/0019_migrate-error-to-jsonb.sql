-- Migration: Convert workflow_traces.error from TEXT to JSONB
-- Required for: Structured error representation (commit c7282f9d)
-- Note: This migration preserves existing JSON text by parsing it, with fallback for plain text
-- Safe to run on databases that already have JSONB (will be a no-op)

-- Helper function to safely parse JSON text, falling back to wrapping as JSON string
CREATE OR REPLACE FUNCTION pg_temp.try_parse_jsonb(text_value TEXT) RETURNS JSONB AS $$
BEGIN
    IF text_value IS NULL THEN
        RETURN NULL;
    END IF;
    -- Try to parse as JSON
    RETURN text_value::jsonb;
EXCEPTION WHEN OTHERS THEN
    -- If parsing fails, wrap the plain text as a JSON string
    RETURN to_jsonb(text_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
BEGIN
    -- Check if the column is still TEXT type
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'workflow_traces'
        AND column_name = 'error'
        AND data_type = 'text'
    ) THEN
        -- Convert TEXT to JSONB, parsing existing JSON text or wrapping plain text
        ALTER TABLE workflow_traces
        ALTER COLUMN error TYPE jsonb
        USING pg_temp.try_parse_jsonb(error);

        RAISE NOTICE 'Successfully migrated workflow_traces.error from TEXT to JSONB';
    ELSE
        RAISE NOTICE 'workflow_traces.error is already JSONB or does not exist, skipping migration';
    END IF;
END $$;
