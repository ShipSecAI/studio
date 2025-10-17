# Execution & Trace Contract

_Last updated: 2025-10-13_

This document describes the canonical payloads exchanged between ShipSec Studio services and the frontend when observing workflow executions. The goal is to provide a single source of truth for:

- Normalised workflow run status payloads (`GET /workflows/runs/:runId/status`).
- Trace event envelopes (`GET /workflows/runs/:runId/trace`, SSE stream).
- Error handling semantics shared by the backend, worker, and frontend clients.

The TypeScript definitions live in `@shipsec/shared` (`packages/shared/src/execution.ts`) and are expressed using Zod schemas for runtime validation.

---

## Workflow Run Status

```ts
import { WorkflowRunStatusPayload } from '@shipsec/shared';
```

| Field | Type | Description |
|-------|------|-------------|
| `runId` | `string` | Temporal workflow ID (`shipsec-run-*`). |
| `workflowId` | `string` | ShipSec workflow record ID. |
| `status` | `'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TERMINATED' | 'TIMED_OUT'` | Normalised Temporal status. `QUEUED` is emitted once the run request is accepted but Temporal has not started the workflow yet. |
| `startedAt` | ISO timestamp | First observation of the workflow start. |
| `updatedAt` | ISO timestamp | Time of the latest status refresh. |
| `completedAt` | ISO timestamp (optional) | Present when the run reaches a terminal state. |
| `taskQueue` | `string` | Temporal task queue used for the run. |
| `historyLength` | `number` | Temporal history length as reported by `describeWorkflow`. |
| `progress` | `{ completedActions: number; totalActions: number }` (optional) | Aggregated node progress; populated by backend when the DSL includes action counts. |
| `failure` | `{ reason: string; temporalCode?: string; details?: Record<string, unknown> }` (optional) | Terminal failure summary when `status === 'FAILED'` / `TERMINATED` / `TIMED_OUT`. |

### Backend Responsibilities

- Map Temporal `WorkflowExecutionStatusName` to the status enum.
- Populate `updatedAt` on every response, even if values are unchanged.
- Attach `failure` information using Temporal failure codes and messages.
- Derive `progress` from compiled DSL metadata (total actions) and trace state (completed nodes).

### Frontend Responsibilities

- Use `WorkflowRunStatusSchema` for validation (via `@shipsec/shared`).
- Drive node badges, progress bars, and timeline state directly from the payload without custom parsing.

---

## Trace Event Payload

```ts
import { TraceEventPayload, TraceStreamEnvelope } from '@shipsec/shared';
```

Each event represents a discrete change in node execution state or log output. Events are delivered through two channels:

1. **HTTP polling** – `GET /workflows/runs/:runId/trace` returns `{ runId, events, cursor? }`.
2. **Streaming** – SSE/WebSocket uses the same envelope shape with incremental cursors.

### Event Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable identifier for ordering (e.g., `${sequence}` or ULID). |
| `runId` | `string` | Workflow run identifier. |
| `nodeId` | `string` | DSL action reference (`action.ref`). |
| `type` | `'STARTED' | 'PROGRESS' | 'COMPLETED' | 'FAILED'` | Coarse event type. |
| `level` | `'info' | 'warn' | 'error' | 'debug'` | Severity classification used for UI highlighting. |
| `timestamp` | ISO timestamp | When the event occurred. |
| `message` | `string` (optional) | Human-readable log/progress message. |
| `error` | `{ message: string; stack?: string; code?: string }` (optional) | Error metadata for failed events. |
| `outputSummary` | `Record<string, unknown>` (optional) | Sanitised component outputs captured on completion. |
| `data` | `Record<string, unknown>` (optional) | Arbitrary structured attachments (e.g., `{ stream: 'stdout' }`). |

### Envelope Fields

| Field | Type | Description |
|-------|------|-------------|
| `runId` | `string` | Workflow run identifier. |
| `events` | `TraceEventPayload[]` | Ordered events since the previous cursor. |
| `cursor` | `string` (optional) | Token for the next incremental fetch/stream ACK. |

### Worker Responsibilities

- Emit `level` explicitly when calling `trace.record` (info for normal progress, warn for recoverable issues, error for failures).
- For Docker stdout/stderr streaming, use `data.stream` to differentiate channels (`stdout` vs `stderr`).
- Include `outputSummary` on `COMPLETED` events after trimming or hashing large payloads.

### Backend Responsibilities

- Persist `sequence` numbers and convert them to deterministic `id` values.
- Surface `cursor` tokens for both polling and streaming modes (e.g., base64 encoding of the last sequence number).
- Enforce schema with `TraceEventSchema` before responding.

### Frontend Responsibilities

- Validate with `TraceEventSchema` and append to the execution log store in order.
- Use `level` for badge colour coding and `data.stream` for stdout/stderr styling.
- Store the latest `cursor` and pass it on the next polling/stream ACK request.

---

## Failure Semantics

- **Retryable failures** (network errors, timeouts) should surface as `TraceEvent` with `type='FAILED'`, `level='error'`, but the backend may keep the workflow in `RUNNING` until Temporal exhausts retries.
- **Terminal failures** set `status='FAILED'`, populate `failure.reason`, and emit a final `FAILED` trace event.
- **Cancellations** use `status='CANCELLED'` with a `TRACE` event containing `level='warn'` and `message='Run cancelled by user'`.

---

## Versioning

The contract is versioned alongside the shared package. Consumers should depend on `@shipsec/shared` and avoid duplicating inline enums or schemas. Any breaking change must bump the package minor version and update this document.

