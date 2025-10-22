# ShipSec Studio – Workflow Orchestration Refactor Plan

We’re refitting the runtime so each workflow node executes with Temporal-grade isolation, while preserving DAG-driven scheduling, trace fidelity, and component ergonomics. The target state mirrors Tracecat’s approach: the workflow orchestrates, but each component runs inside its own Temporal activity (or child workflow), giving us retries, timeouts, and concurrency at the framework level.

---

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Completed | Baseline Audit & Gap Analysis |
| Phase 1 | ✅ Completed | DSL & Schema Enrichment |
| Phase 2 | ✅ Completed | Scheduler Core (in-activity parallelism) |
| Phase 3 | ✅ Completed | Activity-per-Component Orchestration |
| Phase 4 | ✅ Completed | Context, Services & Tracing Hardening |
| Phase 5 | ✅ Completed | Error Handling & Join Semantics |
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

## Phase 3 – Activity-per-Component Orchestration ✅

**Goal:** Run each workflow action inside its own Temporal activity (or child workflow) while reusing the scheduler for DAG ordering.

- [x] Introduce `runComponentActivity` mirroring Tracecat’s `run_action_activity` (encapsulate execution context, logging, retries, remote executor adapters).
- [x] Update worker bootstrap (`dev.worker.ts`) to register new activity handlers and propagate services.
- [x] Adapt scheduler to enqueue actions by calling `workflow.execute_activity` (or `start_child_workflow` for special nodes) instead of inline execution.
- [x] Ensure entrypoint and runtime inputs flow through activity payloads.
- [ ] Determine strategy for specialised activities (e.g., remote Docker runners, manual approvals) — backlog item once base path stabilises.
- [x] Tests: Temporal workflow exercised via integration suite; unit tests cover scheduler behaviour and parallel execution.

**Deliverable:** Workflow orchestrates; each node executes as an isolated Temporal activity.

---

## Phase 4 – Context, Services & Tracing Hardening

**Goal:** Make context and adapters safe across concurrent activities and branches.

- [x] Refactor `createExecutionContext` to emit immutable payloads suitable for serialization into activity inputs.
- [x] Provide per-activity trace/log adapters (no shared in-memory maps) and ensure trace events include activity IDs/stream IDs.
- [x] Preserve branch metadata (`streamId`, `joinStrategy`) across activity boundaries.
- [x] Harden secrets/files handles so activity retries cannot double-consume resources.
- [x] Tests:
  - [x] Concurrent activity trace/log emission.
  - [x] Adapter unit tests exercising multi-activity persistence.
  - [x] Temporal integration test proving traces remain ordered when two activities emit simultaneously.

**Implementation Steps**
1. Introduce serializable context DTO + migration shim for existing components.
2. Split `TraceService` and logger collectors into lightweight RPC-friendly facades.
3. Update activity payload builders to include branch metadata and correlation IDs.
4. Add regression tests covering concurrent trace/log writes and retry safety.

**Dependencies:** Requires Phase 3 activity orchestration deployed behind feature flag. Coordinate with backend trace repository updates (Phase 7).

**Exit Criteria:** Context objects are immutable/serializable, traces include activity correlation, and concurrency tests demonstrate thread safety.

**Deliverable:** Thread-safe, activity-aware context + observability.

---

## Phase 5 – Error Handling & Join Semantics

**Goal:** Define deterministic behaviour for merges, failures, and cancellation in the multi-activity world.

- [x] Implement join strategies (`all`, `any`, `first`, future `quorum`) in the scheduler; ensure activity results feed into join logic.
- [x] On activity failure, propagate according to policy (fail workflow, skip dependents, route to error edges).
- [x] Add cancellation hooks so upstream cancellation can short-circuit queued activities.
- [x] Ensure undefined inputs throw deterministic errors (no silent `warn` + continue).
- [x] Document per-node retry policy merge rules (component default vs workflow override).
  - Planned merge order:
    1. **Platform baseline** – start from the worker-level defaults we register alongside `shipsecWorkflowRun` (`maxAttempts=3`, `initialIntervalSeconds=2s`, `maximumIntervalSeconds=60s`, `backoffCoefficient=2.0`, `nonRetryableErrorTypes=[]`).
    2. **Component defaults** – when a component manifest exposes `execution.retryPolicy`, copy only the defined fields onto the baseline.
    3. **Workflow-level override** – if the DSL emits `definition.config.retryPolicy`, overlay those fields so every node inherits the same policy unless explicitly overridden.
    4. **Node-level override** – apply `definition.nodes[ref].retryPolicy` last; defined fields replace the inherited value. Supplying `nonRetryableErrorTypes` replaces the list, and setting `maxAttempts: 1` disables retries. Omit a property to inherit the prior layer.
  - Implementation notes:
    - Extend `WorkflowNodeMetadata` and shared DTOs with `retryPolicy?: { maxAttempts?: number; initialIntervalSeconds?: number; maximumIntervalSeconds?: number; backoffCoefficient?: number; nonRetryableErrorTypes?: string[] }`.
    - Surface the merged policy on `RunComponentActivityInput.metadata.retryPolicy` so activities/log adapters can include attempt budgets and retry context.
    - Pass the merged policy to `workflow.execute_activity` options to honour overrides at runtime while preserving Temporal’s non-retryable error behaviour.
- [x] Tests:
  - [x] Unit tests for join strategies with mocked activity outcomes.
  - [x] Failure propagation tests (diamonds, scatter/gather) using activity stubs.
  - [x] Cancellation contract test ensuring downstream activities never start after upstream cancel.

**Implementation Steps**
1. Extend scheduler graph model with join metadata and failure policies.
2. Implement result aggregation + policy evaluation in the orchestrator.
3. Wire cancellation propagation through Temporal `cancel_activity` / custom signals.
4. Update shared typings (`@shipsec/shared`) with join strategy enums and failure payloads.

**Dependencies:** Relies on Phase 4 context metadata for branch correlation.

**Exit Criteria:** Joins behave deterministically across strategies, failure matrix documented and validated by automated tests.

**Deliverable:** Behaviour matrix documented + covered by tests.

---

## Phase 6 – Integration Tests & Temporal Validation

**Goal:** Validate the multi-activity architecture end-to-end.

- [x] Extend worker unit/integration coverage to assert parallel activities, join semantics, and failure reporting.
  - Added Temporal integration regression that executes an error-edge workflow and asserts persisted failure traces (`worker/src/__tests__/worker-integration.test.ts`).
- [x] Add determinism tests ensuring repeated executions yield identical trace sequences.
  - Added `executeWorkflow` regression capturing full trace ordering across repeated runs (`worker/src/temporal/__tests__/workflow-runner.test.ts`).
- [x] Run long-lived workflows via `worker/scripts/run-long-lived-workflow.ts` to confirm logs/traces and persist snapshots.
  - Script now materialises trace snapshots under `worker/benchmarks/long-lived-trace-*.json` for post-run inspection.
- [x] Benchmark serial vs parallel workflows and compare with pre-activity baseline (`worker/scripts/benchmark-scheduler.ts`).
  - Harness records inline vs Temporal activity timings for serial/parallel DAGs and stores structured snapshots per run.
- [x] Capture regression snapshots (trace timelines, metrics) for future comparisons.
  - Benchmarks and long-lived workflows emit timestamped JSON artifacts to `worker/benchmarks/`, giving repeatable baselines.

**Implementation Steps**
1. Build deterministic activity fixtures to simulate success/failure/retry scenarios.
2. Author replay/determinism tests verifying consistent trace sequences.
3. Create benchmarking harness comparing inline vs activity execution throughput.
4. Publish validation artifacts (dashboards, logs) for review.

*Status:* Testfixture `test.sleep.parallel` is now part of the component bundle, the replay suite covers determinism, and the benchmarking/long-lived scripts persist artifacts for review.

**Dependencies:** Requires Phases 4–5 features behind toggles; schedule to run in staging Temporal namespace.

**Exit Criteria:** Integration suite passes with activities enabled, replay tests green, and performance baselines recorded.

**Deliverable:** Passing integration suite demonstrating the new execution model.

---

## Phase 7 – Frontend & API Alignment

**Goal:** Surface the richer runtime metadata to users.

- [ ] Update backend status/trace APIs with activity IDs, join metadata, and failure semantics.
- [ ] Adjust frontend stores (`executionTimelineStore`, canvas overlays) to render parallel activity states.
- [ ] Add UI indicators for per-node retries and activity IDs.
- [ ] Ensure `@shipsec/shared` exports updated models.
- [ ] Backfill migrations so existing run records tolerate new fields.
- [ ] Tests:
  - Frontend unit tests for activity timeline rendering.
  - Manual workflow run verifying UI reflects parallel activities.
  - Contract tests ensuring backend responses match updated shared DTOs.

**Implementation Steps**
1. Version backend API responses and add compatibility transforms.
2. Update shared package typings + regenerate clients.
3. Refactor frontend timeline components to group events by activity and join.
4. Run smoke tests against dev environment with activities enabled.

**Dependencies:** Backend trace payloads enhanced in Phase 4, failure semantics from Phase 5.

**Exit Criteria:** UI renders activity-aware runs, contract tests pass, and no breaking changes for existing clients.

**Deliverable:** UI + API aligned with activity-driven execution.

---

## Phase 8 – Guardrails, Concurrency Caps & Rollout

**Goal:** Harden for production loads and deliver safely.

- [ ] Implement per-node and global concurrency caps (token buckets or semaphore) configured via node metadata/runner config.
- [ ] Instrument metrics: queued activities, active activities, retries, failure rates.
- [ ] Add feature flags to toggle between inline and activity-based execution during soak.
- [ ] Document migration/rollback steps and update operational runbooks.
- [ ] Build regression suite (deterministic workflow snapshot) guarding future changes.
- [ ] Plan rollout stages (canary orgs, phased enablement) with monitoring thresholds.

**Implementation Steps**
1. Introduce concurrency config schema + worker enforcement (semaphores).
2. Expose metrics via Prometheus exporters / Temporal visibility queries.
3. Wire feature flags into backend + worker boot flow.
4. Draft rollout playbook with success metrics and rollback triggers.

**Dependencies:** Requires Phases 4–7 complete; coordinate with DevOps for metrics stack.

**Exit Criteria:** Feature-flagged rollout plan approved, guardrails implemented, and monitoring dashboards live.

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

- `2025-10-18` – Phase 6 validation assets landed (error-edge integration regression, deterministic trace suite, inline vs Temporal benchmarking, long-lived workflow snapshots).
- `2025-10-17` – Propagated failure metadata through the scheduler so error-edge activities receive upstream failure context and added regression coverage for the runtime + plan updated accordingly.
- `2025-10-16` – Hardened scheduler join-any failure handling to keep downstream nodes eligible when sibling parents fail; added regression coverage.
- `2025-10-15` – Plan updated to adopt activity-per-component orchestration following Tracecat semantics; Phases 0–2 marked completed.
- `2025-10-15` – Initial plan drafted.
