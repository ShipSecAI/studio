# Visual Execution & Trace Capture Concepts

## 2025-10-13 · Phase 0 Audit Snapshot

- **Infrastructure prerequisites:** Docker/Docker Compose binaries are currently absent (`docker compose` and `docker-compose` not found), so Temporal/Postgres/MinIO stack cannot be brought up in this environment. PM2 is configured via `pm2.config.cjs` but not running yet; log checks must use `timeout` once processes are started to avoid hanging.
- **Execution status endpoint:** `GET /workflows/runs/:runId/status` returns the Temporal service payload directly (`WorkflowExecutionStatusName`), e.g. `RUNNING`, with `startTime`, optional `closeTime`, `historyLength`, and `taskQueue`. No progress counters or failure metadata are exposed yet.
- **Execution status endpoint:** now normalises responses to the shared contract (`runId`, `workflowId`, `status`, `updatedAt`, `failure?`). Progress counters are populated (`completedActions/totalActions`) using the workflow DSL and stored trace metadata.
- **Trace endpoint:** `GET /workflows/runs/:runId/trace` surfaces events without stable IDs or levels. Payload shape mirrors `TraceEvent` (`type`, `nodeRef`, `timestamp`, optional `message`/`error`/`outputSummary`). Database stores a `sequence` column that is not returned to callers.
- **Worker emission:** `TraceAdapter` increments per-run sequence numbers and persists events, but only records `type/message/error/outputSummary`. `createExecutionContext.emitProgress` emits `NODE_PROGRESS` events without severity. Docker runner buffers stdout/stderr until completion, so no live streaming today.
- **Frontend consumption:** `ExecutionStatusResponseSchema` requires UUIDs and lowercase statuses (`running`, `completed`, etc.), causing Zod validation failures when parsing backend responses (`shipsec-run-*`, uppercase). `ExecutionLogSchema` also enforces UUID IDs, so trace events fail parse. `useExecutionStore.startExecution` still mocks executions, while polling fetches backend endpoints but discards failures caused by schema mismatch.
- **Tests:** `bun run test --filter workflows.service` fails because the monorepo `test` script chains multiple `bun test` commands before the `--filter` flag. No automated verification executed during this audit due to that wrapper. Dedicated backend test invocation will need a different command.

## 2025-10-14 · Phase 2 Environment & Tests

- **Infrastructure prerequisites:** Docker Engine 28.5.1 and Compose 2.40.0 available locally; `docker compose up -d` brings up Postgres, Temporal, Temporal UI, and MinIO (all healthy). This supersedes the earlier note about missing binaries.
- **Runtime orchestration:** Backend + workers launched with `npx pm2 start pm2.config.cjs`. A lingering `bun --watch src/main.ts` process on port 3211 caused initial `EADDRINUSE`; killed PID 3153772 to stabilise the pm2-managed backend. Health check: `curl -sf http://localhost:3211/health` returns `{"status":"ok",...}`.
- **Test execution:** Ran `bun test` inside `backend/`; contract-focused suites (`workflows.http.spec.ts`, `workflows.service.spec.ts`, `trace.service.spec.ts`, DSL compiler) pass. Legacy HTTP integration suite remains skipped pending dedicated fixtures.
- **Integration suite:** Enabled via `RUN_BACKEND_INTEGRATION=true bun test` while backend runs under pm2. Updated fixtures to align with shared workflow schema and uncovered a validation bug—`PUT /workflows/:id` applied the Zod pipe to the `id` route param, returning 400. Fixed by moving the pipe onto `@Body(...)` so updates now succeed end-to-end.
- **Observations:** `pm2.config.cjs` invokes `bun --watch`; pm2 restarts can stack if manual runs leave orphan processes. Always clean stray Bun processes (`lsof -i :3211`) before restarting pm2 to avoid port conflicts.

## 2025-10-14 · Phase 3 Frontend Sync

- **Shared types:** Frontend schemas now re-export `WorkflowRunStatus`/`TraceEvent` from `@shipsec/shared`, dropping UUID assumptions and preserving uppercase statuses (`frontend/src/schemas/execution.ts`).
- **Execution store:** Rebuilt `useExecutionStore` to call real backend APIs, merge trace envelopes idempotently, and derive node states and lifecycle from shared enums (`frontend/src/store/executionStore.ts`).
- **UI wiring:** TopBar surfaces queue/progress/failure metadata from the new status payload; BottomPanel renders structured trace levels and message fallbacks.
- **Tests:** Added `frontend/src/store/__tests__/executionStore.test.ts` verifying log dedupe + terminal state handling plus component coverage for TopBar & BottomPanel, all wired into `bun run test`.

## Live Run UX
- Canvas node states: idle, running (pulsing), success (green), failure (shaking red). Edges animate data flow.
- Bottom console streams structured logs per node; supports filters and artifact previews.
- Progress updates (e.g., HTTPX scanned 89/127) derived from `NODE_PROGRESS` events emitted by modules.

## Replay Mode
- Historical runs selectable from timeline; playback re-applies captured events to animate the DAG.
- Scrubber jumps to a timestamp; canvas + console reflect state at that moment.
- Diff view highlights behavioral changes between runs (new nodes, altered outputs).

## Trace Event Schema (concept)
```
NODE_STARTED, NODE_LOG, NODE_PROGRESS, NODE_ARTIFACT,
NODE_COMPLETED, NODE_FAILED, WORKFLOW_STATUS
```
Each stores `runId`, `nodeId`, timestamp, payload.

## Capture Pipeline
1. DSL workflow schedules `recordEvent` activities around each node execution.
2. Activities and executor send log/progress/artifact events via streaming channel to a Trace Collector service.
3. Collector writes append-only events (Postgres/Redis Streams) for live fan-out + replay.
4. UI subscribes to live events for active runs; fetches stored events for historical runs.
5. Artifacts saved to object storage; metadata referenced by `NODE_ARTIFACT` events.

## Developer Hooks
- Module SDK exposes `context.log()`, `context.progress()`, `context.emitArtifact()` to emit trace events.
- Worker handles retries and heartbeats, preserving trace continuity.

## 2025-10-15 · Scheduler Phase 0 Audit

- **DSL compiler:** `backend/src/dsl/compiler.ts` topologically sorts nodes then emits a flattened `actions` array. Edge metadata is reduced to per-action `inputMappings` and a `dependsOn` list, losing adjacency, edge typing, or join semantics required for parallel scheduling.
- **Worker runtime:** `worker/src/temporal/workflow-runner.ts` iterates the `actions` array sequentially. Outputs are stored in a shared `Map`, so independent branches block on previous nodes even when no dependency exists; there is no ready queue or future-based coordination.
- **Trace/log context:** Shared adapters (`TraceAdapter`, log collector) are reused per iteration without branch isolation. Trace emission assumes in-order execution and would race once nodes run concurrently.
- **Join handling:** Input resolution silently warns when a mapped value is `undefined` and continues execution. There are no explicit join strategies; multi-parent nodes expect predecessors to have already completed successfully.
- **Tests:** Existing unit tests (`worker/src/temporal/__tests__/workflow-runner.test.ts`) assert sequential event ordering, reflecting—and cementing—the serialized execution model.
- **Verification:** Ran `bun --cwd worker test`; updated the file-loader integration expectation so the suite passes. Manual multi-branch dry-run captured below.

### Temporal Worker Boundary Review
- `shipsecWorkflowRun` proxies a single activity (`runWorkflowActivity`) with a 10 minute start-to-close timeout; scheduling/branching occurs entirely inside that activity, not across multiple activities or child workflows.
- `runWorkflowActivity` injects storage/trace/log adapters via module-level globals initialised in `dev.worker.ts` (`initializeActivityServices`), so every component execution shares the same adapters; retries rely on Temporal’s proxy timeout only.
- Worker bootstrap (`dev.worker.ts`) wires Temporal `Worker.create` with just this activity set; no per-component activities exist. Failure in any component propagates out of `executeWorkflow` and causes the lone activity to fail.
- Manual sequential dry-run: executing two independent “sleep” components confirmed branch `b` waits for `a` to finish (start times ~406 ms apart), validating the serialized loop observed in code.

## 2025-10-15 · Phase 1 Schema Enrichment

- Updated DSL schemas to include `version`, node metadata map, explicit edges (with handles + kind), and per-node dependency counts (`backend/src/dsl/types.ts`).
- Compiler now emits the enriched structure while preserving action order; labels flow into node metadata and dependency counts capture indegree (default edge kind `success`).
- Worker definition types mirror the new schema (`worker/src/temporal/types.ts`), preparing the runtime for a graph-driven scheduler.
- Added compiler unit test covering a diamond graph to verify dependency counts and edge metadata; backend test suite passes with the new schema.

## 2025-10-15 · Phase 2 Scheduler Core

- Added `runWorkflowWithScheduler` (worker/src/temporal/workflow-scheduler.ts) implementing an indegree-driven ready queue; batches of ready nodes execute via Promise.all and unlock dependents.
- `executeWorkflow` now delegates action sequencing to the scheduler while reusing existing trace/log logic; results map stores outputs for downstream nodes.
- Introduced a concurrency-focused test (`executeWorkflow > executes independent branches in parallel`) that registers a synthetic sleep component and asserts branch start times differ by <60 ms, confirming real parallel execution.
- Worker integration suite still passes; overall runtime now supports concurrent branch execution without altering component contracts.

## 2025-10-16 · Phase 3 Activity Orchestration

- Temporal workflow (`shipsecWorkflowRun`) now orchestrates the DAG directly, using `runWorkflowWithScheduler` to determine ready nodes and invoking `runComponentActivity` via `workflow.executeActivity`.
- Introduced `runComponentActivity` plus lifecycle helpers (`setRunMetadataActivity`, `finalizeRunActivity`) so trace adapters receive run metadata while each component executes in its own activity with full retries/timeouts.
- Workflow resolves input mappings before scheduling the activity; unresolved mappings are passed as warnings so the activity emits `NODE_PROGRESS` warnings before execution.
- Manual trigger inputs continue to flow (`__runtimeData` for trigger component, merged params for others).
- Scheduler remains for inline execution (`executeWorkflow` tests) while the Temporal workflow leverages the same logic with activity isolation; worker integration tests confirm the new orchestration.
