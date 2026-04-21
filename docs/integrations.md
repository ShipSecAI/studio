# Integrations

ShipSec Studio uses integrations to connect workflows and agents to external systems without hardcoding credentials into workflow definitions.

In the open-source product, integrations are configured directly by the self-hosting operator or end user. ShipSec Cloud may offer a more managed onboarding experience, but the public repo focuses on the self-hosted path.

## Integration Model

An integration in Studio has three parts:

1. **Provider setup** in the backend and settings UI
2. **Connection records** that store configuration and encrypted credentials
3. **Runtime resolution** inside workflow components and agent flows

That lets you:

- store credentials once
- reference connections in workflows
- resolve provider credentials only at execution time

## Supported Public Providers

### GitHub

Use GitHub when you need:

- repository scanning
- PR review and PR protection workflows
- comments, check runs, and repository context

Typical OSS setup:

- PAT for direct access, or
- GitHub App for richer repository integration

### AWS

Use AWS when you need:

- cloud posture scanning
- organization account discovery
- runtime credential resolution for cloud workflows

Typical OSS setup:

- access keys, or
- IAM role / AssumeRole flow

### GCP

Use GCP when you need:

- project or org inventory
- cloud graph indexing
- runtime access to GCP APIs from workflows

Typical OSS setup:

- service-account-based access
- impersonation where appropriate

### Jira

Use Jira when you need:

- issue creation
- workflow-driven ticketing or escalation

Typical OSS setup:

- OAuth
- API token
- manual app setup

### Slack

Use Slack when you need:

- notifications
- workflow alerts
- bot or app-based messaging flows

Typical OSS setup:

- incoming webhook, or
- Slack app / OAuth

### MCP Servers

Use MCP when you want agents and workflows to access tool-bearing servers through the MCP model.

Studio supports:

- MCP server registration
- MCP discovery
- MCP library and grouping
- runtime tool access through agents and workflows

### AI Providers

Use direct AI provider configuration in OSS:

- `CHAT_AI_MODEL_ID`
- `CHAT_AI_BASE_URL`
- `CHAT_AI_API_KEY`

This is the default public path for agent and AI-enabled workflows.

## How Integrations Fit Into Workflows

Common pattern:

1. Create a provider connection in Settings
2. Pass the connection into a workflow as runtime input or component parameter
3. Use a credential resolver or integration-aware component at execution time

Examples:

- AWS Org Discovery
- cloud posture scans
- Jira issue creation
- Slack notification workflows
- GitHub PR workflows

## Open Source vs Managed

The same capability classes exist in both OSS and ShipSec Cloud, but setup differs.

### OSS

- direct configuration
- self-hosted credentials
- your own provider apps and roles

### ShipSec Cloud

- managed hosting
- smoother setup path for hosted users
- less operational burden

Public docs intentionally describe the OSS setup path in detail and keep the managed comparison high-level.

## Related Docs

- [OSS vs ShipSec Cloud](/oss-vs-cloud)
- [Self-Hosting](/self-hosting)
- [Components Overview](/components/overview)
- [MCP Library](./mcp-library.md)
