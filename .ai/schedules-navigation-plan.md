# Schedule Navigation & Temporal Schedule Integration Plan

## Context
- Workflows currently require a workflow entry point node (`core.workflow.entrypoint`, previously `core.trigger.manual`) that surfaces runtime-input forms via `WorkflowBuilder` and `RuntimeInputsEditor` (see `frontend/src/pages/WorkflowBuilder.tsx` and `frontend/src/components/workflow/RuntimeInputsEditor.tsx`). No persistent scheduling primitive exists today.
- Execution UI (Run selector, timeline, inspector in `frontend/src/components/timeline/*`) displays runs from `useRunStore`, but the store schema only tracks start/end metadata and whether a run is live—there is no `triggerType` or schedule attribution.
- The backend/worker stack launches runs directly through the existing workflows module; Temporal Schedule APIs are not used and there is no REST contract for creating or managing calendar-based runs.
- Users want to configure recurring execution without polluting the workflow canvas with Cron nodes, and operations teams need a global view to pause or audit every cadence.

## Goals
1. Provide a dedicated, global schedules experience where operators can create, edit, pause, resume, and manually fire cadences across all workflows.
2. Keep workflow design (graph editing, shared nodes) focused on execution topology while still surfacing per-workflow schedule context via deep links.
3. Store a self-contained input payload (entry point runtime inputs + optional node overrides) per schedule so each cadence runs deterministically.
4. Record trigger metadata on each execution so all timeline/inspectors can indicate whether a run was manual or scheduled.
5. Integrate with Temporal’s Schedule API for durability (pause/resume history, overlap policy, catch-up) instead of building a custom dispatcher.

## Non-Goals
- Building Cron nodes inside the workflow canvas.
- Designing a “schedule template marketplace.” We only cover scheduling existing workflows.
- Replacing manual runs; operators must be able to run a workflow on-demand even when schedules exist.

## Current State Summary
| Area | Observations |
|------|--------------|
| Workflow runtime inputs | Entry point nodes define runtime inputs that surface in the Run modal (`WorkflowBuilder.executeWorkflow`). There is no persistence layer for “favorite” input sets beyond the current manual run. |
| Execution timeline | `useRunStore` (frontend/src/store/runStore.ts) normalizes runs with status, timestamps, and workflow version info. There is no `triggerType` field to differentiate manual vs automated runs. |
| Backend workflows module | Controllers/services under `backend/src/workflows` expose run listing, status, and trace endpoints. Temporal execution is initiated ad-hoc; there is no module to create Temporal Schedules or store schedule metadata. |
| Navigation | Primary nav covers Workflows, Library, Activity, etc. No dedicated Schedules entry exists, so scheduling cannot live as a first-class operator surface. |

## Proposed IA & UX
1. **Primary Navigation**
   - Add `Schedules` beside Workflows/Activity. This page shows every schedule across the workspace with filters for workflow name, status (active/paused), timezone, and next run.
   - Each list row: schedule name, workflow badge, cron text (with friendly alias), next/last run time, status chip (Active, Paused, Error), and quick actions (`Run now`, `Pause/Resume`, `Edit`).
2. **Workflow Detail Integration**
   - On the workflow detail page (Design + Execution tabs), replace the tab idea with an inline panel above the Execution timeline: e.g., “No schedules yet — Manage schedules →”.
   - If schedules exist, show chips with the names and states. Clicking opens the global Schedules page filtered via query param (`/schedules?workflowId=123`). This deep link preserves context without forcing the full scheduler UI inside the canvas.
3. **Schedule Editor**
   - Drawer/modal accessible from both the Schedules page and workflow CTA.
   - Sections: basic info (name, description, timezone), cadence (cron builder + presets), runtime inputs preview (pull entry point definitions read-only), and overrides (per-node parameter overrides with diff vs workflow default).
   - Validation ensures every schedule persists an explicit input payload even if it matches the workflow defaults.
4. **Execution Surfaces**
   - `RunSelector`, `ExecutionTimeline`, and `ExecutionInspector` display a 🕐 “Scheduled” badge using a new `triggerType` + `triggerSource` field from the run payload. The badge appears in the run list rows (see `frontend/src/components/timeline/ExecutionTimeline.tsx`) and in the inspector header beside the status badge.
   - Timeline filters gain a `Trigger: All | Manual | Scheduled` control so operators can focus on automated runs.

## Data & Contract Changes
### Schedule Entity
- `id`, `workflowId`, `workflowVersionId` (optional pin), `name`, `description`.
- `cronExpression`, `timezone`, `humanLabel`, `overlapPolicy` (skip, buffer, allow), `catchupWindow`.
- `status` (active, paused, error), `lastRunAt`, `nextRunAt`.
- `inputPayload`: JSON storing entry point inputs plus node overrides keyed by nodeId + parameter path (mirrors data returned by runtime input panel).
- `temporalScheduleId`: the identifier returned by Temporal’s Schedules API.

### Execution Metadata
- Extend run schema (`backend/src/workflows/workflows.controller.ts` output + `frontend/src/store/runStore.ts` normalization) with:
  - `triggerType`: `'manual' | 'schedule' | 'api'` (future-proof).
  - `triggerSource`: schedule ID or user ID.
  - `triggerLabel`: human-friendly label (`"Daily Quick Scan"` or `"Manual run by jdoe"`).
  - `inputPreview`: optional diff summary vs workflow defaults (for the Execution inspector).
- Update `ExecutionLog` metadata to keep `triggeredBy` alignment so Loki labels continue working.

### API Surface
- `POST /schedules`: create schedule with payload above; backend stores row + creates Temporal schedule.
- `GET /schedules`: list, filter by workflowId/status.
- `GET /schedules/:id`: detail with history snapshots (Temporal schedule describe).
- `PATCH /schedules/:id`: update cadence, inputs, overrides; propagate updates to Temporal.
- `POST /schedules/:id/pause|resume|trigger`: thin wrappers calling Temporal pause, unpause, trigger immediate run.
- `DELETE /schedules/:id`: delete schedule + Temporal resource.
- Extend `/executions/runs` to include trigger metadata, plus optional filters `triggerType` and `scheduleId`.

## Backend Architecture
1. **Module Layout**
   - New `backend/src/modules/schedules` encapsulating controller, service, repository, and DTOs.
   - Shared Zod schema lives in `packages/shared/src/schedules.ts` so the frontend client stays typed.
   - Repository persists schedule rows (likely `workflow_schedules` table with JSONB `input_payload`).
2. **Temporal Integration**
   - Service composes Temporal Schedule definitions: `action` triggers the workflow with stored payload, `schedule` holds cron + timezone, `policies` capture overlap + catchup.
   - Store `temporalScheduleId`+`version` from describe API to detect drift.
   - When a schedule fires, include schedule metadata in the workflow run request (e.g., `trigger: { type: 'schedule', sourceId: scheduleId, label: scheduleName }`).
3. **Input Resolution**
- At creation/update, validate payload against entry point runtime schema (available via DSL or stored metadata). Reject schedules if the workflow lacks an entry point or runtime inputs.
   - `inputPayload` should include both `runtimeInputs` (matching manual form) and `nodeOverrides` (map of `nodeId -> { parameterKey: value }`). During run start, merge overrides with workflow defaults before invoking the worker.
4. **Audit & Health**
   - Store Temporal schedule status/proto snapshot to show error states (e.g., misfire due to invalid cron).
   - Emit activities/logs to Loki when schedules change state for observability.

## Frontend Implementation
1. **Client + Store**
   - Generate a typed `Schedule` client via OpenAPI + `packages/backend-client`.
   - Create `useScheduleStore` (Zustand) handling list caching, detail fetching, actions (pause/resume/runNow).
2. **UI Surfaces**
   - Build `frontend/src/pages/SchedulesPage.tsx` with table, filters, and inline create button.
   - Add `ScheduleEditorDrawer` component reusing runtime input definitions from the workflow store (fetch workflow metadata if not loaded).
   - Update `WorkflowBuilder`/`WorkflowList` to show `Manage schedules` CTA linking to `/schedules?workflowId=...`.
3. **Execution Views**
   - Extend `ExecutionRun` interface to include trigger metadata; propagate to RunSelector, timeline rows, inspector badges, and run list cards on the dashboard.
   - Add timeline filter controls plus schedule badge iconography (🕐 for scheduled).
4. **Routing & Nav**
   - Update root layout navigation to include `Schedules`. Support query params for filter state and ensure deep links from workflows pre-apply the filter.

## Worker & Temporal Runner Updates
- When `trigger.type === 'schedule'`, log a structured trace event at run start so Execution timeline can display schedule context even before the backend updates the run record.
- Ensure worker respects `inputPayload.nodeOverrides` by merging them before action execution.
- Guarantee scheduled runs reuse the same run ID structure (`shipsec-run-*`) so existing monitoring/integration stays intact.

## Rollout Plan
1. **Schema + API groundwork**: add shared schedule schemas, DB migration for `workflow_schedules`, and extend run payloads with trigger metadata.
2. **Backend Temporal wiring**: implement schedules module, create CRUD endpoints, and integrate with Temporal Schedules API (pause/resume/trigger).
3. **Frontend nav + stores**: add schedules route, store, and connect to API with stub data for initial UI tests.
4. **Editor + Execution polish**: wire runtime input previews, node overrides, and Execution badges/filters.
5. **Validation + Observability**: add integration tests (backend) covering Temporal schedule lifecycle; add frontend Cypress/story tests for the new flows; document manual verification steps in `docs/execution-contract.md` / `.ai/visual-execution-notes.md`.

## Open Questions
1. Should schedules lock to a workflow version or track “latest successful version”? Default proposal: optional `workflowVersionId` pin; if unset, use the latest committed version when firing.
2. Do we need RBAC constraints (e.g., only admins can create schedules)? Implementation should hook into existing permissions once defined.
3. How do overlapping manual runs + schedules share worker concurrency limits? Need policy defaults, possibly reuse Temporal overlap policies plus backend-level guard rails.
