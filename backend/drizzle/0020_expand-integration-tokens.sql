-- Step 1: Add new columns (all nullable initially for safe migration)
-- organization_id is varchar(255), NOT varchar(191), because the backfill
-- produces 'workspace-' || user_id (10 + up to 191 chars = 201), which
-- would overflow varchar(191). (R4 Finding #1)
-- This wider column is specific to integration_tokens — other tables use
-- varchar(191) for org IDs because they store real Clerk org IDs directly.
-- See D14 for rationale.
ALTER TABLE "integration_tokens"
  ADD COLUMN IF NOT EXISTS "credential_type" varchar(32) NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS "display_name" varchar(191),
  ADD COLUMN IF NOT EXISTS "organization_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "last_validated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_validation_status" varchar(16),
  ADD COLUMN IF NOT EXISTS "last_validation_error" text,
  ADD COLUMN IF NOT EXISTS "last_used_at" timestamptz;

-- Step 2: Backfill organization_id = 'workspace-' || user_id for ALL rows.
-- Why per-user workspace (not cross-table join):
--   - `workflows` table has NO `created_by` column (R5 Finding #1), so we can't
--     map user_id → org_id from existing DB data.
--   - Per-user workspace guarantees ZERO collisions (R5 Finding #2): each user
--     gets their own namespace, so (workspace-userA, slack, oauth, slack) and
--     (workspace-userB, slack, oauth, slack) never conflict — even if both users are
--     in the same real Clerk org. The unique index creation (Step 6) always succeeds.
--   - Clerk auth resolves personal workspace as 'workspace-' || userId
--     (backend/src/auth/providers/clerk-auth.provider.ts).
-- Tradeoff: local-dev tokens land in 'workspace-admin' instead of 'local-dev'.
-- Local dev users reconnect once after migration (acceptable for dev environments).
UPDATE "integration_tokens"
  SET "organization_id" = 'workspace-' || "user_id"
  WHERE "organization_id" IS NULL;

-- Step 3: Backfill display_name = provider for existing OAuth rows
UPDATE "integration_tokens"
  SET "display_name" = "provider"
  WHERE "display_name" IS NULL;

-- Step 4: Make both columns NOT NULL now that all rows are backfilled.
-- organization_id MUST be NOT NULL — PostgreSQL unique indexes treat NULLs as
-- distinct, so nullable org_id would bypass uniqueness entirely (R3 Finding #4).
ALTER TABLE "integration_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "integration_tokens" ALTER COLUMN "display_name" SET NOT NULL;

-- Step 5: Drop old unique index on (user_id, provider)
DROP INDEX IF EXISTS "integration_tokens_user_provider_uidx";

-- Step 6: New unique index — org-scoped, includes credential_type (D15).
-- Prevents Slack OAuth/webhook collision: (org, slack, oauth, slack) and
-- (org, slack, webhook, slack) are distinct rows.
-- All columns are NOT NULL, so uniqueness is always enforced.
CREATE UNIQUE INDEX "integration_tokens_org_provider_type_name_uidx"
  ON "integration_tokens" ("organization_id", "provider", "credential_type", "display_name");

-- Step 7: Add organization_id to OAuth state table (R5 Finding #3).
-- Without this, completeOAuthSession has no way to retrieve the org that was
-- active when the user initiated the OAuth flow.
ALTER TABLE "integration_oauth_states"
  ADD COLUMN IF NOT EXISTS "organization_id" varchar(255);

-- Step 8: Supporting indexes
CREATE INDEX IF NOT EXISTS "integration_tokens_org_idx"
  ON "integration_tokens" ("organization_id");
