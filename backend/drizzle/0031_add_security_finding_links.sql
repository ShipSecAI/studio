CREATE TABLE IF NOT EXISTS security_finding_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(255) NOT NULL,
  from_finding_id TEXT NOT NULL REFERENCES security_finding_instances(id) ON DELETE CASCADE,
  to_finding_id TEXT NOT NULL REFERENCES security_finding_instances(id) ON DELETE CASCADE,
  relationship_type VARCHAR(64) NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  rationale TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_agent_run_id TEXT,
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_finding_links_org_from_idx
  ON security_finding_links (organization_id, from_finding_id);
CREATE INDEX IF NOT EXISTS security_finding_links_org_to_idx
  ON security_finding_links (organization_id, to_finding_id);
CREATE UNIQUE INDEX IF NOT EXISTS security_finding_links_org_pair_type_uidx
  ON security_finding_links (
    organization_id,
    from_finding_id,
    to_finding_id,
    relationship_type
  );
