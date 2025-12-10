# Schedules & Entry Point Implementation Plan

This document captures the phase-by-phase rollout for introducing Workflow Entry Points (`core.workflow.entrypoint`) and the Temporal-backed schedules experience.

## Phase 0 – Entry Point Alignment
- [x] **Component rename**
  - [x] Update component metadata to `core.workflow.entrypoint` (label “Entry Point”).
  - [x] Refresh frontend copy/tests to use “Entry Point” terminology.
- [x] **Single-entry enforcement**
  - [x] Builder prevents multiple Entry Points, auto-places one on new workflows, and disallows deleting the last entry node.
  - [x] Backend validator errors when the compiled graph has zero or multiple entry nodes.
- [x] **Inspector upgrades**
  - [x] Entry Point inspector shows runtime input editor + “Invoke Workflow” panel (`POST /workflows/:id/run` sample) and “Manage schedules” CTA linking to `/schedules?workflowId=...`.

## Phase 1 – Contracts & Schema
- [x] Add shared Zod schemas for `Schedule`, `ScheduleInputPayload`, and `ExecutionTriggerMetadata` in `packages/shared`.
- [x] DB migration for `workflow_schedules` (JSONB payload, cadence fields, status).
- [x] Extend run payloads (backend + frontend) with `triggerType`, `triggerSource`, `triggerLabel`, `inputPreview`.
- [x] Update OpenAPI spec + generated backend client to expose schedule endpoints and trigger metadata.

## Phase 2 – Backend Schedules Module
1. Create `backend/src/modules/schedules` with controller/service/repository + DTOs.
2. Implement CRUD API: create/list/detail/update/delete + `pause`, `resume`, `trigger`.
3. Temporal integration:
   - Compose schedule specs (cron/timezone/overlap) and store `temporalScheduleId`.
   - On schedule execution, invoke workflows with `{ trigger: { type: 'schedule', sourceId, label } }`.
4. Input resolution: merge stored `runtimeInputs` + `nodeOverrides` before calling the worker (validate against Entry Point schema).
5. Emit observability events (Loki/logs) when schedules change state or errors occur.

## Phase 3 – Unified Run Payload API
- [x] Add internal backend endpoint/service that accepts `{ workflowId, trigger, scheduleId?, overrides? }`, generates a run ID, compiles the workflow, stores the run row, and returns `{ runId, definition, inputs, workflowVersionId, organizationId, triggerMetadata }`.
- [x] Make the public `POST /workflows/:id/run` call the new internal method and pass the returned payload to Temporal (no duplicated logic).
- [x] Introduce idempotency keys so repeated worker calls (e.g., schedule retries) reuse the same run row instead of creating duplicates.
- [x] Expose the internal endpoint securely for worker access (internal token + org header) and document expected headers/response.

> Internal run payload API (`POST /internal/runs`) now mirrors the worker request schema from `@shipsec/shared`. Workers must send `X-Internal-Token` plus `X-Organization-Id`, and manual/API callers can pass `Idempotency-Key` (or `X-Idempotency-Key`) to reuse the same run ID across retries.

## Phase 4 – Schedule Dispatcher Workflow
- [x] Implement `scheduleTriggerWorkflow` in the worker that runs an activity to call the internal run-payload endpoint with schedule metadata.
- [x] After fetching the payload, start `shipsecWorkflowRun` (child workflow) with the returned definition/inputs so schedules and manual runs share the same execution path.
- [x] Update `TemporalService` schedule actions to launch `scheduleTriggerWorkflow` instead of the placeholder workflow type.
- [x] Ensure dispatcher workflow logs/propagates trigger metadata and handles retries (activity + child workflow) without duplicating runs.

## Phase 5 – Frontend Navigation & Store
- [x] Add `Schedules` route/page listing all schedules with filters (workflow, status, timezone, next run) and row actions (Run now, Pause/Resume, Edit).
- [x] Build `useScheduleStore` (Zustand) for caching + mutations via the generated client.
- [x] Update global navigation to include Schedules; support query params for workflow scoping (`/schedules?workflowId=...`).
- [x] Add inline “Manage schedules” panel on workflow detail (Design tab) referencing the global page.

## Phase 6 – Schedule Editor + Entry Point UX
- [x] Implement `ScheduleEditorDrawer` accessible from both the Schedules page and workflow CTA (basics, cadence builder, runtime input preview, node override diff).
  - [x] Wire the drawer into the global Schedules page with runtime inputs + node overrides.
  - [x] Hook workflow-level CTA so designers can open the drawer without leaving the workflow.
- [x] Add per-workflow CTA (“Create schedule”) that opens the drawer pre-filtered for the current workflow.
- [x] Entry Point inspector lists existing schedules (chips with status & quick actions) and links to edit/pause/run now.

## Phase 7 – Execution Surfaces
- [x] Propagate trigger metadata across run fetchers, cards, and dashboard selectors so `RunSelector`, `ExecutionTimeline`, and `ExecutionInspector` show consistent badges (`👤 Manual run`, `🕐 Scheduled run`, `🌐 API run`).
- [x] Add trigger filters to the Run Selector dropdown (`Trigger: All | Manual | Scheduled`) and align all dropdown cards with the info bar layout (title row + metadata row + badge row).
- [x] Surface trigger info in the inspector/log panels (“Triggered by Daily Quick Scan”) and add rerun actions that mirror the overview bar.

## Phase 8 – Validation, Tests, Observability
- [x] Backend tests: unified run endpoint, dispatcher workflow, schedule lifecycle (create/update/pause/resume/trigger) with idempotency + failure cases.
- [x] Frontend tests: store unit tests, component/story coverage for Schedules page, editor drawer, Entry Point inspector.
- [x] Document manual verification steps in `.ai/visual-execution-notes.md` (creating schedules, verifying dispatcher workflow, observing run badges).
- [x] Monitor schedule health via stored status snapshots; configure alerts when Temporal describes show errors or dispatcher retries.

## Dependencies & Notes
- Entry Point inspector enhancements rely on Phase 0 work.
- Backend schedule API must land before frontend phases 3–5.
- Worker must log schedule-triggered runs (Phase 5) to keep Execution Timeline consistent while backend propagates metadata.
- RBAC decisions (schedule creation permissions) remain open; integrate with existing auth hooks once defined.
