# Page Surface Audit

This audit follows the product-surface rule: every page should either earn its own place in the product map or collapse into the nearest clearer surface.

## Command Center

- `/` Home: keep. Primary posture overview and onboarding entry.
- `/activity` Activity: keep. Cross-workflow execution history.
- `/findings`, `/findings/:findingId`, `/stories/:storyId` Sentinel: keep. Findings, threat stories, and scanner noise triage belong here.
- `/security-wiki` Security Wiki: keep. Agent and human security memory.
- `/dashboards/security`: merge. Legacy route redirects to Sentinel.

## ShipSec AI

- `/chat`, `/chat/:sessionId`: keep. Conversational operator surface.

## Source Control

- `/github/repositories`: keep. GitHub connection and repository operations.
- `/github/scans`, `/github/scans/:id`: keep. Code scan history and details.
- `/github/triggers`, `/github/triggers/new`, `/github/triggers/:id`: keep. Pull request protection rules.
- `/github`: merge. Redirects to repositories.

## Cloud Estate

- `/cloud/accounts`: keep. Cloud connections and account actions.
- `/cloud/inventory`: keep. Asset/resource inventory.
- `/cloud/scans`: keep as a tabbed sibling of Cloud Accounts. It reuses the same cloud module because scans need account context.

## Attack Surface

- `/asm/domains`: keep. Domain scope management.
- `/asm/assets`: keep. Internet asset inventory.
- `/asm/scans`: keep. ASM run history.
- `/recon`: merge. Redirects to ASM domains.

## Automation

- `/builder`: keep. Workflow index and builder entry.
- `/workflows/:id`, `/workflows/:id/runs`, `/workflows/:id/runs/:runId`: keep. Full workflow builder/runtime canvas.
- `/templates`: keep. Workflow templates.
- `/report-templates`: keep as a support page under Templates. It should not become a top-level nav surface.
- `/schedules`: keep. Recurring automation.
- `/webhooks`, `/webhooks/new`, `/webhooks/:id`, `/webhooks/:id/deliveries`, `/webhooks/:id/settings`: keep. Inbound workflow triggers.
- `/action-center`: keep and expose as Approvals under Automation. It is not a dashboard; it is a work queue for human-input workflow pauses.
- `/runs/:runId`: keep as a redirect/detail resolver.

## Manage

- `/integrations`, `/integrations/github`, `/integrations/:provider`, `/integrations/callback/:provider`: keep. External service setup and callback handling.
- `/secrets`: keep. Secret store.
- `/api-keys`: keep. Programmatic access.
- `/mcp-library`: keep. MCP server configuration.
- `/agent-skills`: keep. Agent skill authoring and control.
- `/artifacts`: keep and expose under Manage. It is shared output storage across workflows and runs.
- `/settings`, `/settings/audit`: keep. Settings and audit activity.
- `/analytics-settings`: keep when analytics is configured.
- `/billing`: keep only when provided by the cloud extension.

## Removed From Current Product

- `ReconPage.tsx`: remove. Superseded by ASM domains/assets/scans.
- `TemplateLibraryPage.tsx`: remove. Superseded by Workflow Templates.
- `IntegrationsManager.tsx`: remove. Superseded by Integrations Page.
