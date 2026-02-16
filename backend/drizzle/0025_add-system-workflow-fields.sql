-- workflow_templates: add slug
ALTER TABLE workflow_templates ADD COLUMN slug VARCHAR(100);

-- workflows: add system fields
ALTER TABLE workflows ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workflows ADD COLUMN template_id UUID;

-- Enforce template_id NOT NULL for system workflows
ALTER TABLE workflows ADD CONSTRAINT chk_system_has_template
  CHECK (is_system = FALSE OR template_id IS NOT NULL);

-- Prevent duplicate system workflows per org (race condition guard)
CREATE UNIQUE INDEX idx_workflows_org_template_system
  ON workflows (organization_id, template_id)
  WHERE is_system = TRUE;
