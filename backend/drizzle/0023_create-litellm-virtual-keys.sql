-- LiteLLM virtual keys: maps each org to a LiteLLM team + virtual key for spend attribution.

CREATE TABLE IF NOT EXISTS litellm_virtual_keys (
  organization_id VARCHAR(255) PRIMARY KEY,
  team_id VARCHAR(255) NOT NULL,
  virtual_key VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
