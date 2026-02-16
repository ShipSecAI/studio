---
name: performance-patterns
description: Performance patterns for frontend stores, API calls, backend services, and Temporal interactions. Load this skill when building features that touch API endpoints, Zustand stores, or workflow run status.
---

# Performance Patterns

**Full guide:** `docs/development/performance-patterns.md`

---

## 1. Temporal RPC Avoidance

**Rule:** Never call Temporal for terminal runs. Always check the DB cache first.

Terminal statuses are defined in `packages/shared/src/execution.ts`:

```typescript
import { TERMINAL_STATUSES } from '@shipsec/shared';
// ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']
```

**Pattern (backend service):**

```typescript
// GOOD: Cache-first
if (run.status && TERMINAL_STATUSES.includes(run.status)) {
  return run.status; // DB hit only, no Temporal RPC
}
// Only call Temporal for non-terminal (running/pending) runs
const desc = await this.temporalService.describeWorkflow({ workflowId: run.runId });

// Cache terminal result fire-and-forget
if (TERMINAL_STATUSES.includes(normalizedStatus)) {
  this.runRepository
    .cacheTerminalStatus(run.runId, normalizedStatus, closeTime)
    .catch((err) => this.logger.warn(`Cache failed: ${err}`));
}
```

```typescript
// BAD: Always calling Temporal
const desc = await this.temporalService.describeWorkflow({ workflowId: run.runId });
```

**Rule:** Always use the shared `TERMINAL_STATUSES` constant. Never hardcode terminal status arrays.

```typescript
// BAD
if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) { ... }

// GOOD
import { TERMINAL_STATUSES } from '@shipsec/shared';
if ((TERMINAL_STATUSES as readonly string[]).includes(status)) { ... }
```

---

## 2. Lightweight List Endpoints

**Rule:** List pages should use summary endpoints that exclude heavy fields (like `graph` JSON).

```typescript
// BAD: Fetching full workflow objects for a list page
const workflows = await api.workflows.list();

// GOOD: Fetch only metadata needed for display
const workflows = await api.workflows.listSummary();
```

**When creating new list endpoints:** Return only the fields needed for display (id, name, description, counts, timestamps). Never include serialized graphs, full configs, or nested objects in list responses.

---

## 3. Frontend Lazy Loading

**Rule:** All page-level components must use `React.lazy()`.

```typescript
// GOOD
const MyNewPage = lazy(() => import('@/pages/MyNewPage').then((m) => ({ default: m.MyNewPage })));

// BAD: Direct import at top level
import { MyNewPage } from '@/pages/MyNewPage';
```

Pages are wrapped in a shared `<Suspense>` in `App.tsx`. Do not add per-page Suspense boundaries unless the page has sub-routes with their own lazy components.

---

## 4. Store Fetch Deduplication

**Rule:** Zustand stores that fetch data must guard against redundant fetches.

**Pattern: Skip-if-loaded**

```typescript
// GOOD
fetchComponents: async () => {
  if (get().components.length > 0) return; // Already loaded
  const data = await api.components.list();
  set({ components: data });
},
```

**Pattern: Cooldown + inflight dedup** (for data that refreshes)

```typescript
// GOOD: Prevent rapid re-fetching
const COOLDOWN_MS = 5000;
const lastFetchRef = useRef(0);
const inflightRef = useRef<Promise<void> | null>(null);

const fetchData = async () => {
  if (Date.now() - lastFetchRef.current < COOLDOWN_MS) return;
  if (inflightRef.current) return inflightRef.current;

  const promise = doFetch().finally(() => {
    inflightRef.current = null;
  });
  inflightRef.current = promise;
  lastFetchRef.current = Date.now();
  return promise;
};
```

---

## 5. Paginated Data Loading

**Rule:** Lists with potentially many items should load a small initial batch with "load more".

```typescript
// GOOD: Paginated with initial limit
const INITIAL_LIMIT = 5;
const LOAD_MORE_LIMIT = 20;

fetchRuns: async (workflowId) => {
  const runs = await api.workflows.listRuns({ workflowId, limit: INITIAL_LIMIT });
  set({ runs, hasMore: runs.length === INITIAL_LIMIT });
},
fetchMoreRuns: async (workflowId) => {
  const current = get().runs;
  const more = await api.workflows.listRuns({
    workflowId, limit: LOAD_MORE_LIMIT, offset: current.length,
  });
  set({ runs: [...current, ...more], hasMore: more.length === LOAD_MORE_LIMIT });
},
```

**Backend:** All list endpoints should accept `limit` and `offset` parameters.

---

## 6. Smart Polling

**Rule:** Only poll for live/running data. Stop polling when data reaches a terminal state.

```typescript
// GOOD: Only poll non-terminal runs
import { isRunLive } from '@/features/workflow-builder/utils/executionRuns';

useEffect(() => {
  if (!isRunLive(currentRun)) return; // No polling needed
  const interval = setInterval(() => refreshStatus(), 3000);
  return () => clearInterval(interval);
}, [currentRun?.status]);
```

```typescript
// BAD: Polling regardless of status
useEffect(() => {
  const interval = setInterval(() => refreshStatus(), 3000);
  return () => clearInterval(interval);
}, []);
```

Use `isRunLive()` from `frontend/src/features/workflow-builder/utils/executionRuns.ts` for run liveness checks.

---

## 7. Conditional Data Fetching

**Rule:** Don't fetch data the user hasn't asked for yet.

```typescript
// GOOD: Only fetch runs when entering execution mode
if (mode === 'execution' || routeRunId) {
  await fetchRuns(workflowId);
}

// BAD: Always fetch runs on page load
useEffect(() => {
  fetchRuns(workflowId);
}, [workflowId]);
```

---

## Quick Checklist for New Features

- [ ] Page component uses `React.lazy()` in `App.tsx`
- [ ] List endpoint returns only display-needed fields (no full graphs/configs)
- [ ] Store fetches are deduplicated (skip-if-loaded or cooldown)
- [ ] Lists with >10 potential items use pagination (limit + offset)
- [ ] Polling stops for terminal/completed states
- [ ] Terminal status checks use shared `TERMINAL_STATUSES` from `@shipsec/shared`
- [ ] Backend services check cached status before calling Temporal
