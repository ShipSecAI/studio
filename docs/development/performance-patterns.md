# Performance Patterns

This document describes the performance patterns used across ShipSec Studio. All new features should follow these patterns.

## Architecture Overview

```
Frontend (React)                    Backend (NestJS)                  Temporal
┌─────────────────┐                ┌──────────────────┐              ┌──────────┐
│ Lazy pages       │  ──summary──> │ Summary endpoints │              │          │
│ Paginated stores │  ──offset───> │ Paginated queries │              │          │
│ Smart polling    │  ──status──>  │ Cache-first check │──(miss)────> │ Describe │
│ Dedup fetches    │               │ Fire-and-forget   │<─(cache)──── │          │
└─────────────────┘                │   cache write     │              └──────────┘
                                   └──────────────────┘
                                          │
                                   ┌──────┴───────┐
                                   │  PostgreSQL   │
                                   │  status cache │
                                   └──────────────┘
```

---

## 1. Temporal RPC Caching

### Problem

Every call to `temporalService.describeWorkflow()` is a gRPC round-trip to the Temporal server (~50-200ms). For list pages showing 50+ workflow runs, this means 50+ RPCs just to resolve statuses — most of which are terminal and will never change.

### Solution: Cache-First Pattern

Terminal run statuses (COMPLETED, FAILED, CANCELLED, TERMINATED, TIMED_OUT) are cached in the `workflow_runs` table (`status` and `close_time` columns). The canonical list is defined in `packages/shared/src/execution.ts` as `TERMINAL_STATUSES`.

**Flow:**

1. Check `workflow_runs.status` — if it's a terminal status, return immediately (DB only)
2. If NULL (not cached), call Temporal to get current status
3. If the Temporal result is terminal, fire-and-forget write the status + close_time to the DB
4. If Temporal returns NOT_FOUND, infer status from trace events but **do NOT cache** (inference is best-effort)

**Key files:**

- `packages/shared/src/execution.ts` — `TERMINAL_STATUSES` constant
- `backend/src/database/schema/workflow-runs.ts` — `status` and `closeTime` columns
- `backend/src/workflows/repository/workflow-run.repository.ts` — `cacheTerminalStatus()` method
- `backend/src/workflows/workflows.service.ts` — cache-first logic in `buildRunSummary()` and `getRunStatus()`

### Rules

- **Always** use `TERMINAL_STATUSES` from `@shipsec/shared`. Never hardcode status arrays.
- **Never** cache non-terminal statuses — they change frequently and caching would serve stale data.
- **Always** use fire-and-forget (`.catch()`) for cache writes — caching is an optimization, not a requirement. A failure to cache should never break the request.
- **Never** call Temporal if the DB already has a terminal status.

---

## 2. Lightweight List Endpoints

### Problem

The `GET /workflows` endpoint returns full workflow objects including the `graph` field — a JSON blob containing all nodes, edges, and viewport data. For a list page showing 20 workflows, this can be 100KB-1MB of unnecessary data.

### Solution: Summary Endpoints

Create dedicated summary endpoints that return only the fields needed for display:

| Field Type                     | Include in Summary | Include in Detail |
| ------------------------------ | ------------------ | ----------------- |
| id, name, description          | Yes                | Yes               |
| timestamps (created, updated)  | Yes                | Yes               |
| counts (runs, nodes)           | Yes                | Yes               |
| graph (nodes, edges, viewport) | **No**             | Yes               |
| compiled definition            | **No**             | Yes               |

**Key files:**

- `backend/src/workflows/workflows.controller.ts` — `GET /workflows/summary`
- `backend/src/workflows/repository/workflow.repository.ts` — `listSummary()` with explicit column selection

### Rules

- List pages should always use summary endpoints.
- Detail/edit pages fetch the full object on demand.
- Summary endpoints should use explicit column selection (not `SELECT *`) to avoid sending large JSON blobs over the wire.

---

## 3. Frontend Lazy Loading

### Problem

Importing all page components eagerly means the initial JavaScript bundle includes code for every page, even if the user only visits one.

### Solution: React.lazy() + Suspense

All page-level components are lazy-loaded in `App.tsx`:

```typescript
const MyPage = lazy(() => import('@/pages/MyPage').then((m) => ({ default: m.MyPage })));
```

A shared `<Suspense>` boundary wraps all routes with a spinner fallback.

### Rules

- Every new page added to `App.tsx` must use `React.lazy()`.
- `React.StrictMode` is only enabled in development (`import.meta.env.DEV`) to avoid double-renders in production.
- Heavy sub-components within a page can also be lazy-loaded if they're conditionally rendered (e.g., `ExecutionInspector` in the workflow builder).

---

## 4. Store Fetch Deduplication

### Problem

React re-renders can trigger store fetch functions multiple times in rapid succession, causing redundant API calls.

### Solution: Guards and Dedup

**Skip-if-loaded:** For data that doesn't change often (component list, workflow details):

```typescript
if (get().components.length > 0) return;
```

**Cooldown + inflight dedup:** For data that refreshes (schedules, live statuses):

- Track `lastFetchTime` — skip if within cooldown window (e.g., 5 seconds)
- Track inflight promise — if a fetch is already in progress, return the same promise instead of starting a new one

**Key files:**

- `frontend/src/store/componentStore.ts` — skip-if-loaded pattern
- `frontend/src/features/workflow-builder/hooks/useWorkflowSchedules.ts` — cooldown + inflight dedup

---

## 5. Paginated Data Loading

### Problem

Loading all items upfront (e.g., 50 workflow runs) wastes bandwidth and time when the user typically only looks at the most recent few.

### Solution: Initial Limit + Load More

- Load a small initial batch (e.g., 5 items)
- Show a "Load more" button that fetches the next page (e.g., 20 items)
- Backend endpoints accept `limit` and `offset` parameters

**Key files:**

- `frontend/src/store/runStore.ts` — `INITIAL_LIMIT`, `LOAD_MORE_LIMIT`, `fetchMoreRuns()`
- `frontend/src/components/timeline/RunSelector.tsx` — "Load more runs" button
- `backend/src/workflows/dto/workflow-graph.dto.ts` — `ListRunsQuerySchema` with `limit` + `offset`

### Rules

- All new list endpoints must support `limit` and `offset`.
- Frontend stores should expose `hasMore` state to conditionally show load-more UI.
- Avoid `offset`-based pagination for very large datasets (>10K rows) — consider cursor-based instead.

---

## 6. Smart Polling

### Problem

Polling for status updates on completed/terminal runs wastes bandwidth and backend resources.

### Solution: Poll Only Live Runs

Use the shared `isRunLive()` utility to check if a run needs polling:

**Key files:**

- `frontend/src/features/workflow-builder/utils/executionRuns.ts` — `isRunLive()` helper
- `frontend/src/components/timeline/RunSelector.tsx` — conditional polling

### Rules

- Never set up polling intervals without checking if the data is still "live."
- Use `isRunLive()` for workflow run status checks.
- When refreshing a run list, only re-fetch the count of currently displayed items (don't re-request the full initial batch).

---

## 7. Conditional Data Fetching

### Problem

Fetching all possible data on page load (runs, schedules, components, etc.) even when the user's current view doesn't need it.

### Solution: Fetch on Demand

The workflow builder has two modes: **design** and **execution**. Runs data is only needed in execution mode.

**Key files:**

- `frontend/src/features/workflow-builder/WorkflowBuilder.tsx` — skip runs fetch in design mode
- `frontend/src/features/workflow-builder/hooks/useWorkflowExecutionLifecycle.ts` — conditional fetch based on mode

### Rules

- Identify what data each view/mode actually needs.
- Don't fetch "just in case" — fetch when the user navigates to a view that needs it.
- If a feature has tabs or modes, only fetch data for the active tab/mode.

---

## 8. Batched Run Summaries (N+1 Query Elimination)

### Problem

The `listRuns` endpoint calls `buildRunSummary()` per-row, which issues ~7 queries per run:

1. Workflow lookup
2. Workflow version lookup
3. 3× trace count queries (NODE_STARTED, NODE_COMPLETED, NODE_FAILED)
4. Event time range query (MIN/MAX)
5. Temporal `describeWorkflow` RPC (for non-terminal runs)

For a page of 25 runs, this meant **~175 queries/RPCs** per request. The status-filtered path was worse — it fetched runs in 200-row chunks and processed each through `buildRunSummary` before filtering.

### Solution: `buildRunSummariesBatch()`

A single method that resolves all runs in **~6 total queries** regardless of run count:

| Query            | Before (25 runs)               | After (25 runs)                               |
| ---------------- | ------------------------------ | --------------------------------------------- |
| Workflow lookup  | 25 × `findById`                | 1 × `findByIds` (IN clause)                   |
| Version lookup   | 25 × `findById` / `findLatest` | 1-2 × `findByIds` + `findLatestByWorkflowIds` |
| Trace counts     | 75 × `countByType`             | 1 × `countByTypeForRuns` (GROUP BY)           |
| Event time range | 25 × `getEventTimeRange`       | 1 × `getEventTimeRangeForRuns` (GROUP BY)     |
| Temporal RPC     | Up to 25 sequential            | Only non-terminal, parallelized               |

**Key files:**

- `backend/src/workflows/workflows.service.ts` — `buildRunSummariesBatch()` method
- `backend/src/trace/trace.repository.ts` — `countByTypeForRuns()`, `getEventTimeRangeForRuns()`
- `backend/src/workflows/repository/workflow.repository.ts` — `findByIds()`
- `backend/src/workflows/repository/workflow-version.repository.ts` — `findByIds()`, `findLatestByWorkflowIds()`

### Rules

- **Always** use `buildRunSummariesBatch()` when resolving multiple runs. The single-run `buildRunSummary()` is kept for `getRun()` which loads a single run.
- **New batch repository methods** should use `IN` clauses or `GROUP BY` — never loop with individual queries.
- **Temporal RPCs** are only needed for non-terminal runs and are already parallelized with `Promise.all`.

---

## Known N+1 Issues (Backlog)

The following N+1 patterns still exist and should be addressed:

| Priority  | Location                   | Method          | Pattern                             | Impact          |
| --------- | -------------------------- | --------------- | ----------------------------------- | --------------- |
| 🟡 Medium | `node-io.service.ts:69-72` | `listDetails()` | N × `storage.downloadFilePreview()` | Run detail page |

**Previously fixed:**

- ~~`listRuns()`~~ → `buildRunSummariesBatch()` (batched all DB queries + Temporal RPCs)
- ~~`listDomains()`~~ → Single `GROUP BY domain_id` query for counts + tech stack
- ~~`list()` (workflows)~~ → `findLatestByWorkflowIds()` batch method
- ~~`list()` (schedules)~~ → Uses cached `nextRunAt`/`lastRunAt` from DB instead of N Temporal RPCs

---

## Preventing N+1 Regressions

### The Rule

> **Never call a repository/service method inside `.map()`, `for`, or `forEach` on a list of records.**
> Instead, add a batch method (using `IN` / `GROUP BY` / `DISTINCT ON`) and call it once.

### Red Flags in Code Review

Reject PRs containing these patterns in **service methods that handle list endpoints**:

```typescript
// ❌ BAD: N+1 — individual query per item
const results = await Promise.all(items.map((item) => this.repo.findById(item.id)));

// ❌ BAD: N+1 — sequential loop
for (const item of items) {
  const detail = await this.repo.findById(item.id);
}

// ✅ GOOD: Single batch query
const resultMap = await this.repo.findByIds(items.map((i) => i.id));
```

### Batch Method Convention

When adding repository methods, always provide a batch variant for any method used in list contexts:

| Single                       | Batch                              | Pattern                     |
| ---------------------------- | ---------------------------------- | --------------------------- |
| `findById(id)`               | `findByIds(ids)`                   | `WHERE id IN (...)`         |
| `countByType(runId, type)`   | `countByTypeForRuns(runIds)`       | `GROUP BY run_id, type`     |
| `getEventTimeRange(runId)`   | `getEventTimeRangeForRuns(runIds)` | `GROUP BY run_id`           |
| `findLatestByWorkflowId(id)` | `findLatestByWorkflowIds(ids)`     | `DISTINCT ON (workflow_id)` |

### AI Agent Instructions

Add to CLAUDE.md or equivalent:

- When writing a service method that processes a list, **never** loop individual DB/RPC calls
- If a batch repository method doesn't exist, **create one** before using it

---

## Checklist for New Features

When building a new feature, verify:

- [ ] **Page component** uses `React.lazy()` in `App.tsx`
- [ ] **List endpoints** return only display-needed fields (no graph/config blobs)
- [ ] **List endpoints** accept `limit` and `offset` parameters
- [ ] **Store fetches** are deduplicated (skip-if-loaded or cooldown)
- [ ] **Polling** stops for terminal/completed states
- [ ] **Terminal status checks** use `TERMINAL_STATUSES` from `@shipsec/shared`
- [ ] **Backend services** check cached status before calling Temporal
- [ ] **Batch queries** when resolving multiple records (use IN / GROUP BY, not N loops)
- [ ] **No N+1 patterns** — never call repo methods inside `.map()` / `for` on lists
- [ ] **Data fetching** is conditional on the active view/mode
