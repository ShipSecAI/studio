# Frontend Performance Guidelines

Authoritative reference for all performance patterns in the ShipSec Studio frontend. Every new feature, page, and query hook must follow these guidelines.

**Enforcement:** Rules 11-15 in `AGENTS.md` are mandatory. This document provides the detail and rationale.

**Agent skills:** Use `/performance-review` to audit code changes against these guidelines. Use `/stress-test-frontend` to run a full load testing audit with Chrome DevTools.

---

## TL;DR: Mandatory Checklist

Scan this before shipping any frontend change.

### Data Fetching

- **DO** use TanStack Query hooks in `src/hooks/queries/` for all API data
- **DON'T** use `useState` + `useEffect` to fetch backend data
- **DO** add query keys to `src/lib/queryKeys.ts` using factory functions
- **DON'T** construct query keys inline in components
- **DO** set `staleTime: Infinity` for static reference data (components, templates, providers)
- **DO** use `skipToken` for conditional queries instead of `enabled: false` with `undefined` queryFn
- **DO** use `select` transforms for sorting/filtering instead of `useMemo` in the component
- **DON'T** fetch a list then loop to fetch each item — use a batched endpoint
- **DO** add frequently-used queries to `usePrefetchOnIdle.ts`
- **DO** use `queryOptions()` factories when a query is shared between hooks and imperative code

### Bundle & Loading

- **DO** add new page routes as `React.lazy()` imports in `App.tsx`
- **DON'T** statically import page-level components in `App.tsx`
- **DO** add new sidebar pages to `routePrefetchMap` in `src/lib/prefetch-routes.ts`
- **DO** use deferred load pattern for rarely-visible components that import large libraries

### Rendering

- **DO** derive data from query results using `useMemo`, not by copying into `useState`
- **DO** use granular Zustand selectors: `useStore((s) => s.field)`
- **DON'T** destructure from a full store call: `const store = useStore()`
- **DO** consider `React.memo` for components on hot render paths (timeline, canvas edges)
- **DON'T** memoize every component — only hot paths with stable, comparable props

### Cache

- **DO** invalidate query cache after mutations via `queryClient.invalidateQueries()`
- **DON'T** manually update local state after mutations

---

## Pattern Catalog

### 1. TanStack Query Configuration

**Source:** `src/lib/queryClient.ts`

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // One retry on failure, prevents retry thrashing
      refetchOnWindowFocus: false, // App uses SSE/polling for live data
      staleTime: 30_000, // 30s default — cached data served fresh for 30s
    },
  },
});
```

**Rules:**

- Do NOT create a second QueryClient. One instance in `queryClient.ts`.
- `refetchOnWindowFocus` is off because the app uses real-time SSE/polling for live data. Tab-focus refetch would create redundant requests during execution monitoring.
- Override stale time per-query only when you have a specific reason (see Section 3).

---

### 2. Query Key Architecture

#### 2.1 Org-scoped factory functions

**Source:** `src/lib/queryKeys.ts`

Every key includes `getOrgScope()` which reads from `authStore` imperatively (outside React). This provides multi-tenant cache isolation without threading org IDs as props.

```typescript
const getOrgScope = () => useAuthStore.getState().organizationId || '__no-org__';

export const queryKeys = {
  components: { all: () => ['components', getOrgScope()] as const },
  workflows: {
    list: () => ['workflows', getOrgScope()] as const,
    summary: () => ['workflowsSummary', getOrgScope()] as const,
    detail: (id: string) => ['workflow', getOrgScope(), id] as const,
  },
  runs: {
    byWorkflow: (workflowId: string) => ['runs', getOrgScope(), workflowId] as const,
    global: () => ['runs', getOrgScope(), '__global__'] as const,
    detail: (runId: string) => ['runs', getOrgScope(), 'detail', runId] as const,
  },
  // ... see queryKeys.ts for the full list
};
```

**Hierarchy enables bulk invalidation:** invalidating `['workflows']` prefix invalidates all workflow queries simultaneously.

**Rule:** Never construct query keys inline in a component. Always import from `queryKeys.ts`.

#### 2.2 queryOptions() shared factories

**Source:** `src/lib/executionQueryOptions.ts`

`queryOptions()` from TanStack Query wraps key + queryFn + staleTime into a single object consumable by both `useQuery()` (React) and `queryClient.fetchQuery()` (imperative). This ensures a single in-flight promise — no duplicate requests.

```typescript
// Shared options — used by both useExecutionNodeIO hook AND executionStore actions
export const executionNodeIOOptions = (runId: string, isTerminal?: boolean) =>
  queryOptions({
    queryKey: queryKeys.executions.nodeIO(runId),
    queryFn: () => api.executions.listNodeIO(runId),
    staleTime: isTerminal ? Infinity : 10_000,
    gcTime: isTerminal ? 10 * 60_000 : 30_000,
  });
```

**When:** Use for queries accessed from both React components AND store actions/callbacks.

**Anti-pattern:** Duplicating the queryKey in two places causes cache misses.

---

### 3. Stale Time Strategy

Four tiers of staleness, from coldest to hottest:

#### Tier A — Static reference data (`staleTime: Infinity, gcTime: Infinity`)

Data that only changes on admin action, not user action. Fetched once, cached forever.

```typescript
// src/hooks/queries/useComponentQueries.ts
export function useComponents() {
  return useQuery({
    queryKey: queryKeys.components.all(),
    queryFn: fetchComponentIndex,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
```

**Applies to:** `useComponents`, `useIntegrationProviders`, `useMcpGroupTemplates`

#### Tier B — Default (30s, inherits global)

User-owned entities that change occasionally. No override needed.

**Applies to:** schedules, webhooks, secrets, workflow runs list, artifacts

#### Tier C — Terminal-run Infinity (`terminalStaleTime` pattern)

Runs in terminal state (COMPLETED, FAILED, CANCELLED) will never change. Once detected, staleTime becomes Infinity.

```typescript
// src/hooks/queries/useRunQueries.ts
export function terminalStaleTime(runId: string | null | undefined, defaultMs: number): number {
  if (!runId) return defaultMs;
  const cached = getRunByIdFromCache(runId);
  if (cached && TERMINAL_STATUSES.includes(cached.status)) return Infinity;
  return defaultMs;
}
```

**Used by:** `executionNodeIOOptions`, `executionResultOptions`, `executionRunOptions`

#### Tier D — Polling-backed (`staleTime: 0`)

Execution status and trace during live runs — must always be fresh. Polling refetches on every interval.

```typescript
// src/lib/executionQueryOptions.ts
export const executionStatusOptions = (runId: string) =>
  queryOptions({
    queryKey: queryKeys.executions.status(runId),
    queryFn: () => api.executions.getStatus(runId),
    staleTime: 0, // Always stale — poll backing
    gcTime: 30_000,
    retry: false,
  });
```

**Applies to:** `executionStatusOptions`, `executionTraceOptions`, `executionEventsOptions`, `executionDataFlowsOptions`

#### Full stale time reference

| Query                            | staleTime                        | gcTime                     |
| -------------------------------- | -------------------------------- | -------------------------- |
| `useComponents`                  | `Infinity`                       | `Infinity`                 |
| `useMcpGroupTemplates`           | `Infinity`                       | `Infinity`                 |
| `useIntegrationProviders`        | `Infinity`                       | `Infinity`                 |
| `useMcpServers`                  | `120_000`                        | default                    |
| `useMcpAllTools`                 | `120_000`                        | default                    |
| `useWorkflowsSummary`            | `60_000`                         | default                    |
| `useWorkflow`                    | `60_000`                         | default                    |
| `useSchedules`                   | `60_000`                         | default                    |
| `useIntegrationConnections`      | `60_000`                         | default                    |
| `useWorkflowsList`               | `30_000`                         | default                    |
| `useWorkflowRuns`                | `30_000`                         | default                    |
| `useArtifactLibrary`             | `30_000`                         | default                    |
| `executionNodeIOOptions`         | `isTerminal ? Infinity : 10_000` | `isTerminal ? 10min : 30s` |
| `executionResultOptions`         | `isTerminal ? Infinity : 30_000` | `isTerminal ? 10min : 30s` |
| `executionRunOptions`            | `isTerminal ? Infinity : 30_000` | `isTerminal ? 10min : 30s` |
| `executionTerminalChunksOptions` | `10_000`                         | `30_000`                   |
| `executionStatusOptions`         | `0`                              | `30_000`                   |
| `executionTraceOptions`          | `0`                              | `30_000`                   |
| `executionEventsOptions`         | `0`                              | `30_000`                   |
| `executionDataFlowsOptions`      | `0`                              | `30_000`                   |

---

### 4. Bundle Splitting & Code Loading

#### 4.1 Manual Rollup chunks

**Source:** `vite.config.ts`

Groups vendor libraries into stable named chunks. The browser can cache `vendor-react` across app updates.

```typescript
manualChunks: {
  'vendor-react': ['react', 'react-dom', 'react-router-dom'],
  'vendor-radix': [
    '@radix-ui/react-accordion', '@radix-ui/react-avatar',
    '@radix-ui/react-checkbox', '@radix-ui/react-dialog',
    // ... 13 Radix primitives
  ],
  'vendor-analytics': ['posthog-js'],
},
```

**Rule:** When adding a new Radix primitive, add it to `vendor-radix`. When adding a large new vendor library, consider creating a new chunk.

#### 4.2 React.lazy for all page routes

**Source:** `src/App.tsx`

Every page component uses `React.lazy()`. The initial bundle only contains `AppLayout`, auth providers, and routing infrastructure.

```typescript
const WorkflowList = lazy(() =>
  import('@/pages/WorkflowList').then((m) => ({ default: m.WorkflowList })),
);
```

**Rule:** Every new page MUST use this pattern. Never add a page as a static import in App.tsx.

#### 4.3 Suspense with PageSkeleton fallback

**Source:** `src/App.tsx`

A single `<Suspense fallback={<PageSkeleton />}>` wraps all routes. `PageSkeleton` renders placeholder content sized to match real page dimensions, preventing layout shift (CLS = 0).

**Rule:** Do not add per-page Suspense boundaries with empty fallbacks.

#### 4.4 Deferred chunk load (CommandPalette pattern)

**Source:** `src/App.tsx`

CommandPalette imports lucide-react's entire icon barrel (~350KB). It's lazy-loaded AND deferred — only mounts after the user opens it for the first time.

```typescript
function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen && !hasOpened) setHasOpened(true);
  }, [isOpen, hasOpened]);

  return (
    <>
      {children}
      {hasOpened && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </>
  );
}
```

**When to apply:** Components that (a) are rarely used on first load, (b) import a large library, (c) are always hidden initially. NOT for components visible on first render.

#### 4.5 Idle-time and hover route chunk prefetch

**Source:** `src/lib/prefetch-routes.ts`, `src/components/layout/AppLayout.tsx`

`prefetchIdleRoutes()` downloads all sidebar route chunks during `requestIdleCallback`. `prefetchRoute(href)` downloads a single chunk on sidebar link hover.

```typescript
const routePrefetchMap: Record<string, PrefetchFn> = {
  '/': () => void import('@/pages/WorkflowList'),
  '/schedules': () => void import('@/pages/SchedulesPage'),
  '/webhooks': () => void import('@/pages/WebhooksPage'),
  // ... all sidebar routes
};

export function prefetchIdleRoutes(): void {
  const prefetch = () => Object.values(routePrefetchMap).forEach((fn) => fn());
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(prefetch, { timeout: 10_000 });
  } else {
    setTimeout(prefetch, 3_000);
  }
}
```

**Rule:** When adding a new sidebar-linked page, add it to `routePrefetchMap`.

#### 4.6 Idle-time data prefetch

**Source:** `src/hooks/usePrefetchOnIdle.ts`

Called once in `AppLayout`. Uses `requestIdleCallback` (5s timeout fallback) to warm the cache for high-value queries.

```typescript
export function usePrefetchOnIdle() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    const prefetch = () => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.components.all(),
        queryFn: fetchComponentIndex,
        staleTime: Infinity,
        gcTime: Infinity,
      });
      queryClient.prefetchQuery({
        queryKey: queryKeys.workflows.summary(),
        queryFn: () => api.workflows.listSummary(),
        staleTime: 60_000,
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 5_000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(prefetch, 2_000);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);
}
```

**When to add:** If your query is used on almost every page and has `staleTime >= 30s`, consider adding it here.

---

### 5. React Rendering Optimization

#### 5.1 useMemo for derived data

**Enforced in AGENTS.md rule 9.**

When you need to filter, sort, or transform query data, use `useMemo`. Never copy query results into `useState`.

```typescript
// BAD: Derived state in useState causes extra renders and stale data
const [sorted, setSorted] = useState([]);
useEffect(() => setSorted([...data].sort(...)), [data]);

// GOOD: useMemo recalculates only when data changes
const sorted = useMemo(() => [...(data ?? [])].sort(...), [data]);
```

#### 5.2 React.memo on hot-path components

`memo()` prevents re-renders when parent re-renders but props haven't changed.

**Apply to:** Components that (a) render frequently due to parent state changes, (b) have expensive render logic, (c) receive stable, comparable props.

**Current usage:** `DataFlowEdge` (canvas edge — re-renders during timeline playback), `MarkdownView` (large markdown content).

**When NOT to:** Don't memoize every component. Only components on hot paths in the timeline or canvas.

#### 5.3 select transforms in useQuery

The `select` option transforms cached data before returning it to the component. The transform runs only when cached data changes, not on every render.

```typescript
// src/hooks/queries/useIntegrationQueries.ts
export function useIntegrationProviders() {
  return useQuery({
    queryKey: queryKeys.integrations.providers(),
    queryFn: () => api.integrations.listProviders(),
    staleTime: Infinity,
    gcTime: Infinity,
    select: sortProviders, // Sort runs once when data changes, not on every re-render
  });
}
```

**When:** Use `select` for sorting, filtering, or shape-mapping operations that would otherwise go in `useMemo` in a component.

---

### 6. Zustand Store Optimization

#### 6.1 Granular per-field selectors

Call `useStore((s) => s.specificField)` rather than `useStore()`. Zustand only re-renders when the selected value changes.

```typescript
// BAD: subscribes to the whole store, re-renders on any field change
const store = useWorkflowUiStore();
const { mode, inspectorTab } = store;

// GOOD: two subscriptions, each re-renders only when its field changes
const mode = useWorkflowUiStore((s) => s.mode);
const inspectorTab = useWorkflowUiStore((s) => s.inspectorTab);
```

**Rule:** Never destructure from a full store call.

#### 6.2 subscribeWithSelector middleware

**Source:** `src/store/executionTimelineStore.ts`

Enables subscribing to a store slice outside React with equality comparison. Used for cross-store coordination.

```typescript
// executionStore subscribes to only specific fields of executionTimelineStore
useExecutionTimelineStore.subscribe(
  (state) => ({ currentTime: state.currentTime, playbackMode: state.playbackMode }),
  (selected) => {
    /* only runs when currentTime or playbackMode change */
  },
);
```

**When:** Use when one store needs to react to state changes in another store.

#### 6.3 persist with partialize

**Source:** `src/store/workflowUiStore.ts`

`persist` serializes store slices to localStorage. `partialize` limits which fields are persisted.

**Rule:** Always provide `partialize`. Never persist the whole store including action functions.

#### 6.4 Dynamic import for cross-store lazy coupling

**Source:** `src/store/executionStore.ts`, `src/store/executionTimelineStore.ts`

Mutually-referenced stores use `await import('./executionTimelineStore')` inside action functions to avoid circular imports at module evaluation time.

**When:** Use when Store A and Store B genuinely need to call each other's actions.

---

### 7. Real-time & Streaming

#### 7.1 SSE + polling hybrid with adaptive rate

**Source:** `src/store/executionStore.ts`

During workflow execution, the app tries SSE first. If unavailable, it falls back to polling. When SSE is active, polling interval is extended (2s → 5s) as a backup.

**Rule:** New real-time features should follow SSE-first + polling-fallback, not polling-only.

#### 7.2 N+1 query avoidance

**Source:** `src/hooks/queries/useMcpGroupQueries.ts`

When a page needs groups AND their servers, use the batched `useMcpGroupsWithServers()` endpoint instead of looping `useMcpGroupServers(groupId)`.

**Rule:** If you find yourself calling a query hook inside a `.map()`, you have an N+1 problem. Request a batched endpoint from the backend.

#### 7.3 Terminal chunk cap

**Source:** `src/store/executionStore.ts`

`MAX_TERMINAL_CHUNKS = 500` limits memory consumption for long-running processes. Uses `slice(-MAX_TERMINAL_CHUNKS)` to trim.

---

### 8. Cache Manipulation Patterns

#### 8.1 Manual setQueryData cache upsert

**Source:** `src/hooks/queries/useRunQueries.ts`

`upsertRunInCache()` calls `queryClient.setQueryData()` to inject or update a run in all matching cache entries. SSE events immediately reflect in the UI without waiting for a refetch.

```typescript
export function upsertRunInCache(run: ExecutionRun) {
  const upsert = (old: RunsPage | undefined): RunsPage => {
    if (!old) return { runs: [run], hasMore: false };
    const existingIndex = old.runs.findIndex((r) => r.id === run.id);
    if (existingIndex === -1) {
      return { ...old, runs: sortRuns([...old.runs, run]) };
    }
    const updated = [...old.runs];
    updated[existingIndex] = { ...updated[existingIndex], ...run, status: run.status };
    return { ...old, runs: sortRuns(updated) };
  };
  // Update workflow-scoped, global, and detail caches
  queryClient.setQueryData<RunsPage>(queryKeys.runs.byWorkflow(run.workflowId), upsert);
  queryClient.setQueryData<RunsPage>(queryKeys.runs.global(), upsert);
  queryClient.setQueryData(queryKeys.runs.detail(run.id), run);
}
```

**When:** Use after receiving real-time updates you trust. For optimistic updates that need rollback, use TanStack Query's `onMutate` pattern instead.

#### 8.2 Paginated load-more with cache append

**Source:** `src/hooks/queries/useRunQueries.ts`

`fetchMoreRuns()` reads existing cache to determine offset, fetches the next page, and appends with `setQueryData`. Previously loaded runs are preserved.

```typescript
export async function fetchMoreRuns(workflowId: string | null | undefined) {
  const existing = queryClient.getQueryData<RunsPage>(queryKey);
  if (!existing || !existing.hasMore) return;

  const offset = existing.runs.length;
  const response = await api.executions.listRuns({ limit: LOAD_MORE_LIMIT, offset });
  const normalized = rawRuns.map(normalizeRun);

  queryClient.setQueryData<RunsPage>(queryKey, (old) => {
    const existingIds = new Set(old.runs.map((r) => r.id));
    const newRuns = normalized.filter((r) => !existingIds.has(r.id));
    return {
      runs: sortRuns([...old.runs, ...newRuns]),
      hasMore: rawRuns.length >= LOAD_MORE_LIMIT,
    };
  });
}
```

---

## Anti-Patterns Reference

### 1. useState + useEffect for API data

```typescript
// BAD: Extra renders, no dedup, no caching, no error retry
const [data, setData] = useState([]);
useEffect(() => {
  api.things.list().then(setData);
}, []);

// GOOD: TanStack Query hook
const { data = [] } = useThings();
```

### 2. Inline query keys

```typescript
// BAD: Cache misses, invalidation doesn't work
useQuery({ queryKey: ['workflows', orgId], ... });

// GOOD: Factory from queryKeys.ts
useQuery({ queryKey: queryKeys.workflows.list(), ... });
```

### 3. Full Zustand store subscription

```typescript
// BAD: Re-renders on every store update
const { mode, inspectorTab } = useWorkflowUiStore();

// GOOD: Per-field selectors
const mode = useWorkflowUiStore((s) => s.mode);
```

### 4. N+1 queries (fetching in a loop)

```typescript
// BAD: O(n) network requests
groups.map((g) => useMcpGroupServers(g.id)); // Also invalid — hooks in loops

// GOOD: Batched endpoint
const { data } = useMcpGroupsWithServers();
```

### 5. Copying query data into useState

```typescript
// BAD: Stale data, double renders
const { data } = useWorkflows();
const [sorted, setSorted] = useState([]);
useEffect(() => setSorted(sortBy(data)), [data]);

// GOOD: useMemo
const sorted = useMemo(() => sortBy(data ?? []), [data]);
```

### 6. Static import of a lazy chunk

```typescript
// BAD: Bloats initial bundle
import { WorkflowList } from '@/pages/WorkflowList';

// GOOD: Dynamic import
const WorkflowList = lazy(() => import('@/pages/WorkflowList').then(...));
```

### 7. Missing staleTime for static data

```typescript
// BAD: Refetches components every 30s (they rarely change)
useQuery({ queryKey: queryKeys.components.all(), queryFn: fetchComponentIndex });

// GOOD: Infinite cache for static reference data
useQuery({
  queryKey: queryKeys.components.all(),
  queryFn: fetchComponentIndex,
  staleTime: Infinity,
  gcTime: Infinity,
});
```

---

## New Feature Checklist

Run through this before submitting a PR:

### Data Fetching

- [ ] All API data goes through a TanStack Query hook in `src/hooks/queries/`
- [ ] Query key added to `queryKeys.ts` using factory function pattern
- [ ] `staleTime` set appropriately (Infinity for static, 30s for user data, 0 for polling)
- [ ] `skipToken` used for conditional queries (not `enabled: false` with undefined queryFn)
- [ ] `select` transform used if data needs sorting/filtering before component use
- [ ] Static/reference data considered for `usePrefetchOnIdle.ts`
- [ ] Batched endpoint used if fetching list + per-item details

### Bundle

- [ ] New page routes use `React.lazy()` in `App.tsx` (not static import)
- [ ] New sidebar pages added to `routePrefetchMap` in `src/lib/prefetch-routes.ts`
- [ ] Rarely-visible heavy components use deferred load pattern (see CommandPalette)

### Rendering

- [ ] `useMemo` used for derived data from query results (not `useState`)
- [ ] Zustand selectors select per-field, not the full store
- [ ] `React.memo` considered for components that render frequently with stable props

### Cache

- [ ] Mutations call `queryClient.invalidateQueries()` after success
- [ ] Real-time updates use `upsertRunInCache()` pattern, not forcing a refetch

---

## Known Gaps

These are deliberate omissions, not oversights. Do not add them without discussing first.

- **Virtual scrolling:** No virtual list library is installed. For long lists, use load-more pagination (see `fetchMoreRuns` pattern).
- **Image optimization:** No Next.js Image or similar. Not needed currently (no image-heavy pages).
- **Error boundaries:** No React ErrorBoundary components. Errors propagate to TanStack Query's `isError` state.
- **Service Worker / offline:** No PWA setup. All data requires network.
