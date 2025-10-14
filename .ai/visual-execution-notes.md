# Visual Execution & Trace Capture Concepts

## 2025-10-13 · Phase 0 Audit Snapshot

- **Infrastructure prerequisites:** Docker/Docker Compose binaries are currently absent (`docker compose` and `docker-compose` not found), so Temporal/Postgres/MinIO stack cannot be brought up in this environment. PM2 is configured via `pm2.config.cjs` but not running yet; log checks must use `timeout` once processes are started to avoid hanging.
- **Execution status endpoint:** `GET /workflows/runs/:runId/status` returns the Temporal service payload directly (`WorkflowExecutionStatusName`), e.g. `RUNNING`, with `startTime`, optional `closeTime`, `historyLength`, and `taskQueue`. No progress counters or failure metadata are exposed yet.
- **Execution status endpoint:** now normalises responses to the shared contract (`runId`, `workflowId`, `status`, `updatedAt`, `failure?`). Progress counters are populated (`completedActions/totalActions`) using the workflow DSL and stored trace metadata.
- **Trace endpoint:** `GET /workflows/runs/:runId/trace` surfaces events without stable IDs or levels. Payload shape mirrors `TraceEvent` (`type`, `nodeRef`, `timestamp`, optional `message`/`error`/`outputSummary`). Database stores a `sequence` column that is not returned to callers.
- **Worker emission:** `TraceAdapter` increments per-run sequence numbers and persists events, but only records `type/message/error/outputSummary`. `createExecutionContext.emitProgress` emits `NODE_PROGRESS` events without severity. Docker runner buffers stdout/stderr until completion, so no live streaming today.
- **Frontend consumption:** `ExecutionStatusResponseSchema` requires UUIDs and lowercase statuses (`running`, `completed`, etc.), causing Zod validation failures when parsing backend responses (`shipsec-run-*`, uppercase). `ExecutionLogSchema` also enforces UUID IDs, so trace events fail parse. `useExecutionStore.startExecution` still mocks executions, while polling fetches backend endpoints but discards failures caused by schema mismatch.
- **Tests:** `bun run test --filter workflows.service` fails because the monorepo `test` script chains multiple `bun test` commands before the `--filter` flag. No automated verification executed during this audit due to that wrapper. Dedicated backend test invocation will need a different command.

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
