# ShipSec Studio – Execution Observability Implementation Plan

This plan supersedes the previous implementation playbook. It focuses on delivering end-to-end execution observability: consistent status contracts, rich trace data, live log streaming, and Loki-backed log storage. Each phase is designed for autonomous implementation by an AI agent and concludes with a human review before advancing.

**Status update (2025-11-05):** Trace + Loki pipeline and live streaming are live (Phases 5–6 ✅). Initial product analytics (PostHog) added to the frontend with session recording and a typed UI event layer. Analytics is env‑gated so local clones run without configuration.

---

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ⚪ Not Started | Baseline Audit & Readiness |
| Phase 1 | 🟡 In Progress | Contract Specification & Shared Types |
| Phase 2 | 🟢 Completed | Backend Contract Realignment |
| Phase 3 | 🟢 Completed | Frontend Schema & Store Sync |
| Phase 4 | 🟢 Completed | Worker Trace Enhancements |
| Phase 5 | 🟢 Completed | Loki Log Backend Integration |
| Phase 6 | 🟢 Completed | Live Streaming Pipeline |
| Phase 7 | 🟢 Completed | Visual Execution Timeline & Replay System |
| Phase 8 | 🟡 Planned | Observability Metrics, Analytics Expansion & Regression Suite |

**Primary Objective:** Deliver a magical, real-time execution experience for workflows (e.g., run `7528ea47-0c0f-4236-b864-5072d8e5b6ce`) where every node streams status, progress, and logs while running.

---

## Phase 0 – Baseline Audit & Readiness

**Goal:** Capture the current behaviour, identify contract drift, and ensure local stack readiness.

- [ ] Inventory `/workflows/runs/*` endpoints, current DB schema (`workflow_traces`), and Temporal client usage.
- [ ] Document frontend data flow (`executionStore`, `BottomPanel`, canvas badges).
- [ ] Verify Docker/MQ/Loki prerequisites; update `.env.example` accordingly.
- [x] Tests:
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

- [x] Update `frontend/src/schemas/execution.ts` with shared types (string IDs, uppercase statuses, structured failure fields).
- [x] Refactor `useExecutionStore` to ingest backend status/logs directly (remove manual level inference and UUID assumptions).
- [x] Update BottomPanel and canvas overlays to display progress counts, failure reasons, log levels.
- [x] Ensure `apiClient.runWorkflow` forwards runtime inputs in the request body.
- [ ] Tests:
  - [x] Store unit tests covering incremental log merges and terminal states.
  - [x] Component tests (BottomPanel, node badges) for info/error rendering.
  - [x] Manual workflow run confirming UI no longer raises false alerts.

---

## Phase 4 – Worker Trace Enhancements

**Goal:** Emit richer, structured trace events directly from the worker and component SDK.

- [x] Extend `TraceEvent` interface in `@shipsec/component-sdk` with `level` (`info`, `warn`, `error`, `debug`) and `data` payload support.
- [x] Update `createExecutionContext.emitProgress` to accept `{ level, message, data }` and persist via `TraceAdapter`.
- [x] Record `NODE_STARTED/COMPLETED/FAILED/PROGRESS` with explicit levels.
- [x] Ensure `TraceAdapter` writes new fields to Postgres (using Phase 2 migration).
- [x] Supabase misconfiguration scanner emits progress updates per check to stay compatible with trace visualisation.
- [x] Tests:
  - [x] Unit tests for `TraceAdapter.persist` verifying `level/data` stored.
  - [x] Workflow runner tests capturing emitted progress events and order.

---

## Phase 5 – Loki Log Backend Integration

**Goal:** Introduce Grafana Loki for high-volume stdout/stderr storage while keeping structured traces in Postgres.

- [x] Add Loki service to `docker-compose` with local filesystem storage and provide `loki-config.yaml`.
- [x] Implement worker Loki client pushing logs with labels `{run_id,node,stream}` to `/loki/api/v1/push`.
- [x] Persist Loki references (label set + time range) alongside trace metadata for retrieval.
- [x] Backend endpoint to query Loki for a run/node (simple passthrough).
- [x] Tests:
  - [x] HTTP + service tests asserting Loki metadata wiring and query behaviour (`backend/src/workflows/__tests__/workflows.http.spec.ts`, `backend/src/trace/__tests__/log-stream.service.spec.ts`).
  - [x] Worker adapter tests covering Loki push payload + Postgres persistence (`worker/src/adapters/__tests__/loki-log.adapter.test.ts`).

---

## Phase 6 – Live Streaming Pipeline

**Goal:** Stream stdout/stderr and trace updates to the frontend in real time.

- [x] Modify Docker runner to forward stdout/stderr chunks immediately via `emitProgress` while still capturing final output for JSON parsing.
- [x] Add streaming endpoint (SSE or WebSocket) relaying new trace events (via Postgres `LISTEN/NOTIFY` or incremental polling).
- [x] Frontend subscriber to append events live, maintain ordering, and fall back to polling if streaming unavailable.
- [x] UX toggles: "Follow live logs", "Pause autoscroll".
- [x] Tests:
  - [x] Automated test simulating streaming events (Jest + mock EventSource).
  - [x] Manual run demonstrating live updates end-to-end.

---

## Phase 6.5 – Product Analytics (Frontend)

**Goal:** Establish a minimal, privacy‑aware analytics foundation to understand UI usage and validate UX changes.

- [x] Add PostHog client with env‑gated initialisation (`VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST`).
- [x] Enable session recording with privacy defaults (mask inputs, respect DNT).
- [x] Capture SPA pageviews via router listener.
- [x] Identify users and group by organization via Clerk bridge.
- [x] Add typed event helper (`track`) with zod‑validated payloads and initial taxonomy.
- [x] Docs: `docs/analytics.md` including troubleshooting.

**Initial UI Event Taxonomy**
- `ui_workflow_list_viewed(workflows_count?)`
- `ui_workflow_create_clicked()`
- `ui_workflow_builder_loaded(workflow_id?, is_new, node_count?)`
- `ui_workflow_created(workflow_id, node_count, edge_count)`
- `ui_workflow_saved(workflow_id, node_count, edge_count)`
- `ui_workflow_run_started(workflow_id, run_id?, node_count?)`
- `ui_node_added(workflow_id?, component_slug)`
- `ui_secret_created(has_tags?, tag_count?, name_length?)`
- `ui_secret_deleted(name_length?)`
- Secret Manager events intentionally avoid emitting raw secret identifiers; only derived metadata (length/counts) is sent to analytics.

**Deferred**
- Backend/worker server‑side analytics (`posthog-node`) for trusted events.
- Expanded taxonomy for builder interactions, errors, and timeline usage.

---

## Phase 7 – Visual Execution Timeline & Replay System

**Goal:** Create a time-travel debugger for workflows - unified interface showing live execution or historical replay with data flow animations and event inspection.

### Core Vision
- **Unified Interface**: Same visual language for live and historical runs
- **Time-Travel Debugging**: Scrub through any execution at variable speeds (0.1x-10x)
- **Data Flow Visualization**: Animated packets flowing along edges showing data movement
- **Interactive Canvas**: Click nodes to inspect events, hover edges to see data packets

### Implementation Tasks

#### Timeline & Run Selection
- [x] Run selector dropdown showing all executions with metadata (status, duration, node count)
- [x] Timeline component with scrubber, play/pause controls, and speed adjustment (0.1x-10x)
- [x] Live mode with auto-scrolling playhead vs replay mode with full seeking
- [x] Event markers on timeline (node starts, completions, errors, data flows)

#### Enhanced Canvas Visualization
- [x] Node visual states with pulsing borders, progress rings, and event count badges
- _Remaining animation work moved to Phase 8 backlog._

#### Event Inspection System
- [x] Event inspector panel showing detailed event information
- _Additional inspector enhancements moved to Phase 8 backlog._

#### Animation & Interaction Engine
- _Deferred animation engine features moved to Phase 8 backlog._

#### Backend Integration
- [x] `/runs` endpoint returning list of all executions
- [x] `/runs/:id/events` returning complete event timeline
- [x] `/runs/:id/dataflows` returning data flow graph
- [x] Enhanced SSE including data flow events
- [x] Event ordering and timestamp accuracy

#### User Experience
- [x] Seamless switching between live and replay modes
- _Keyboard shortcuts, responsive sizing, and performance tuning moved to Phase 8 backlog._
- [x] Mode-aware layout: dedicated Design vs Review shells with clear visual affordances
- [x] Right-docked inspector with Events / Logs / Data tabs tied to node selection
- [x] Timeline overlay with cinematic playback controls anchored above the canvas
- [x] Contextual run summary banner (status, duration, warnings) when in Review mode
- [x] Empty-state copy and call-to-actions for logs/timeline when no run is selected

- _Test coverage for timeline + animation moved to Phase 8 backlog._

---

## Phase 8 – Observability Metrics & Regression Suite

**Goal:** Guard against regressions and surface system health signals.

### Backlog from Phase 7
- [ ] Data packet animations flowing along edges at replay speed
- [ ] Edge hover effects showing packet content preview
- [ ] Error glow effects with expandable error details
- [ ] Multiple simultaneous flows for parallel execution
- [ ] Input/output data visualization for each node
- [ ] Log timeline per-node with filtering capabilities
- [ ] Related data flow highlighting between nodes
- [ ] Playback controller supporting step-through, looping, bookmarks
- [ ] Smooth data packet animations with configurable speeds
- [ ] Node state transitions (idle → running → success/error)
- [ ] Timeline seeking with instant canvas state restoration
- [ ] Keyboard shortcuts for playback controls
- [ ] Responsive timeline for mobile/desktop
- [ ] Performance optimization for large executions
- [ ] Tests: timeline scrubbing accuracy, animation smoothness, event inspector correctness

- [ ] Emit metrics (Prometheus/StatsD): `trace_events_total`, `loki_push_failures_total`, `stream_latency_ms`.
- [ ] Analytics expansion: server‑side events (`posthog-node`), richer client taxonomy, dashboards.
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

- `2025-10-15` – Completed Phase 6 Live Streaming Pipeline (real-time SSE endpoint, frontend EventSource client, UX controls, automated tests, manual validation).
- `2025-10-15` – Completed Phase 5 Loki integration (docker-compose service, worker adapter, backend query endpoint, automated tests).
- `2025-10-15` – Completed Phase 4 worker trace enhancements (level/data propagation, persistence) and initiated Phase 5 Loki integration track.
- `2025-10-14` – Refreshed backend integration suite to shared workflow schema; corrected `PUT /workflows/:id` Zod validation by scoping the pipe to the request body.
- `2025-10-14` – Validated backend contract tests (`bun test` in `backend/`) with Docker stack + pm2-managed runtime; documented environment runbook updates.
- `2025-10-14` – Added workflow run metadata + trace level/data persistence; Phase 2 backend alignment underway.
- `2025-10-13` – Added execution contract spec (`docs/execution-contract.md`) and shared TypeScript schemas via `@shipsec/shared`.
- `2025-10-13` – Added operational runbook and local environment guidance.
- `2025-10-13` – Replaced legacy implementation plan with observability-focused roadmap (this document).

**Next Agent Instructions**

1. Begin with Phase 0 audit and record findings.
2. Notify human reviewer, then proceed sequentially through the phases.
3. Treat each phase as independently reviewable; avoid multi-phase merges in one PR.
4. Maintain exhaustive tests and update this plan after each completed phase.
