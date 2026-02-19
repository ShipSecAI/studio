-- Indexes to support org-scoped monthly usage queries for billing/credits metering.

CREATE INDEX IF NOT EXISTS workflow_runs_org_created_at_idx
  ON workflow_runs (organization_id, created_at DESC);

-- Agent trace events include an event timestamp (when the part occurred).
CREATE INDEX IF NOT EXISTS agent_trace_events_type_timestamp_idx
  ON agent_trace_events (part_type, "timestamp" DESC);

