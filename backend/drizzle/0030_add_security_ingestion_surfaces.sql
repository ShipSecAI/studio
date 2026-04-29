CREATE TABLE IF NOT EXISTS security_scanner_runs (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_version VARCHAR(128),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_kind VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  parent_run_id TEXT,
  artifact_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_hash VARCHAR(128),
  workflow_id TEXT,
  run_id TEXT,
  node_ref TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_scanner_runs_org_source_started_idx
  ON security_scanner_runs (organization_id, source_kind, started_at);
CREATE INDEX IF NOT EXISTS security_scanner_runs_org_run_idx
  ON security_scanner_runs (organization_id, run_id);
CREATE INDEX IF NOT EXISTS security_scanner_runs_org_status_idx
  ON security_scanner_runs (organization_id, status);

CREATE TABLE IF NOT EXISTS security_ingestion_batches (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  source_kind VARCHAR(64) NOT NULL,
  scanner_run_id TEXT NOT NULL REFERENCES security_scanner_runs(id) ON DELETE CASCADE,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_batch JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_ingestion_batches_org_created_idx
  ON security_ingestion_batches (organization_id, created_at);
CREATE INDEX IF NOT EXISTS security_ingestion_batches_scanner_run_idx
  ON security_ingestion_batches (scanner_run_id);

CREATE TABLE IF NOT EXISTS security_assets (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  asset_kind VARCHAR(64) NOT NULL,
  provider VARCHAR(64),
  native_id TEXT,
  stable_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence VARCHAR(32) NOT NULL,
  owner_ref TEXT,
  environment VARCHAR(64),
  criticality VARCHAR(32) NOT NULL DEFAULT 'unknown',
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_assets_org_stable_key_uidx
  ON security_assets (organization_id, stable_key);
CREATE INDEX IF NOT EXISTS security_assets_org_kind_idx
  ON security_assets (organization_id, asset_kind);
CREATE INDEX IF NOT EXISTS security_assets_org_provider_idx
  ON security_assets (organization_id, provider);

CREATE TABLE IF NOT EXISTS security_asset_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(255) NOT NULL,
  asset_id TEXT NOT NULL REFERENCES security_assets(id) ON DELETE CASCADE,
  alias_type VARCHAR(64) NOT NULL DEFAULT 'native',
  alias_value TEXT NOT NULL,
  source_kind VARCHAR(64),
  confidence VARCHAR(32) NOT NULL DEFAULT 'deterministic',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_asset_aliases_org_alias_uidx
  ON security_asset_aliases (organization_id, alias_type, alias_value);
CREATE INDEX IF NOT EXISTS security_asset_aliases_asset_idx
  ON security_asset_aliases (asset_id);

CREATE TABLE IF NOT EXISTS security_evidence_items (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  source_kind VARCHAR(64),
  scanner_run_id TEXT REFERENCES security_scanner_runs(id) ON DELETE SET NULL,
  artifact_uri TEXT NOT NULL,
  summary TEXT,
  hash VARCHAR(128),
  captured_at TIMESTAMPTZ NOT NULL,
  retention_class VARCHAR(32) NOT NULL DEFAULT 'standard',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_evidence_items_org_kind_captured_idx
  ON security_evidence_items (organization_id, kind, captured_at);
CREATE INDEX IF NOT EXISTS security_evidence_items_scanner_run_idx
  ON security_evidence_items (scanner_run_id);

CREATE TABLE IF NOT EXISTS security_observations (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  scanner_run_id TEXT NOT NULL REFERENCES security_scanner_runs(id) ON DELETE CASCADE,
  source_kind VARCHAR(64) NOT NULL,
  source_rule_id TEXT,
  asset_id TEXT REFERENCES security_assets(id) ON DELETE SET NULL,
  status VARCHAR(64),
  severity VARCHAR(32) NOT NULL DEFAULT 'unknown',
  title TEXT NOT NULL,
  raw_artifact_ref JSONB,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_observations_org_observed_idx
  ON security_observations (organization_id, observed_at);
CREATE INDEX IF NOT EXISTS security_observations_org_rule_idx
  ON security_observations (organization_id, source_kind, source_rule_id);
CREATE INDEX IF NOT EXISTS security_observations_asset_idx
  ON security_observations (asset_id);
CREATE INDEX IF NOT EXISTS security_observations_scanner_run_idx
  ON security_observations (scanner_run_id);

CREATE TABLE IF NOT EXISTS security_finding_instances (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  scanner_run_id TEXT NOT NULL REFERENCES security_scanner_runs(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES security_assets(id) ON DELETE SET NULL,
  finding_key TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  observation_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  suppression_ref TEXT,
  accepted_risk_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_finding_instances_org_key_uidx
  ON security_finding_instances (organization_id, finding_key);
CREATE INDEX IF NOT EXISTS security_findings_org_severity_status_idx
  ON security_finding_instances (organization_id, severity, status);
CREATE INDEX IF NOT EXISTS security_finding_instances_asset_idx
  ON security_finding_instances (asset_id);
CREATE INDEX IF NOT EXISTS security_finding_instances_scanner_run_idx
  ON security_finding_instances (scanner_run_id);

CREATE TABLE IF NOT EXISTS security_control_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(255),
  source_kind VARCHAR(64) NOT NULL,
  provider VARCHAR(64),
  source_rule_id TEXT NOT NULL,
  framework_key VARCHAR(64) NOT NULL,
  control_id VARCHAR(128) NOT NULL,
  control_title TEXT,
  mapping_source VARCHAR(64) NOT NULL DEFAULT 'scanner',
  confidence REAL NOT NULL DEFAULT 0.8,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_control_mappings_source_control_uidx
  ON security_control_mappings (
    organization_id,
    source_kind,
    provider,
    source_rule_id,
    framework_key,
    control_id
  );
CREATE INDEX IF NOT EXISTS security_control_mappings_framework_control_idx
  ON security_control_mappings (framework_key, control_id);

CREATE TABLE IF NOT EXISTS security_control_results (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  framework_key VARCHAR(64) NOT NULL,
  control_id VARCHAR(128) NOT NULL,
  scope_ref TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason TEXT,
  observation_id TEXT REFERENCES security_observations(id) ON DELETE SET NULL,
  finding_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  waiver_ref TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_control_results_org_framework_status_idx
  ON security_control_results (organization_id, framework_key, status);
CREATE INDEX IF NOT EXISTS security_control_results_org_control_scope_idx
  ON security_control_results (organization_id, framework_key, control_id, scope_ref);
CREATE INDEX IF NOT EXISTS security_control_results_observation_idx
  ON security_control_results (observation_id);

CREATE TABLE IF NOT EXISTS security_finding_control_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(255) NOT NULL,
  finding_id TEXT NOT NULL REFERENCES security_finding_instances(id) ON DELETE CASCADE,
  control_result_id TEXT REFERENCES security_control_results(id) ON DELETE CASCADE,
  framework_key VARCHAR(64) NOT NULL,
  control_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'fail',
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_finding_control_links_finding_control_uidx
  ON security_finding_control_links (finding_id, framework_key, control_id);
CREATE INDEX IF NOT EXISTS security_finding_control_links_org_control_idx
  ON security_finding_control_links (organization_id, framework_key, control_id);

CREATE TABLE IF NOT EXISTS security_graph_edges (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  edge_kind VARCHAR(64) NOT NULL,
  from_node_ref TEXT NOT NULL,
  to_node_ref TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_graph_edges_org_kind_idx
  ON security_graph_edges (organization_id, edge_kind);
CREATE INDEX IF NOT EXISTS security_graph_edges_org_from_idx
  ON security_graph_edges (organization_id, from_node_ref);
CREATE INDEX IF NOT EXISTS security_graph_edges_org_to_idx
  ON security_graph_edges (organization_id, to_node_ref);
