# Frontend Load Testing Plan

A reusable guide for auditing frontend performance, TanStack Query behavior, and responsiveness.

## Prerequisites

1. **Seed data:** `bun backend/scripts/seed-stress-test.ts --tier medium`
2. **Dev server running:** `just dev` (Vite on localhost)
3. **Browser:** Chrome with DevTools open (Network tab, Performance tab)
4. **Viewport:** Desktop 1280x720 default, then mobile/tablet for responsive checks
5. **All testing must be done via `localhost` (nginx reverse proxy), NOT via the direct Vite dev server port.** Nginx provides gzip compression and more closely matches production behavior.

## Step 0: Discover All Routes

Before auditing, discover the current set of routes from the source of truth:

**Route definitions:** `frontend/src/App.tsx` — all `<Route path="..." />` entries

1. Read `frontend/src/App.tsx` and extract every `<Route path="...">` entry
2. Compare against the **Known Pages** table below
3. If there are new routes not in the table, **add them to the audit** as fresh navigation tests
4. If routes have been removed, skip them and note the removal in the report
5. For parameterized routes (e.g., `/workflows/:id`), use a real entity from seeded data

This ensures the audit always covers the full application, even as new pages are added.

## Per-Page Audit Sequence

For each page below, perform these steps in order:

1. **Navigate** to the page URL (fresh navigation, not SPA transition, for cold-load pages)
2. **Wait** for all data to load (spinners gone, tables populated)
3. **Screenshot** the page
4. **Network tab** — filter fetch/XHR — record all API calls, durations, transfer/decoded sizes
5. **TanStack Query cache** — extract via JS console (see snippet below) — record query keys, status, fetchStatus, staleTime, isStale, data size
6. **DOM element count** — `document.querySelectorAll('*').length`
7. Note any anomalies: ghost queries, duplicates, stale-on-arrival, missing pagination

## Known Pages (baseline — update as routes change)

| #   | Page                      | URL                          | Special Actions                                                                                  |
| --- | ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Workflow List             | `/`                          | Run Chrome performance trace (reload + auto-stop). Check LCP, CLS, TTFB. Identify critical path. |
| 2   | Workflow Detail (Design)  | `/workflows/:id`             | Click a workflow from list page (SPA navigation). Check cache reuse for components/summary.      |
| 3   | Workflow Detail (Execute) | `/workflows/:id/runs/:runId` | Switch to Execute tab. Watch for duplicate API calls. Check SSE stream connection.               |
| 4   | Mobile (375px)            | `/`                          | Resize viewport to 375x667. Check sidebar collapse, column hiding, text wrapping.                |
| 5   | Tablet (768px)            | `/`                          | Resize viewport to 768x1024. Check layout adaptation.                                            |
| 6   | Schedules                 | `/schedules`                 | Fresh navigation.                                                                                |
| 7   | Webhooks                  | `/webhooks`                  | Fresh navigation.                                                                                |
| 8   | Action Center             | `/action-center`             | Fresh navigation. Check pending human input count.                                               |
| 9   | Artifact Library          | `/artifacts`                 | Fresh navigation.                                                                                |
| 10  | Secrets                   | `/secrets`                   | Fresh navigation.                                                                                |
| 11  | API Keys                  | `/api-keys`                  | Fresh navigation.                                                                                |
| 12  | MCP Library               | `/mcp-library`               | Fresh navigation. Check tool count and payload size.                                             |
| 13  | Analytics Settings        | `/analytics-settings`        | Fresh navigation. Verify if any page-specific queries exist.                                     |

## TanStack Query Cache Extraction Snippet

Run in Chrome DevTools console on any page:

```js
(() => {
  const root = document.querySelector('#root');
  const fiberKey = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  let fiber = root[fiberKey],
    found = null;
  const visited = new Set(),
    queue = [fiber];
  let i = 0;
  while (queue.length && i < 500) {
    i++;
    const f = queue.shift();
    if (!f || visited.has(f)) continue;
    visited.add(f);
    let s = f.memoizedState,
      si = 0;
    while (s && si < 20) {
      si++;
      if (s.memoizedState?.getQueryCache) {
        found = s.memoizedState;
        break;
      }
      s = s.next;
    }
    if (found) break;
    if (f.pendingProps?.client?.getQueryCache) {
      found = f.pendingProps.client;
      break;
    }
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  if (!found) return 'QueryClient not found';
  return found
    .getQueryCache()
    .getAll()
    .map((q) => ({
      key: JSON.stringify(q.queryKey),
      status: q.state.status,
      fetchStatus: q.state.fetchStatus,
      isStale: q.isStale(),
      size: Array.isArray(q.state.data) ? q.state.data.length + ' items' : typeof q.state.data,
      staleTime: q.options?.staleTime,
    }));
})();
```

## What to Look For

- **Ghost/PENDING queries:** status=pending + fetchStatus=idle (created but never fetched)
- **Duplicate API calls:** same endpoint called 2+ times on single navigation
- **Cache misses:** prefetched queries (components, workflowsSummary) not served from cache
- **Aggressive stale times:** queries going stale immediately after fetch
- **Missing pagination:** list endpoints returning all items without limit/offset
- **Large payloads:** decoded size > 50KB for a single endpoint
- **Query key inconsistencies:** missing org-id scoping vs other queries

## Comparing with Previous Reports

After completing an audit, save the report to `frontend/docs/audits/` with a datetime stamp in the filename (e.g., `load-audit-2026-02-18T14-30.md`). This allows multiple audits per day (e.g., before and after a fix). Compare key metrics across reports:

- LCP / CLS / TTFB
- DOM element counts per page
- API call counts and duplicates
- Ghost query count
- Stale time configuration changes
- New pages or removed pages
