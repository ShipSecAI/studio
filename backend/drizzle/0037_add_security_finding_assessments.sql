CREATE TABLE IF NOT EXISTS security_finding_assessments (
  id TEXT PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  finding_id TEXT NOT NULL REFERENCES security_finding_instances(id) ON DELETE CASCADE,
  verdict VARCHAR(64) NOT NULL,
  importance VARCHAR(32) NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  reasoning_markdown TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  wiki_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_calls_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_agent_run_id TEXT,
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_finding_assessments_org_finding_created_idx
  ON security_finding_assessments (organization_id, finding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_finding_assessments_org_verdict_idx
  ON security_finding_assessments (organization_id, verdict, importance);
CREATE INDEX IF NOT EXISTS security_finding_assessments_agent_run_idx
  ON security_finding_assessments (created_by_agent_run_id);
