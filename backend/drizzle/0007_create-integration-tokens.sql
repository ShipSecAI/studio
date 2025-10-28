CREATE TABLE IF NOT EXISTS "integration_tokens" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" varchar(191) NOT NULL,
    "provider" varchar(64) NOT NULL,
    "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "access_token" jsonb NOT NULL,
    "refresh_token" jsonb,
    "token_type" varchar(32) DEFAULT 'Bearer',
    "expires_at" timestamptz,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "integration_tokens_user_idx"
    ON "integration_tokens" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "integration_tokens_user_provider_uidx"
    ON "integration_tokens" ("user_id", "provider");

CREATE TABLE IF NOT EXISTS "integration_oauth_states" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "state" text NOT NULL,
    "user_id" varchar(191) NOT NULL,
    "provider" varchar(64) NOT NULL,
    "code_verifier" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_oauth_states_state_uidx"
    ON "integration_oauth_states" ("state");
