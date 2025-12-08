# Schedules & Entry Point Implementation Plan

This document captures the phase-by-phase rollout for introducing Workflow Entry Points (`core.workflow.entrypoint`) and the Temporal-backed schedules experience.

## Phase 0 – Entry Point Alignment
1. **Component rename**
   - Update component metadata to `core.workflow.entrypoint` (label “Entry Point”) while keeping compatibility with existing graphs.
   - Refresh frontend copy/tests to use “Entry Point” terminology; keep `component.id` stable for persisted workflows.
2. **Single-entry enforcement**
   - Builder: prevent adding multiple Entry Points, auto-place one in new workflows, and disallow deleting the last entry node.
   - Backend validator: error when the compiled graph has zero or multiple entry nodes.
3. **Inspector upgrades**
   - Entry Point inspector shows runtime input editor + “Invoke Workflow” panel (API payload, `curl` snippet) and a “Manage schedules” CTA linking to `/schedules?workflowId=...`.

## Phase 1 – Contracts & Schema
1. Add shared Zod schemas for `Schedule`, `ScheduleInputPayload`, and `ExecutionTriggerMetadata` in `packages/shared`.
2. DB migration for `workflow_schedules` (JSONB payload, cadence fields, status).
3. Extend run payloads (backend + frontend) with `triggerType`, `triggerSource`, `triggerLabel`, `inputPreview`.
4. Update OpenAPI spec + generated backend client to expose schedule endpoints and trigger metadata.

## Phase 2 – Backend Schedules Module
1. Create `backend/src/modules/schedules` with controller/service/repository + DTOs.
2. Implement CRUD API: create/list/detail/update/delete + `pause`, `resume`, `trigger`.
3. Temporal integration:
   - Compose schedule specs (cron/timezone/overlap) and store `temporalScheduleId`.
   - On schedule execution, invoke workflows with `{ trigger: { type: 'schedule', sourceId, label } }`.
4. Input resolution: merge stored `runtimeInputs` + `nodeOverrides` before calling the worker (validate against Entry Point schema).
5. Emit observability events (Loki/logs) when schedules change state or errors occur.

## Phase 3 – Frontend Navigation & Store
1. Add `Schedules` route/page listing all schedules with filters (workflow, status, timezone, next run) and row actions (Run now, Pause/Resume, Edit).
2. Build `useScheduleStore` (Zustand) for caching + mutations via the generated client.
3. Update global navigation to include Schedules; support query params for workflow scoping (`/schedules?workflowId=...`).
4. Add inline “Manage schedules” panel on workflow detail (Design tab) referencing the global page.

## Phase 4 – Schedule Editor + Entry Point UX
1. Implement `ScheduleEditorDrawer` accessible from both the Schedules page and workflow CTA.
   - Sections: Basics, Cadence builder (cron presets), Runtime input preview (read-only from Entry Point), Node overrides diff UI.
2. Add per-workflow CTA (“Create schedule”) that opens the drawer pre-filtered.
3. Entry Point inspector lists existing schedules (chips with status & quick actions) and links to edit/pause/run now.

## Phase 5 – Execution Surfaces
1. Propagate trigger metadata to UI components:
   - `RunSelector`, `ExecutionTimeline`, `ExecutionInspector`, dashboard cards show badges (🕐 scheduled, 👤 manual) and labels.
2. Add timeline filters for `Trigger: All | Manual | Scheduled`.
3. Include trigger info in log/trace panels (e.g., “Triggered by Daily Quick Scan”) for clarity during investigations.

## Phase 6 – Validation, Tests, Observability
1. Backend tests: schedule CRUD + Temporal lifecycle (create/update/pause/resume/trigger), payload validation, error cases.
2. Frontend tests: store unit tests, component/story coverage for Schedules page, editor drawer, Entry Point inspector.
3. Document manual verification steps in `.ai/visual-execution-notes.md` (creating schedules, verifying Temporal schedule, observing run badges).
4. Monitor schedule health via stored status snapshots; configure alerts when Temporal describes show errors.

## Dependencies & Notes
- Entry Point inspector enhancements rely on Phase 0 work.
- Backend schedule API must land before frontend phases 3–5.
- Worker must log schedule-triggered runs (Phase 5) to keep Execution Timeline consistent while backend propagates metadata.
- RBAC decisions (schedule creation permissions) remain open; integrate with existing auth hooks once defined.
