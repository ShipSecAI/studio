CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(191),
  name TEXT NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  visibility VARCHAR(20) NOT NULL,
  created_by VARCHAR(191),
  published_at TIMESTAMPTZ,
  published_version_id UUID,
  draft_version_id UUID,
  draft_session_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS report_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  kind VARCHAR(20) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  html_template TEXT NOT NULL,
  css TEXT NOT NULL DEFAULT '',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(191),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_templates_org_idx
  ON report_templates (organization_id);

CREATE INDEX IF NOT EXISTS report_templates_scope_visibility_idx
  ON report_templates (scope, visibility, updated_at DESC);

CREATE INDEX IF NOT EXISTS report_templates_published_version_idx
  ON report_templates (published_version_id);

CREATE INDEX IF NOT EXISTS report_templates_draft_version_idx
  ON report_templates (draft_version_id);

CREATE INDEX IF NOT EXISTS report_templates_draft_session_idx
  ON report_templates (draft_session_id);

CREATE INDEX IF NOT EXISTS report_template_versions_template_idx
  ON report_template_versions (template_id, version_number DESC);

CREATE UNIQUE INDEX IF NOT EXISTS report_template_versions_template_kind_version_unique
  ON report_template_versions (template_id, kind, version_number);
