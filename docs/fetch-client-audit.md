# Direct `fetch` Audit vs Typed Backend Client

Branch: `codex/fetch-client-audit`
Base: `private/main` at `9180f97e`

## Summary

The generated backend client already contains OpenAPI path coverage for most of the backend endpoints still being called with raw `fetch`, especially for:

- GitHub routes
- MCP discovery / MCP groups / MCP servers
- Workflow templates
- Onboarding, billing, analytics, audit logs
- Agent trace parts
- Chat session CRUD + submissions + thread history
- Internal worker routes such as `/internal/runs`, `/internal/mcp/*`, `/internal/billing/litellm-key`, and chat internal endpoints

The main gap is not schema generation. The gap is that several frontend and worker modules bypass `@shipsec/backend-client` and the local wrappers built around it.

## Frontend: Should Migrate

### Central wrappers/services

- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L259) `onboarding.getPreferences` and `onboarding.updatePreferences` use raw `fetch` against `/api/v1/onboarding/preferences`, which already exists in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L295) `workflows.listSummary` uses raw `fetch` for `/api/v1/workflows/summary`, which already exists in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L404) `components.resolvePorts` uses raw `fetch` for `/api/v1/components/{id}/resolve-ports`, which already exists in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L463) the whole `integrations` section still uses raw `fetch` for org connections, catalog, OAuth start/exchange, refresh, disconnect, AWS setup/validate/discover, and Slack connection test/create. These should move behind typed client methods or a typed wrapper.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L786) `auditLogs.list` uses raw `fetch` for `/api/v1/audit-logs`, which already exists in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L875) `executions.getTerminalChunks` uses raw `fetch` for `/api/v1/workflows/runs/{runId}/terminal`, which already exists in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L908) `executions.downloadArtifact` still uses raw `fetch` for `/api/v1/workflows/runs/{runId}/artifacts/{artifactId}/download`. The generated client has this path, but the code comment notes an OpenAPI parameter mismatch; this should move once the spec/wrapper mismatch is corrected.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L1119) `artifacts.download` and `artifacts.delete` use raw `fetch` for `/api/v1/artifacts/{id}` and `/api/v1/artifacts/{id}/download`, both already present in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L1362) the whole `analytics` section still uses raw `fetch` for `/analytics/query`, `/analytics/prowler-checks-metadata`, and `/analytics/batch-run-summaries`, all already present in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L1413) `billing.getUsage` and `billing.getPlans` use raw `fetch` for `/billing/usage` and `/billing/plans`, both already present in the generated client.

### Feature-specific frontend services

- [frontend/src/services/mcpDiscoveryApi.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/mcpDiscoveryApi.ts#L54) all four methods use raw `fetch` for `/api/v1/mcp/discover*`; those paths already exist in the generated client.
- [frontend/src/services/mcpGroupsApi.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/mcpGroupsApi.ts#L59) all MCP group operations use raw `fetch`; those paths already exist in the generated client.
- Exception: [frontend/src/services/mcpGroupsApi.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/mcpGroupsApi.ts#L176) `getGroupHealth()` calls `/api/v1/mcp-groups/{groupId}/health`, which is not currently represented in `packages/backend-client/src/client.ts`.

### Query/hooks layer

- [frontend/src/hooks/queries/useGithubQueries.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/hooks/queries/useGithubQueries.ts#L14) every query/mutation in this file goes straight to backend GitHub routes with raw `fetch`. All of those GitHub paths already exist in the generated client, so this hook layer should sit on top of typed wrapper methods instead.
- [frontend/src/hooks/queries/useWebhookQueries.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/hooks/queries/useWebhookQueries.ts#L64) `useRegenerateWebhookPath` uses raw `fetch` for `/api/v1/webhooks/configurations/{id}/regenerate-path`, which already exists in the generated client.
- [frontend/src/hooks/queries/useMcpServerQueries.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/hooks/queries/useMcpServerQueries.ts#L38) this entire file uses a local `apiRequest()` wrapper over raw `fetch` for MCP server routes that already exist in the generated client.

### UI files bypassing the service layer

- [frontend/src/pages/WorkflowTemplatesPage.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/pages/WorkflowTemplatesPage.tsx#L288) template list and instantiate both use raw `fetch`; workflow template routes already exist in the generated client and should move behind a shared query/service layer.
- [frontend/src/pages/GitHubPage.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/pages/GitHubPage.tsx#L1098) selected-rule trigger history uses raw `fetch` for `/api/v1/github/scans`; it should reuse the typed GitHub query/service path instead of issuing an ad hoc request in the page.
- [frontend/src/components/timeline/AgentTracePanel.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/components/timeline/AgentTracePanel.tsx#L731) transcript loading uses raw `fetch` for `/api/v1/agents/{agentRunId}/parts`, which already exists in the generated client.

### Stores still talking to backend directly

- [frontend/src/store/githubStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/githubStore.ts#L282) this legacy store still issues raw `fetch` calls for GitHub status, workflows, installations, repos, triggers, scans, manual scan, and branches. All of these backend routes already exist in the generated client. This is also duplicate API logic because `useGithubQueries.ts` does the same work separately.
- [frontend/src/store/chatStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/chatStore.ts#L129) `fetchJson()` is used for chat session list, create, delete, and title update at [frontend/src/store/chatStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/chatStore.ts#L167), [frontend/src/store/chatStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/chatStore.ts#L185), [frontend/src/store/chatStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/chatStore.ts#L197), and [frontend/src/store/chatStore.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/store/chatStore.ts#L244). `/api/v1/chat/sessions` and `/api/v1/chat/sessions/{id}` already exist in the generated client, so these can move to typed client calls.

## Worker: Should Migrate

The worker-side opportunity is to introduce a small internal typed client wrapper built on `@shipsec/backend-client` and use it anywhere the worker is calling ShipSec backend routes directly.

- [worker/src/temporal/activities/mcp.activity.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/mcp.activity.ts#L19) `callInternalApi()` posts to `/api/v1/internal/mcp/*` with raw `fetch`. Those internal MCP paths already exist in the generated client.
- [worker/src/temporal/activities/chat-agent.activities.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/chat-agent.activities.ts#L229) the REST fallback posts to `/api/v1/chat/sessions/{id}/internal/events`, and [worker/src/temporal/activities/chat-agent.activities.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/chat-agent.activities.ts#L267) completion posts to `/api/v1/chat/sessions/{id}/internal/run-completion`. Both paths already exist in the generated client.
- [worker/src/temporal/activities/run-dispatcher.activity.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/run-dispatcher.activity.ts#L17) posts to `/api/v1/internal/runs` with raw `fetch`; that path already exists in the generated client.
- [worker/src/components/ai/utils.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/ai/utils.ts#L12) posts to `/api/v1/internal/mcp/generate-token`, and [worker/src/components/ai/utils.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/ai/utils.ts#L107) fetches `/api/v1/internal/billing/litellm-key`; both routes already exist in the generated client.
- [worker/src/components/core/mcp-library-utils.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/core/mcp-library-utils.ts#L46) fetches `/api/v1/mcp-servers`, [worker/src/components/core/mcp-library-utils.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/core/mcp-library-utils.ts#L72) fetches `/api/v1/mcp-servers/{id}/resolve`, and [worker/src/components/core/mcp-library-utils.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/core/mcp-library-utils.ts#L222) posts to `/api/v1/internal/mcp/register-mcp-server`. All are generated-client candidates.
- [worker/src/components/core/mcp-group-runtime.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/core/mcp-group-runtime.ts#L352) posts to `/api/v1/internal/mcp/register-mcp-server` with raw `fetch`; that route already exists in the generated client.
- [worker/src/utils/opensearch-indexer.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/utils/opensearch-indexer.ts#L140) posts to `/api/v1/analytics/ensure-tenant` with raw `fetch`; that route already exists in the generated client.
- [worker/src/temporal/activities/asset-sync.activities.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/asset-sync.activities.ts#L43) uses a generic raw `callBackend()` helper. The calls to `/integrations/connections/{id}/credentials` at [worker/src/temporal/activities/asset-sync.activities.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/asset-sync.activities.ts#L87) and [worker/src/temporal/activities/asset-sync.activities.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/asset-sync.activities.ts#L149) can move to the typed client now. The `/asset-discovery/internal/sync-runs*` routes are not currently represented in `packages/backend-client/src/client.ts`, so those specific calls must stay raw until the OpenAPI spec includes them.

## Keep Raw `fetch`

These are intentional or at least reasonable to leave alone for now.

- [frontend/src/auth/AuthProvider.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/auth/AuthProvider.tsx#L96) and [frontend/src/components/auth/AdminLoginForm.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/components/auth/AdminLoginForm.tsx#L39): auth cookie login/logout should stay same-origin browser `fetch`.
- [frontend/src/lib/durable-chat-transport.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/lib/durable-chat-transport.ts#L216), [frontend/src/lib/durable-chat-transport.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/lib/durable-chat-transport.ts#L366), [frontend/src/lib/durable-chat-transport.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/lib/durable-chat-transport.ts#L448), and [frontend/src/lib/durable-chat-transport.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/lib/durable-chat-transport.ts#L468): this module owns chat streaming, retries, aborts, reconnects, and sequencing, so raw transport `fetch` is reasonable here even though some non-stream endpoints also exist in the generated client.
- [frontend/src/services/api.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/services/api.ts#L974): execution streaming uses `FetchEventSource`; raw transport fetch is appropriate.
- [frontend/src/utils/sse-client.ts](/Users/betterclever/shipsec/studio-wt3/frontend/src/utils/sse-client.ts#L114): SSE transport should stay raw because it needs direct stream/body handling.
- [frontend/src/components/ai-elements/prompt-input.tsx](/Users/betterclever/shipsec/studio-wt3/frontend/src/components/ai-elements/prompt-input.tsx#L67): this fetches a blob URL, not the backend API.
- [worker/src/temporal/activities/webhook-parsing.activity.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/webhook-parsing.activity.ts#L43), [worker/src/components/core/logic-script.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/core/logic-script.ts#L123), and [worker/src/temporal/activities/mcp-discovery.activity.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/temporal/activities/mcp-discovery.activity.ts#L346): these hit arbitrary external URLs or runtime-resolved MCP endpoints, so the backend typed client is not the right abstraction.
- [worker/src/components/github/create-check-run.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/github/create-check-run.ts#L165), [worker/src/components/github/update-check-run.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/github/update-check-run.ts#L157), [worker/src/components/github/post-pr-comment.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/github/post-pr-comment.ts#L141), [worker/src/components/github/pr-context.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/components/github/pr-context.ts#L231), [worker/src/adapters/loki-log.adapter.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/adapters/loki-log.adapter.ts#L58), and [worker/src/utils/opensearch-indexer.ts](/Users/betterclever/shipsec/studio-wt3/worker/src/utils/opensearch-indexer.ts#L151): these are third-party or non-ShipSec service calls and should stay raw.

## Cleanup Order

If we do the refactor, the highest-value order is:

1. Extend `ShipSecApiClient` with the already-generated routes currently missing convenience methods.
2. Collapse frontend service/query/store fetchers onto those typed methods.
3. Add a worker-scoped internal client wrapper for `X-Internal-Token` calls and migrate worker internal backend fetches.
4. Regenerate/fix OpenAPI for the few blocked routes such as the workflow-run artifact download mismatch and any missing asset-discovery internal endpoints.
