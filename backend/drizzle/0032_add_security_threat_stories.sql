CREATE TABLE IF NOT EXISTS security_threat_stories (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  story_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  severity VARCHAR(32) NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  summary TEXT NOT NULL,
  impact TEXT NOT NULL,
  attack_path TEXT,
  recommended_action TEXT,
  affected_asset_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_agent_run_id TEXT,
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_threat_stories_org_key_uidx
  ON security_threat_stories (organization_id, story_key);
CREATE INDEX IF NOT EXISTS security_threat_stories_org_severity_status_idx
  ON security_threat_stories (organization_id, severity, status);
CREATE INDEX IF NOT EXISTS security_threat_stories_org_updated_idx
  ON security_threat_stories (organization_id, updated_at);

CREATE TABLE IF NOT EXISTS security_threat_story_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(255) NOT NULL,
  story_id TEXT NOT NULL REFERENCES security_threat_stories(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES security_finding_instances(id) ON DELETE CASCADE,
  role VARCHAR(64) NOT NULL DEFAULT 'supporting',
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS security_threat_story_findings_story_finding_uidx
  ON security_threat_story_findings (story_id, finding_id);
CREATE INDEX IF NOT EXISTS security_threat_story_findings_org_finding_idx
  ON security_threat_story_findings (organization_id, finding_id);
