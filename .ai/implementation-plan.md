# ShipSec Studio – Execution Observability Implementation Plan

This plan supersedes the previous implementation playbook. It focuses on delivering end-to-end execution observability: consistent status contracts, rich trace data, live log streaming, and Loki-backed log storage. Each phase is designed for autonomous implementation by an AI agent and concludes with a human review before advancing.

**Status update (2025-10-13):** System is stable through earlier backend/frontend milestones. Observability stack is still at the prototype stage (in-memory traces, mock frontend polling). This plan charts the path to production-grade telemetry.

---

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ⚪ Not Started | Baseline Audit & Readiness |
| Phase 1 | 🟡 In Progress | Contract Specification & Shared Types |
| Phase 2 | ⚪ Not Started | Backend Contract Realignment |
| Phase 3 | ⚪ Not Started | Frontend Schema & Store Sync |
| Phase 4 | ⚪ Not Started | Worker Trace Enhancements |
| Phase 5 | ⚪ Not Started | Loki Log Backend Integration |
| Phase 6 | ⚪ Not Started | Live Streaming Pipeline |
| Phase 7 | ⚪ Not Started | UX Polish & Controls |
| Phase 8 | ⚪ Not Started | Observability Metrics & Regression Suite |

**Primary Objective:** Deliver a magical, real-time execution experience for workflows (e.g., run `7528ea47-0c0f-4236-b864-5072d8e5b6ce`) where every node streams status, progress, and logs while running.

---

## Phase 0 – Baseline Audit & Readiness

**Goal:** Capture the current behaviour, identify contract drift, and ensure local stack readiness.

- [ ] Inventory `/workflows/runs/*` endpoints, current DB schema (`workflow_traces`), and Temporal client usage.
- [ ] Document frontend data flow (`executionStore`, `BottomPanel`, canvas badges).
- [ ] Verify Docker/MQ/Loki prerequisites; update `.env.example` accordingly.
- [ ] Tests:
  - `bun run test backend --filter workflows.service`
  - Manual `curl` to `/workflows/runs/:runId/status` and `/trace`
- **Deliverable:** audit log in `.ai/visual-execution-notes.md` summarising deviations to resolve in Phases 1–3.

---

## Phase 1 – Contract Specification & Shared Types

**Goal:** Publish the authoritative execution status and trace specification consumed by both backend and frontend.

- [x] Draft execution status schema (enum, timestamps, failure payload, progress fields).
- [x] Draft trace event schema (id, nodeId, type, level, message, error, outputSummary, data).
- [x] Add shared TypeScript exports (`packages/shared/src/execution.ts`) for backend + frontend reuse.
- [ ] Update OpenAPI definitions so generated clients reflect the new contract.
- [x] Tests/validation: `bun test` root (pulls in shared package), ensure schemas compile.
- **Deliverable:** `docs/execution-contract.md` (new) describing the contract.

---

## Phase 2 – Backend Contract Realignment

**Goal:** Rebuild backend responses so they natively emit the shared spec. No backwards-compatibility shims are required—treat this as a clean 0.1 baseline.

- [x] Add database migration extending `workflow_traces` with `level` and `data` columns.
- [x] Normalize Temporal statuses → new enum; include timestamps and failure info in `WorkflowsService` responses.
- [x] Persist workflow run metadata (run → workflow mapping, total actions) for progress calculations.
- [x] Ensure run IDs and Temporal IDs stay consistent (`shipsec-run-*`).
- [x] Update `TraceService` to emit deterministic event IDs (`${sequence}`) and attach new fields.
- [x] Compute progress counters (completed/total actions) for status response.
- [x] Tests:
  - Unit tests for status normalization and trace mapping (`backend/src/workflows/__tests__/workflows.service.spec.ts`).
  - Integration test hitting `/status` and `/trace`, asserting schema compliance (`backend/src/workflows/__tests__/workflows.http.spec.ts`).
  - Migration smoke test script (`bun run migration:smoke`).

---

## Phase 3 – Frontend Schema & Store Sync

**Goal:** Replace placeholder schemas, align polling/store logic with the new backend payloads, and expose the data in the UI.

- [ ] Update `frontend/src/schemas/execution.ts` with shared types (string IDs, uppercase statuses, structured failure fields).
- [ ] Refactor `useExecutionStore` to ingest backend status/logs directly (remove manual level inference and UUID assumptions).
- [ ] Update BottomPanel and canvas overlays to display progress counts, failure reasons, log levels.
- [ ] Ensure `apiClient.runWorkflow` forwards runtime inputs in the request body.
- [ ] Tests:
  - Store unit tests covering incremental log merges and terminal states.
  - Component tests (BottomPanel, node badges) for info/error rendering.
  - Manual workflow run confirming UI no longer raises false alerts.

---

## Phase 4 – Worker Trace Enhancements

**Goal:** Emit richer, structured trace events directly from the worker and component SDK.

- [ ] Extend `TraceEvent` interface in `@shipsec/component-sdk` with `level` (`info`, `warn`, `error`, `debug`) and `data` payload support.
- [ ] Update `createExecutionContext.emitProgress` to accept `{ level, message, data }` and persist via `TraceAdapter`.
- [ ] Record `NODE_STARTED/COMPLETED/FAILED/PROGRESS` with explicit levels.
- [ ] Ensure `TraceAdapter` writes new fields to Postgres (using Phase 2 migration).
- [ ] Tests:
  - Unit tests for `TraceAdapter.persist` verifying `level/data` stored.
  - Workflow runner tests capturing emitted progress events and order.

---

## Phase 5 – Loki Log Backend Integration

**Goal:** Introduce Grafana Loki for high-volume stdout/stderr storage while keeping structured traces in Postgres.

- [ ] Add Loki service to `docker-compose` with local filesystem storage and provide `loki-config.yaml`.
- [ ] Implement worker Loki client pushing logs with labels `{run_id,node,stream}` to `/loki/api/v1/push`.
- [ ] Persist Loki references (label set + time range) alongside trace metadata for retrieval.
- [ ] Backend endpoint to query Loki for a run/node (simple passthrough).
- [ ] Tests:
  - Integration test pushing sample logs and querying them back.
  - Worker smoke test verifying Loki push success (with retry/backoff logging).

---

## Phase 6 – Live Streaming Pipeline

**Goal:** Stream stdout/stderr and trace updates to the frontend in real time.

- [ ] Modify Docker runner to forward stdout/stderr chunks immediately via `emitProgress` while still capturing final output for JSON parsing.
- [ ] Add streaming endpoint (SSE or WebSocket) relaying new trace events (via Postgres `LISTEN/NOTIFY` or incremental polling).
- [ ] Frontend subscriber to append events live, maintain ordering, and fall back to polling if streaming unavailable.
- [ ] UX toggles: “Follow live logs”, “Pause autoscroll”.
- [ ] Tests:
  - Automated test simulating streaming events (Jest + mock EventSource).
  - Manual run demonstrating live updates end-to-end.

---

## Phase 7 – UX Polish & Controls

**Goal:** Deliver a delightful, informative execution UI.

- [ ] Node-level badges (running/completed/error) with counts; tooltip showing last log line.
- [ ] Collapse/expand per-node log panes; filter by level and stream.
- [ ] Artefact download links and summary view (wired to S3 + Loki).
- [ ] Retention controls allowing users to purge run logs/artifacts from the UI.
- [ ] Tests: visual regression or screenshot tests covering node states; integration tests for artefact download.

---

## Phase 8 – Observability Metrics & Regression Suite

**Goal:** Guard against regressions and surface system health signals.

- [ ] Emit metrics (Prometheus/StatsD): `trace_events_total`, `loki_push_failures_total`, `stream_latency_ms`.
- [ ] Add health endpoints and alerts for log pipeline failures.
- [ ] Build regression suite: deterministic workflow run with snapshot comparison of trace timeline.
- [ ] Document runbook for replaying logs from Loki + trace DB.
- [ ] Tests:
  - Metrics endpoint unit test.
  - Failure injection test (simulate Loki outage) ensuring graceful degradation and alerting.

---

## Decommissioning & Documentation

- [ ] Remove legacy mocks (`executionStore.startExecution`, placeholder schemas).
- [ ] Migrate historical trace data or provide conversion script.
- [ ] Update `.ai/visual-execution-notes.md`, README, and developer docs with the new pipeline, Loki usage, and troubleshooting tips.
- [ ] Human review before declaring observability milestone complete.

---

## Operational Runbook (Applies to All Phases)

Keep these commands handy while executing the phases above. Update the section whenever tooling or process changes.

### Prerequisites

- Docker (with ≥8 GB memory allocated).
- `bun` and `pm2` installed globally (`npm i -g pm2`).
- `.env` populated from `.env.example` with Temporal, Postgres, MinIO, and (Phase 5+) Loki settings.

### Start Core Infrastructure

```bash
# Temporal, Postgres, MinIO and (later) Loki
docker compose up -d

# Quick health checks
docker compose ps
curl -f http://localhost:8080/health || echo "Temporal UI not ready yet"
```

### Start Application Processes with PM2

```bash
# Launch API + worker defined in pm2.config.cjs
pm2 start

# Inspect status without entering follow mode
pm2 status
timeout 5s pm2 logs backend --lines 50 || true
timeout 5s pm2 logs worker --lines 50 || true
```

> Always wrap `pm2 logs` with `timeout` (or use `--nostream`) so automation scripts do not hang in tail mode.

### Run Tests

```bash
# Monorepo tests
bun run test

# Optional targeted suites
bun run --filter backend test
bun run lint
bun run typecheck
```

### Shutdown & Cleanup

```bash
pm2 stop all
docker compose down
# Optional volume cleanup when a fresh start is needed
docker volume ls -q | grep shipsec | xargs -r docker volume rm
```

Document project-specific shortcuts or scripts in this section as they evolve so future agents can reproduce your setup quickly.

---

**Change Log**

- `2025-10-14` – Added workflow run metadata + trace level/data persistence; Phase 2 backend alignment underway.
- `2025-10-13` – Added execution contract spec (`docs/execution-contract.md`) and shared TypeScript schemas via `@shipsec/shared`.
- `2025-10-13` – Added operational runbook and local environment guidance.
- `2025-10-13` – Replaced legacy implementation plan with observability-focused roadmap (this document).

**Next Agent Instructions**

1. Begin with Phase 0 audit and record findings.
2. Notify human reviewer, then proceed sequentially through the phases.
3. Treat each phase as independently reviewable; avoid multi-phase merges in one PR.
4. Maintain exhaustive tests and update this plan after each completed phase.
