# Execution & Trace Contract

_Last updated: 2024-07-06_

This document describes the canonical payloads exchanged between ShipSec Studio services and the frontend when observing workflow executions. The goal is to provide a single source of truth for:

- Normalised workflow run status payloads (`GET /workflows/runs/:runId/status`).
- Trace event envelopes (`GET /workflows/runs/:runId/trace`, SSE stream).
- Error handling semantics shared by the backend, worker, and frontend clients.

The TypeScript definitions live in `@shipsec/shared` (`packages/shared/src/execution.ts`) and are expressed using Zod schemas for runtime validation.

---

## Component Port Metadata (v2)

Workflow components advertise their inputs and outputs using structured port descriptors. Each port now carries a `dataType` object instead of the legacy string enum (`"string" | "array" | ...`). The backend forwards the metadata unmodified, and the frontend consumes it to validate edge connections and render configuration hints.

### Port Shapes

```ts
type PrimitivePort = {
  kind: 'primitive';
  name: 'text' | 'secret' | 'number' | 'boolean' | 'file' | 'json';
  coercion?: { from?: Array<'text' | 'number' | 'boolean' | 'json'> };
};

type ContractPort = {
  kind: 'contract';
  name: string; // e.g. 'core.webhook.result.v1'
};

type ListPort = {
  kind: 'list';
  element: PrimitivePort | ContractPort;
};

type MapPort = {
  kind: 'map';
  value: PrimitivePort;
};

type PortDataType = PrimitivePort | ContractPort | ListPort | MapPort;
```

- **Primitive ports** map to scalar value kinds. Optional `coercion.from` lists primitive types that may be converted at runtime (e.g., numbers → text).
- **List ports** represent homogeneous arrays. Elements may be primitive or contract references.
- **Map ports** represent string-keyed dictionaries with primitive values.
- **Contract ports** point to a named schema registered via the component SDK. Workers must register contracts with `registerContract({ name, schema })` before exposing them in metadata.

### Compatibility Rules

- Primitive → primitive connections require matching `name` unless the target declares a coercion for the source type.
- List → list compatibility compares the element descriptors recursively.
- Map connections require both sides to be `kind: 'map'` with compatible primitive values.
- Contract connections require identical `name` values.

The frontend uses these rules to block invalid edges, while the worker enforces them when resolving inputs before invoking the component. Outputs are parsed with the component's `outputSchema` to ensure the declared contract is respected.

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

## Workflow Version Metadata

Workflow definitions are immutable per save. The backend snapshots each edit into `workflow_versions` and attaches version metadata to run handles so replays always target the correct graph.

- `POST /workflows/:id/run` now returns the version identifier used for execution (`workflowVersionId`, `workflowVersion`).
- `GET /workflows/runs` exposes the same fields for every timeline entry, alongside existing metrics.
- Workflow CRUD responses include `currentVersionId` and `currentVersion` so the UI can surface which revision is active.

| Field | Type | Description |
|-------|------|-------------|
| `currentVersionId` | `string \| null` | Latest immutable revision for the workflow record. Present on workflow CRUD responses. |
| `currentVersion` | `number \| null` | Monotonic version number (`1..n`) for the latest revision. |
| `workflowVersionId` | `string` | Version snapshot executed by a run (handle + timeline entries). |
| `workflowVersion` | `number` | Sequential version number executed by a run. |

Consumers should treat these values as immutable references—selecting an older version and invoking `POST /workflows/:id/run` with `version` or `versionId` forces a replay against that snapshot.

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
