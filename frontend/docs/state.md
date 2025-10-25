# Frontend State & Data Flow

ShipSec Studio’s UI relies on a handful of focused Zustand stores and shared Zod schemas. This guide explains how they interact with the backend contract and when to touch each layer.

## Shared Types
- All schemas originate in `@shipsec/shared`. Import directly rather than re-declaring shapes.
- `src/schemas/*` re-exports shared schemas or wraps them with UI-specific helpers. Any contract change starts with `docs/execution-contract.md` → shared package → frontend schema update.

## Core Stores

| Store | File | What it owns |
| --- | --- | --- |
| `useWorkflowStore` | `src/store/workflowStore.ts` | In-flight builder graph (nodes, edges, metadata) and persistence hooks. |
| `useWorkflowUiStore` | `src/store/workflowUiStore.ts` | Canvas UI toggles, panel sizing, minimap state. |
| `useComponentStore` | `src/store/componentStore.ts` | Cached component catalogue fetched via `api.components.list()`. Maintains slug ↔︎ id index. |
| `useExecutionStore` | `src/store/executionStore.ts` | Workflow run lifecycle, SSE stream wiring, log/event aggregation. |
| `useExecutionTimelineStore` | `src/store/executionTimelineStore.ts` | Recent run history for the timeline panel. |
| `useSecretStore` | `src/store/secretStore.ts` | Secret summaries + optimistic updates for the Secret Fetch UX. |

Stores expose selectors (e.g. `getComponent`, `getNodeLogs`) to avoid manual traversal in components. Prefer selectors and derived helpers over duplicating logic inside React components.

## Execution Monitoring Pipeline
1. `RunWorkflowDialog` invokes `useExecutionStore.startExecution`, which calls `api.executions.start()` (wrapping `POST /workflows/{id}/run`).
2. `monitorRun` seeds a poll + optional SSE stream (`api.executions.stream`). Responses are validated with `ExecutionStatusResponseSchema` and `TraceStreamEnvelopeSchema`.
3. `mergeLogs` dedupes events by id; `deriveNodeStates` converts trace events into canvas node badges (see `WorkflowNode.tsx`).
4. Timeline views call `api.executions.listRuns` and hydrate `useExecutionTimelineStore`.

When the backend contract expands (new trace fields, statuses), update:
- `docs/execution-contract.md`
- `@shipsec/shared` schemas
- Store merge helpers/tests under `src/store/__tests__`

## API Layer Expectations
- `src/services/api.ts` is the only place that touches the generated client. All responses are parsed through Zod before hitting stores.
- New endpoints should be added to `api.ts` first, with lightweight unit coverage if parsing logic branches.

## Testing Strategy
- Store tests live in `src/store/__tests__/*.test.ts`. Mock `api` to emulate backend behaviour.
- Use `bun --cwd frontend run test` for Jest-style tests with Testing Library.
- Aim to cover merge/diff logic or any selector that massages data so runtime regressions surface quickly.
