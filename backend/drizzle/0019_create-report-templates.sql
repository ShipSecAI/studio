CREATE TABLE report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  content JSONB NOT NULL,
  input_schema JSONB NOT NULL,
  sample_data JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  is_system BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth_users(id),
  org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  workflow_run_id UUID REFERENCES workflow_runs(run_id) ON DELETE SET NULL,
  input_data JSONB,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  org_id UUID REFERENCES organizations(id),
  generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_templates_org_idx ON report_templates(org_id);
CREATE INDEX IF NOT EXISTS report_templates_system_idx ON report_templates(is_system);
CREATE INDEX IF NOT EXISTS generated_reports_template_idx ON generated_reports(template_id);
CREATE INDEX IF NOT EXISTS generated_reports_workflow_idx ON generated_reports(workflow_run_id);
