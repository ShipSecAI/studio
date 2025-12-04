# Execution Telemetry Streams

This doc captures the target architecture for ShipSec Studio’s execution telemetry. We’re standardizing around three orthogonal channels:

1. **Event System** – lifecycle signals that drive the timeline.
2. **Log System** – leveled diagnostics (info/warn/error/etc) destined for Loki.
3. **Custom Streams** – use-case specific data (Terminal PTY, AI agent streams, etc.).

Each channel has a distinct purpose, storage backend, and playback path.

---

## 1. Event System (Lifecycle)

**Purpose:** represent deterministic progress through a node’s lifecycle so the timeline can show start/progress/stop status.

- **Producers:** components use `context.emitEvent` (or a stricter helper) to emit `NODE_STARTED`, `NODE_PROGRESS`, `NODE_COMPLETED`, `NODE_FAILED`, etc.
- **Storage:** authoritative `workflow_traces` table in Postgres (one row per event with timestamps + metadata).
- **Consumption:** execution timeline + scrubber; event inspector; progress badges. No logs/tool chatter here.
- **Scope:** only lifecycle information (start, retries, progress percentages, completion status). Everything else belongs in logs or custom streams.

_Goal: keep the event track clean and deterministic so timeline scrubbing stays accurate._

---

## 2. Log System (Diagnostics)

**Purpose:** free-form operational logs with levels (`error`, `warn`, `info`, `debug`, `trace`) for humans to read / search.

- **Producers:** components call `context.logger.<level>()`. Logs never become timeline events automatically.
- **Storage:** Loki (via Promtail/docker stdout). Optionally buffer recent entries for on-screen live rendering, but Loki is the source of truth.
- **Consumption:** UI logs panel pulls from a log service (REST/SSE) that queries Loki; backend also uses Loki for ops troubleshooting.
- **Timeline integration:** logs can be replayed in sync with the scrubber by aligning timestamps, but they are not the same as lifecycle events.

_Goal: decouple “what happened” (events) from “what was printed” (logs), and make log search/replay first-class via Loki._

---

## 3. Custom Streams (Use-Case Specific)

Some components emit high-volume, structured data that doesn’t belong in generic events or logs. Each gets its own stream channel.

### 3.1 Terminal / PTY Stream
- **Source:** Docker runner PTY output (stdout/stderr).
- **Transport:** Redis Streams (`terminal:<runId>:<nodeRef>:stdout|stderr`).
- **Live consumption:** backend tail-follow reads Redis and pushes SSE/WebSocket to the frontend terminal panel.
- **Replay:** timeline replay pulls stored chunks (or archived `.cast` files) from Redis/S3 and replays via the same panel.
- **Retention:** Redis TTL + optional `.cast` file uploaded via Files service for long-term storage.

### 3.2 AI Agent Stream
- **Source:** `core.ai.agent` emits packets conforming to the official AI SDK stream protocol (`response.*`, `tool-call.*`, etc.).
- **Transport:** Redis Streams (`agent:<runId>:<nodeRef>`). Worker pushes each SDK packet into Redis (in addition to minimal trace metadata).
- **Live consumption:** backend `/api/v1/agents/:runId/stream` tail-follows Redis and forwards packets verbatim (plus `[DONE]`) so the frontend can mount `@ai-sdk/ui` components.
- **Replay:** timeline scrubbing reads the stored stream from Redis/S3 and replays the packets through the same parser/UI.
- **Protocol:** strictly use the AI SDK data stream spec so we can adopt the official components without translation.

_Other streams (e.g., artifact uploads, custom analyzers) can follow the same pattern: dedicated Redis channel + SSE + replay export._

---

## Frontend Timeline Integration

The execution inspector shows all three channels in sync:

- **Events track:** drives the timeline scrubber, node status, progress percentages.
- **Logs track:** leveled log panel (fetches from Loki) with timestamp alignment to the scrubber.
- **Stream panels:** PTY terminal, AI agent reasoning trace, etc.—each subscribes to its respective channel for live data and replays the archived stream when scrubbing.

Scrubbing the timeline sets a “current time” that all channels respect:

1. Events: highlight current lifecycle status.
2. Logs: show log entries up to the scrub point.
3. Streams: replay packets up to the scrub point (terminal text, agent tool calls, etc.).

---

## Summary / Next Steps

- **Separate concerns:** lifecycle events → Postgres; logs → Loki; custom streams → Redis (with archival as needed).
- **Adopt official protocols:** AI agent stream must emit the AI SDK data stream packets so we can drop in the SDK’s UI components.
- **Auto-selection:** ensure the inspector auto-focuses on the active run so all streams connect immediately.
- **Replay parity:** treat agent streams like terminal streams—store packets, export if needed, and replay via the same code path as live streaming.

By keeping these channels distinct, we preserve clarity (no duplicate events/logs) and gain reliable live + replay experiences for every stream.
