-- Ensure unique constraint for workflow log streams metadata upserts
BEGIN;

WITH ranked_streams AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY run_id, node_ref, stream
      ORDER BY id
    ) AS row_number
  FROM workflow_log_streams
)
DELETE FROM workflow_log_streams
WHERE id IN (
  SELECT id
  FROM ranked_streams
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_log_streams_run_node_stream_uidx
  ON workflow_log_streams (run_id, node_ref, stream);

COMMIT;
