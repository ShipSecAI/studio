ALTER TABLE integration_tokens
ADD COLUMN IF NOT EXISTS natural_key VARCHAR(255);

UPDATE integration_tokens
SET natural_key = display_name
WHERE natural_key IS NULL;

ALTER TABLE integration_tokens
ALTER COLUMN natural_key SET NOT NULL;

DROP INDEX IF EXISTS integration_tokens_org_provider_type_name_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS integration_tokens_org_provider_type_natural_key_uidx
  ON integration_tokens (organization_id, provider, credential_type, natural_key);
