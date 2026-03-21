# ASM Domain Scan Tracking

## Problem

The Domains page shows a "Last Scan" timestamp for each domain. This value was
previously stored as `lastScanAt` on the `asm_domains` row and updated only
inside `triggerDomainScan()` — which runs for **manual** per-domain scans.

Scheduled scans trigger workflows through `schedules.service → workflowsService.run()`,
completely bypassing `triggerDomainScan()`. As a result, `lastScanAt` was never
updated for scheduled scans and showed stale values on the Domains page.

## Solution: Derive from workflow_runs

Instead of maintaining a stored `lastScanAt` field that must be kept in sync
across every trigger path, `listDomains` now **computes the value dynamically**
from the `workflow_runs` table at read time.

### How it works

`computeLastScanTimes()` in `AsmService` runs two queries:

1. **Org-wide latest** — `MAX(COALESCE(close_time, created_at))` from
   `workflow_runs` where the workflow matches an ASM template and
   `status = 'COMPLETED'`. This covers scheduled multi-domain scans.

2. **Per-domain latest** — Same aggregation, filtered to runs where
   `trigger_source = 'asm:{domain}'` and `status = 'COMPLETED'`. This covers
   manual per-domain scans (which set `triggerSource` to `asm:<domain>`).

For each domain, the returned timestamp is `MAX(org-wide, per-domain)`.

### Why closeTime

Using `COALESCE(close_time, created_at)` means "Last Scan" reflects when the
workflow **finished** (data was persisted to ClickHouse), not when it was
triggered. `close_time` is set by the Temporal status cache when a run reaches
a terminal state.

### ASM workflow resolution

Both `listDomains` and `listScans` share `resolveAsmWorkflowIds()`, which
resolves workflow IDs from the template slugs:

- `sys-attack-surface-recon`
- `sys-quick-recon`
- `sys-port-scan`
- `sys-vuln-scan`

### Scan trigger paths

| Trigger path                        | triggerSource   | triggerType | lastScanAt updated?                    |
| ----------------------------------- | --------------- | ----------- | -------------------------------------- |
| Manual (Domains page → Scan button) | `asm:{domain}`  | `manual`    | Yes (via workflow_runs query)          |
| Scheduled (cron)                    | `{schedule_id}` | `schedule`  | Yes (via org-wide workflow_runs query) |
| Quick Scan                          | varies          | `manual`    | Yes (if workflow matches ASM template) |

### Key files

- `backend/src/asm/asm.service.ts` — `computeLastScanTimes()`, `resolveAsmWorkflowIds()`
- `backend/src/database/schema/workflow-runs.ts` — `closeTime`, `triggerSource` columns
- `frontend/src/pages/asm/DomainsPage.tsx` — renders `lastScanAt` via `formatRelativeTime()`
