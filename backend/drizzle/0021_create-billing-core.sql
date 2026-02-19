-- Usage events table for tracking AI token consumption per request.
-- LiteLLM handles budget enforcement; this table is for our own analytics.

CREATE TABLE IF NOT EXISTS billing_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  organization_id VARCHAR(191) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel VARCHAR(64) NOT NULL,
  meter_key VARCHAR(64) NOT NULL,
  units BIGINT NOT NULL,
  model VARCHAR(191),
  provider VARCHAR(64),
  workflow_id UUID,
  run_id TEXT,
  node_ref TEXT,
  agent_run_id TEXT,
  actor_id VARCHAR(191),
  request_id TEXT,
  trace_id TEXT,
  cost_micros BIGINT,
  pricing_version VARCHAR(32),
  settlement_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS billing_usage_events_org_occurred_idx
  ON billing_usage_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_usage_events_org_run_occurred_idx
  ON billing_usage_events (organization_id, run_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_usage_events_org_workflow_occurred_idx
  ON billing_usage_events (organization_id, workflow_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_usage_events_org_channel_occurred_idx
  ON billing_usage_events (organization_id, channel, occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_usage_events_request_idx
  ON billing_usage_events (organization_id, request_id);
