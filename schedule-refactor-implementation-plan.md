# ShipSec Studio – Workflow Orchestration Refactor Plan

We’re refitting the runtime so each workflow node executes with Temporal-grade isolation, while preserving DAG-driven scheduling, trace fidelity, and component ergonomics. The target state mirrors Tracecat’s approach: the workflow orchestrates, but each component runs inside its own Temporal activity (or child workflow), giving us retries, timeouts, and concurrency at the framework level.

---

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Completed | Baseline Audit & Gap Analysis |
| Phase 1 | ✅ Completed | DSL & Schema Enrichment |
| Phase 2 | ✅ Completed | Scheduler Core (in-activity parallelism) |
| Phase 3 | ⚪ Not Started | Activity-per-Component Orchestration |
| Phase 4 | ⚪ Not Started | Context, Services & Tracing Hardening |
| Phase 5 | ⚪ Not Started | Error Handling & Join Semantics |
| Phase 6 | ⚪ Not Started | Integration Tests & Temporal Validation |
| Phase 7 | ⚪ Not Started | Frontend & API Alignment |
| Phase 8 | ⚪ Not Started | Guardrails, Concurrency Caps & Rollout |

**Primary Objective:** Execute workflows with deterministic DAG semantics, Temporal activity isolation for every node, and rich observability—without regressing developer ergonomics or existing components.

---

## Phase 0 – Baseline Audit & Gap Analysis ✅

**Goal:** Document how the current compiler/runtime behave and identify blockers to parallel execution.

- Diagrammed current `WorkflowDefinition` and handle mapping.
- Traced sequential loop (`executeWorkflow`) and shared state.
- Reviewed Temporal worker setup (single `runWorkflowActivity`).
- Captured findings in `.ai/visual-execution-notes.md`.
- Validated baseline with `bun --cwd worker test`.
- Ran manual multi-branch workflow to observe serialization.

**Deliverable:** Audit notes feeding phases 1–4.

---

## Phase 1 – DSL & Schema Enrichment ✅

**Goal:** Emit full DAG metadata so the worker can schedule without guesswork.

- Extended `WorkflowDefinition` with `version`, node metadata, edges, and dependency counts.
- Updated compiler to populate enriched structure.
- Added unit tests (line/diamond graphs) verifying dependency counts/handles.
- Synced worker types with the new schema.

**Deliverable:** Enriched definitions + passing tests.

---

## Phase 2 – Scheduler Core (In-Activity Parallelism) ✅

**Goal:** Replace the sequential loop with an indegree-driven scheduler while still running inside a single activity.

- Implemented `runWorkflowWithScheduler` (ready queue, indegree tracking).
- Refactored `executeWorkflow` to delegate to the scheduler and maintain traces/results.
- Added parallel timing test (twin sleep branches) validating concurrent execution.
- Worker integration suite remains green.

**Deliverable:** Deterministic parallel execution within the existing activity boundary.

---

## Phase 3 – Activity-per-Component Orchestration

**Goal:** Run each workflow action inside its own Temporal activity (or child workflow) while reusing the scheduler for DAG ordering.

- [ ] Introduce `runComponentActivity` mirroring Tracecat’s `run_action_activity` (encapsulate execution context, logging, retries, remote executor adapters).
- [ ] Update worker bootstrap (`dev.worker.ts`) to register new activity handlers and propagate services.
- [ ] Adapt scheduler to enqueue actions by calling `workflow.execute_activity` (or `start_child_workflow` for special nodes) instead of inline execution.
- [ ] Determine strategy for synchronous vs asynchronous activities (e.g., triggers vs long-running Docker jobs).
- [ ] Ensure entrypoint and runtime inputs flow through activity payloads.
- [ ] Tests:
  - Temporal workflow unit tests stubbing the activity to confirm orchestration order.
  - Activity integration test verifying retries/timeouts are applied.

**Deliverable:** Workflow orchestrates; each node executes as an isolated Temporal activity.

---

## Phase 4 – Context, Services & Tracing Hardening

**Goal:** Make context and adapters safe across concurrent activities and branches.

- [ ] Refactor `createExecutionContext` to emit immutable payloads suitable for serialization into activity inputs.
- [ ] Provide per-activity trace/log adapters (no shared in-memory maps) and ensure trace events include activity IDs/stream IDs.
- [ ] Preserve branch metadata (`streamId`, `joinStrategy`) across activity boundaries.
- [ ] Tests:
  - Concurrent activity trace/log emission.
  - Adapter unit tests exercising multi-activity persistence.

**Deliverable:** Thread-safe, activity-aware context + observability.

---

## Phase 5 – Error Handling & Join Semantics

**Goal:** Define deterministic behaviour for merges, failures, and cancellation in the multi-activity world.

- [ ] Implement join strategies (`all`, `any`, `first`, future `quorum`) in the scheduler; ensure activity results feed into join logic.
- [ ] On activity failure, propagate according to policy (fail workflow, skip dependents, route to error edges).
- [ ] Add cancellation hooks so upstream cancellation can short-circuit queued activities.
- [ ] Ensure undefined inputs throw deterministic errors (no silent `warn` + continue).
- [ ] Tests:
  - Unit tests for join strategies with mocked activity outcomes.
  - Failure propagation tests (diamonds, scatter/gather) using activity stubs.

**Deliverable:** Behaviour matrix documented + covered by tests.

---

## Phase 6 – Integration Tests & Temporal Validation

**Goal:** Validate the multi-activity architecture end-to-end.

- [ ] Extend worker integration tests to assert parallel activities, retries, and failure reporting.
- [ ] Add Temporal replay tests ensuring the workflow remains deterministic with activities.
- [ ] Run long-lived workflows via `worker/scripts/workflow-runner.ts` to confirm logs/traces.
- [ ] Benchmark serial vs parallel workflows and compare with pre-activity baseline.

**Deliverable:** Passing integration suite demonstrating the new execution model.

---

## Phase 7 – Frontend & API Alignment

**Goal:** Surface the richer runtime metadata to users.

- [ ] Update backend status/trace APIs with activity IDs, join metadata, and failure semantics.
- [ ] Adjust frontend stores (`executionTimelineStore`, canvas overlays) to render parallel activity states.
- [ ] Add UI indicators for per-node retries and activity IDs.
- [ ] Ensure `@shipsec/shared` exports updated models.
- [ ] Tests:
  - Frontend unit tests for activity timeline rendering.
  - Manual workflow run verifying UI reflects parallel activities.

**Deliverable:** UI + API aligned with activity-driven execution.

---

## Phase 8 – Guardrails, Concurrency Caps & Rollout

**Goal:** Harden for production loads and deliver safely.

- [ ] Implement per-node and global concurrency caps (token buckets or semaphore) configured via node metadata/runner config.
- [ ] Instrument metrics: queued activities, active activities, retries, failure rates.
- [ ] Add feature flags to toggle between inline and activity-based execution during soak.
- [ ] Document migration/rollback steps and update operational runbooks.
- [ ] Build regression suite (deterministic workflow snapshot) guarding future changes.

**Deliverable:** Production-ready runtime with guardrails, observability, and rollout plan.

---

## Operational Checklist (All Phases)

- Ensure Docker + pm2 stack is running (`docker compose up -d`, `pm2 start`).
- Run targeted tests after significant changes:
  - `bun run --filter backend test`
  - `bun --cwd worker test`
  - `bun run test`
- Keep `.ai/visual-execution-notes.md` updated with discoveries and decisions.
- Document partial progress in this plan (update statuses, add notes).

---

### Change Log

- `2025-10-15` – Plan updated to adopt activity-per-component orchestration following Tracecat semantics; Phases 0–2 marked completed.
- `2025-10-15` – Initial plan drafted.
