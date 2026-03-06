ALTER TABLE user_settings
  ALTER COLUMN aws_external_id DROP NOT NULL;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS app_navigation_tour_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_builder_tour_completed BOOLEAN NOT NULL DEFAULT false;
