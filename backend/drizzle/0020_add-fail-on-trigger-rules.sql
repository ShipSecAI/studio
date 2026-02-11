-- Migration: Add fail_on column to github_trigger_rules
-- Configures the severity threshold at which a check run should report failure

ALTER TABLE github_trigger_rules
ADD COLUMN fail_on VARCHAR(32) NOT NULL DEFAULT 'high';
