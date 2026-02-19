-- Add unique constraint to workflow_templates.slug to prevent duplicate system template slugs.
-- Existing NULL slugs are allowed (UNIQUE permits multiple NULLs in Postgres).
ALTER TABLE workflow_templates ADD CONSTRAINT workflow_templates_slug_unique UNIQUE (slug);
