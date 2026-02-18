# Frontend State & Data Flow

ShipSec Studio's UI separates **server state** (data from the backend) from **client state** (UI-only concerns). Server state is managed exclusively through **TanStack Query** (`@tanstack/react-query`). Client-only state uses **Zustand** stores or local React state.

## Golden Rule

> **Never use `useState` + `useEffect` to fetch API data.** Always create or reuse a TanStack Query hook in `src/hooks/queries/`.

## Shared Types

- All schemas originate in `@shipsec/shared`. Import directly rather than re-declaring shapes.
- `src/schemas/*` re-exports shared schemas or wraps them with UI-specific helpers. Any contract change starts with `docs/execution-contract.md` → shared package → frontend schema update.

---

## Server State: TanStack Query

All data fetched from the backend flows through TanStack Query hooks located in `src/hooks/queries/`.

### Query Client Configuration

`src/lib/queryClient.ts` configures sensible defaults:

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // One retry on failure
      refetchOnWindowFocus: false, // No refetch on tab focus
      staleTime: 30_000, // 30s default stale time
    },
  },
});
```

### Query Key Conventions

All query keys live in `src/lib/queryKeys.ts` and follow these rules:

1. **Org-scoped**: Every key includes the current `organizationId` for multi-tenant isolation.
2. **Factory functions**: Keys are functions that return `readonly` tuples for type safety.
3. **Hierarchical**: Broader keys enable bulk invalidation (e.g., `['schedules']` invalidates all schedule queries).

```typescript
// src/lib/queryKeys.ts
export const queryKeys = {
  secrets: { all: () => ['secrets', getOrgScope()] as const },
  components: { all: () => ['components', getOrgScope()] as const },
  workflows: {
    list: () => ['workflows', getOrgScope()] as const,
    summary: () => ['workflowsSummary', getOrgScope()] as const,
    detail: (id) => ['workflow', getOrgScope(), id] as const,
  },
  integrations: {
    providers: () => ['integrationProviders', getOrgScope()] as const,
    providerConfig: (id) => ['providerConfig', getOrgScope(), id] as const,
  },
  schedules: { all: (filters?) => ['schedules', getOrgScope(), filters] as const },
  webhooks: { all: (filters?) => ['webhooks', getOrgScope(), filters] as const },
  humanInputs: { all: (filters?) => ['humanInputs', getOrgScope(), filters] as const },
  mcpGroups: {
    all: () => ['mcpGroups', getOrgScope()] as const,
    servers: (groupId) => ['mcpGroupServers', getOrgScope(), groupId] as const,
  },
  executions: {
    nodeIO: (runId) => ['executionNodeIO', getOrgScope(), runId] as const,
    result: (runId) => ['executionResult', getOrgScope(), runId] as const,
    run: (runId) => ['executionRun', getOrgScope(), runId] as const,
  },
  // ... see queryKeys.ts for the full list
};
```

### Query Hook Files

| Hook file                  | What it covers                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `useComponentQueries.ts`   | Component catalogue (`useComponents`)                                                                                                        |
| `useWorkflowQueries.ts`    | Workflow list, summary, detail, runtime inputs (`useWorkflowsList`, `useWorkflowsSummary`, `useWorkflow`, `useWorkflowRuntimeInputs`)        |
| `useScheduleQueries.ts`    | Schedules CRUD (`useSchedules`, `useCreateSchedule`, etc.)                                                                                   |
| `useWebhookQueries.ts`     | Webhooks CRUD + deliveries (`useWebhooks`, `useWebhook`, `useWebhookDeliveries`, `useCreateWebhook`, `useUpdateWebhook`, `useDeleteWebhook`) |
| `useSecretQueries.ts`      | Secrets management (`useSecrets`)                                                                                                            |
| `useApiKeyQueries.ts`      | API key management (`useApiKeys`)                                                                                                            |
| `useMcpGroupQueries.ts`    | MCP groups, servers, templates (`useMcpGroups`, `useMcpGroupServers`, `useMcpGroupTemplates`)                                                |
| `useHumanInputQueries.ts`  | Human input / action center (`useHumanInputs`)                                                                                               |
| `useExecutionQueries.ts`   | Execution data (`useExecutionNodeIO`, `useExecutionResult`, `useExecutionRun`)                                                               |
| `useRunQueries.ts`         | Workflow runs (`useRuns`, `useRunDetail`)                                                                                                    |
| `useArtifactQueries.ts`    | Artifacts library + per-run artifacts                                                                                                        |
| `useIntegrationQueries.ts` | Integration providers, connections, provider config (`useIntegrationProviders`, `useIntegrationConnections`, `useProviderConfig`)            |

### Writing a New Query Hook

```typescript
// src/hooks/queries/useExampleQueries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

// 1. Add keys to queryKeys.ts first:
//    examples: { all: (filters?) => ['examples', getOrgScope(), filters] as const }

// 2. Read hook — wraps useQuery
export function useExamples(filters?: { status?: string }) {
  return useQuery({
    queryKey: queryKeys.examples.all(filters as Record<string, unknown>),
    queryFn: () => api.examples.list(filters),
    staleTime: 15_000, // Override default if needed
  });
}

// 3. Mutation hook — wraps useMutation + invalidates cache
export function useDeleteExample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.examples.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['examples'] });
    },
  });
}
```

### Cache Invalidation Patterns

```typescript
// Invalidate all queries under a domain (broad)
queryClient.invalidateQueries({ queryKey: ['schedules'] });

// Invalidate a specific query (narrow)
queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all({ workflowId }) });
```

After mutations (create, update, delete), always invalidate the relevant queries rather than manually updating local state.

### Prefetch on Idle

`src/hooks/usePrefetchOnIdle.ts` warms the cache for commonly-needed data (components, workflow summaries) during browser idle time. This is called once in `AppLayout` so data is ready before the user navigates.

```typescript
// Runs during requestIdleCallback with a 5s timeout fallback
queryClient.prefetchQuery({
  queryKey: queryKeys.components.all(),
  queryFn: fetchComponentIndex,
  staleTime: 10 * 60_000,
});
```

When adding a new high-traffic query, consider adding it to the prefetch list.

---

## Client State: Zustand

Zustand stores handle **client-only UI state** that has no backend equivalent. They must never duplicate server data.

| Store                       | File                                  | What it owns                                                            |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `useWorkflowStore`          | `src/store/workflowStore.ts`          | In-flight builder graph (nodes, edges, metadata) and persistence hooks. |
| `useWorkflowUiStore`        | `src/store/workflowUiStore.ts`        | Canvas UI toggles, panel sizing, minimap state.                         |
| `useExecutionStore`         | `src/store/executionStore.ts`         | Workflow run lifecycle, SSE stream wiring, log/event aggregation.       |
| `useExecutionTimelineStore` | `src/store/executionTimelineStore.ts` | Timeline playback state and selected run/node.                          |
| `useAuthStore`              | `src/store/authStore.ts`              | Auth session, org/user IDs (used by queryKeys for org scoping).         |

Stores expose selectors (e.g. `getNodeLogs`) to avoid manual traversal in components. Prefer selectors and derived helpers over duplicating logic inside React components.

---

## Decision Guide: Where Does State Go?

| Question                                    | Answer                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| Does it come from the backend API?          | **TanStack Query hook** in `src/hooks/queries/`       |
| Is it UI-only and shared across components? | **Zustand store** in `src/store/`                     |
| Is it UI-only and scoped to one component?  | **Local `useState`**                                  |
| Is it derived from query data?              | **`useMemo`** in the component, fed by the query hook |

---

## Anti-Patterns (Do Not Do)

```typescript
// BAD: Manual fetch with useState + useEffect
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
useEffect(() => {
  api.things
    .list()
    .then(setData)
    .finally(() => setLoading(false));
}, []);

// GOOD: TanStack Query hook
const { data = [], isLoading } = useThings();
```

```typescript
// BAD: Manual cache / dedup / TTL logic
const lastFetchRef = useRef(0);
if (Date.now() - lastFetchRef.current < 30_000) return;

// GOOD: staleTime handles this automatically
useQuery({ queryKey: ..., queryFn: ..., staleTime: 30_000 });
```

```typescript
// BAD: Optimistic local state after mutation
setItems((prev) => prev.filter((i) => i.id !== deletedId));

// GOOD: Invalidate and let the query refetch
queryClient.invalidateQueries({ queryKey: ['items'] });
```

---

## Execution Monitoring Pipeline

1. `RunWorkflowDialog` invokes `useExecutionStore.startExecution`, which calls `api.executions.start()` (wrapping `POST /workflows/{id}/run`).
2. `monitorRun` seeds a poll + optional SSE stream (`api.executions.stream`). Responses are validated with `ExecutionStatusResponseSchema` and `TraceStreamEnvelopeSchema`.
3. `mergeEvents` dedupes trace events by id; `deriveNodeStates` converts those events into canvas node badges (see `WorkflowNode.tsx`). Separate helpers (`mergeLogEntries`) handle raw Loki log lines for the log viewer.
4. `useRunStore.fetchRuns` calls `api.executions.listRuns` scoped to the requested workflow and exposes cached metadata to `RunSelector`, inspectors, and `useExecutionTimelineStore`.

When the backend contract expands (new trace fields, statuses), update:

- `docs/execution-contract.md`
- `@shipsec/shared` schemas
- Store merge helpers/tests under `src/store/__tests__`

## API Layer Expectations

- `src/services/api.ts` is the only place that touches the generated client. All responses are parsed through Zod before hitting query hooks.
- New endpoints should be added to `api.ts` first, then wrapped in a query hook in `src/hooks/queries/`.

## Performance Optimizations

For the complete performance reference — bundle splitting, stale time strategy, idle prefetch, rendering optimization, Zustand selectors, and anti-patterns — see **[`docs/performance.md`](./performance.md)**.

TL;DR: TanStack Query handles deduplication via query keys. Vite manual chunks separate vendor libraries. All page routes use `React.lazy()`. Static data uses `staleTime: Infinity`.

## Testing Strategy

- Store tests live in `src/store/__tests__/*.test.ts`. Mock `api` to emulate backend behaviour.
- Use `bun test` for tests with Testing Library.
- Aim to cover merge/diff logic or any selector that massages data so runtime regressions surface quickly.
