ALTER TABLE "mcp_servers"
ADD COLUMN "template_slug" varchar(191),
ADD COLUMN "template_hash" varchar(64),
ADD COLUMN "template_config" jsonb DEFAULT null;

CREATE INDEX "mcp_servers_template_slug_idx" ON "mcp_servers" USING btree ("template_slug");
