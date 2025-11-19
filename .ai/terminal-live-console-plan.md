# Terminal Live Console Streaming – Phase Plan

Goal: deliver low-latency, PTY-accurate Docker console streaming with archival replay. This plan breaks the work into focused phases so we can ship incrementally without disrupting existing JSON parsers or Loki logging.

## Phase 1 – SDK + Worker PTY Capture (Foundations) ✅ *Completed*

**Objectives**
- Introduce a `terminalCollector` surface in `@shipsec/component-sdk` without changing existing logger/logCollector semantics.
- Add a PTY-aware Docker runner that can emit raw byte chunks alongside the current line-buffered outputs, but gate it behind feature flags so components keep working.
- Define the canonical chunk payload (`runId`, `nodeRef`, `stream`, `chunkIndex`, `payload(base64)`, `recordedAt`, `deltaMs`, `origin`, `runnerKind`).

**Tasks**
1. Extend SDK types (`TerminalChunkInput`) and `createExecutionContext` to accept an optional `terminalCollector`.
2. Update `runComponentWithRunner` to support dual mode:
   - Default: current `spawn` behaviour for stability.
   - PTY mode: use `node-pty`, copy raw data into chunks, still route flushed lines through `logCollector` so Loki remains populated.
3. Add worker configuration (env / feature flag) to toggle PTY emission per component or per run.
4. Unit tests for chunk metadata ordering, base64 encoding, and backwards compatibility with existing logger/logCollector flows.

**Exit Criteria**
- Worker can emit terminal chunks to an in-memory collector with deterministic chunk indices.
- Components continue to receive parseable stdout/stderr in legacy mode.

## Phase 2 – Redis Hot Path Transport ✅ *Completed*

**Objectives**
- Stream terminal chunks through Redis Streams for low-latency fan-out and resumable cursors.
- Introduce a worker-side terminal adapter that pushes chunks to Redis and publishes EOF markers per node.

**Tasks**
1. Add `ioredis` dependency to worker + backend; create a connection factory honoring env vars (`REDIS_URL`, TLS, auth).
2. Implement `RedisTerminalStreamAdapter` in the worker:
   - Key shape: `terminal:{runId}:{nodeRef}:{stream}`.
   - Payload: packed chunk JSON (payload base64, metadata).
   - Enforce length limits with `XTRIM` or `MAXLEN ~`.
3. Extend `run-component.activity` to pass a `terminalCollector` that forwards to Redis adapter whenever PTY mode is on.
4. Add monitoring/logging for write failures and backpressure handling (pause PTY if Redis is unavailable or queue > threshold).
5. Integration test using Redis docker container verifying stream write + resume semantics.

**Exit Criteria**
- Live Docker nodes push chunks into Redis Streams with monotonic IDs.
- Worker detects write failures and downgrades gracefully (logs warning + disables PTY).

## Phase 3 – Backend Live Fan-Out + Cursor API ✅ *Completed*

**Objectives**
- Consume Redis Streams from the backend and expose chunks via SSE/WebSocket alongside existing trace events.
- Provide API contracts for clients to request historical chunks (`afterChunk`, `limit`).

**Tasks**
1. Implement a NestJS provider that runs a Redis consumer group per run/node, pulling chunks and rebroadcasting them to connected clients.
2. Extend `/workflows/runs/:runId/stream` to emit a new `terminal` event type (`{ nodeRef, stream, chunkIndex, payload, recordedAt }`). Include cursors so clients can resume (`cursor=chunkIndex` maps to Redis IDs).
3. Add `GET /workflows/runs/:runId/terminal/:nodeRef` endpoint returning paginated chunks (pulling from Redis if available; fallback to archive when added).
4. Update authentication/authorization guards so Redis-derived events respect org scoping.
5. Document SSE contract in `docs/execution-contract.md`.

**Exit Criteria**
- Backend streams PTY chunks with <150 ms latency in dev stack.
- API consumers can request historical chunks via REST without touching Redis directly.

## Phase 4 – Cast File Archival & Indexing

**Objectives**
- Persist per-node replay files (cast-like JSON) to object storage (MinIO/S3) while runs execute.
- Maintain an index table in Postgres linking `runId + nodeRef + stream` to the stored file, duration, and chunk count.

**Tasks**
1. Design cast file schema (header + `[deltaSeconds, stream, base64Payload]` entries). Support partial flushes so we can stream to storage as chunks arrive.
2. Create `workflow_terminal_records` table storing `run_id`, `node_ref`, `stream`, `file_url`, `chunk_count`, `duration_secs`, `first_chunk_index`, `last_chunk_index`, `created_at`, `completed_at`.
3. Implement a backend or worker-side archival service:
   - Subscribes to Redis streams.
   - Appends chunks to the cast file (either via streaming upload or local temp file + upload).
   - Updates index rows incrementally.
   - Handles finalization (write metadata + EOF marker when node completes).
4. Provide retention hooks (configurable TTL for Redis stream trimming once archival is confirmed).
5. Integration test verifying that a completed run produces a downloadable cast file with accurate timeline.

**Exit Criteria**
- Each docker-backed node yields a downloadable replay file stored in MinIO/S3.
- Redis streams are trimmed once archival confirms persistence.

## Phase 5 – Frontend Terminal Player (Live + Replay)

**Objectives**
- Introduce an `xterm.js`-based terminal panel that consumes the new SSE events and can replay cast files.

**Tasks**
1. Build a React hook (`useTerminalStream`) that hydrates historical chunks (REST) then subscribes to SSE/WebSocket for live frames. Manage chunk cursors and reconnect logic.
2. Integrate `xterm.js` into the run inspector or timeline UI with tabs per docker node (stderr highlighting, pause/autoscroll, copy/download buttons).
3. Add a replay mode that fetches the cast file and plays it locally; allow jumping to timestamps and exporting `.cast`.
4. Telemetry: log when users view terminal, download cast, or encounter gaps.
5. Frontend tests (Vitest + Playwright) covering hydration, live streaming, and replay switching.

**Exit Criteria**
- Users can watch live docker output with colour/TTY fidelity and replay completed nodes from stored files.
- UI gracefully handles reconnects and cross-node navigation.

## Phase 6 – Hardening & Observability

**Objectives**
- Ensure the pipeline is resilient, observable, and easy to operate in prod.

**Tasks**
1. Metrics & alerts: capture PTY chunk throughput, Redis lag, archival backlog, SSE latency.
2. Backpressure strategies: configurable thresholds that pause PTY or spill to file when Redis/MinIO is slow.
3. Security review: ensure Redis credentials are scoped, cast files inherit run-level ACLs, and downloads respect org authorization.
4. Documentation updates (`.ai/temporal-worker-architecture.md`, `.ai/component-sdk.md`, `docs/execution-contract.md`) describing the new terminal pipeline and troubleshooting steps.

**Exit Criteria**
- Dashboard and alerts cover each stage (worker capture, Redis, backend fan-out, archival).
- Runbooks describe failure modes and recovery (Redis outage, archival lag, SSE congestion).

---

This plan prioritizes preserving current behaviour while layering in the new PTY experience. Each phase ends with reviewable deliverables, so we can pause after any stage if priorities shift. Let me know if you want to tweak scope or reorder phases before implementation.
