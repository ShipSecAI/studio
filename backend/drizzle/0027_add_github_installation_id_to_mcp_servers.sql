ALTER TABLE "mcp_servers"
ADD COLUMN "github_installation_id" bigint;

UPDATE "mcp_servers"
SET "github_installation_id" = ("template_config"->>'installationId')::bigint
WHERE "template_slug" = 'github'
  AND "template_config" IS NOT NULL
  AND "template_config" ? 'installationId';

CREATE INDEX "mcp_servers_github_installation_idx"
  ON "mcp_servers" USING btree ("github_installation_id");

CREATE UNIQUE INDEX "mcp_servers_github_installation_org_uidx"
  ON "mcp_servers" USING btree ("organization_id", "template_slug", "github_installation_id")
  WHERE "template_slug" = 'github' AND "github_installation_id" IS NOT NULL;
