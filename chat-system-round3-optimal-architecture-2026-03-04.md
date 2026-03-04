# Chat System Round 3: Root Reasoning + Optimal Architecture

Date: 2026-03-04

## Goal Constraints

1. Keep AI SDK UI message stream semantics (`UIMessageChunk`) end-to-end.
2. No backward compatibility constraints for current chat APIs/data model.
3. Top priority: robust N-client attachment (multiple tabs + CLI) with deterministic replay.
4. Support stop + steer without losing durability.

## AI SDK Constraints That Matter

From local AI SDK docs/types (`ai@6.0.67`):

- `useChat` stream resumption (`resume: true`) is explicitly incompatible with abort/stop behavior.
  - `docs/09-troubleshooting/15-abort-breaks-resumable-streams.mdx`
  - `docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx`
- Multiple clients can attach to the same active stream.
  - `docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx`
- `UIMessageChunk` supports standard chunk types plus custom `data-*` parts for app metadata.
  - `dist/index.d.ts` (`UIMessageChunk`, `DataUIMessageChunk`)

Implication: for stop/steer-heavy product semantics, do NOT rely on built-in `resume: true`; use custom reconnect over durable stream cursors while preserving `UIMessageChunk` protocol.

---

## A) Root Reasoning Per Shortcoming

### 1) Stop event not durable after refresh

- Symptom: user stops generation, refreshes, stop marker is gone.
- Root reason:
  - Stop/interruption is treated as live stream behavior, not as first-class durable transcript state.
  - Durable chat view is rebuilt mainly from `chat_messages`, not from a canonical turn lifecycle log.

### 2) Interim tool cards/progress disappear after stop/refresh

- Symptom: tool calls visible while streaming are partially/fully missing after reload.
- Root reason:
  - In-flight tool states are emitted as stream events, but durable storage path is split and lossy.
  - There is no guaranteed per-turn persisted projection of latest assistant draft + tool state.

### 3) Steer does not show “which message is being steered to”

- Symptom: user sees queue count, not queue identity or target.
- Root reason:
  - Queue is modeled as count (`pendingCount`) + workflow internals, not first-class queue items.
  - No persisted queue-item entity exposed to UI/CLI.

### 4) Steered message timing appears wrong

- Symptom: execution appears to use original submit ordering/timestamps.
- Root reason:
  - Message persistence happens at submit time only.
  - No explicit `started_execution_at` / `ended_at` per turn.

### 5) Refresh path differs from live stream path

- Symptom: “I saw it live; refresh shows something else.”
- Root reason:
  - Three separate storage surfaces (`chat_messages`, `chat_stream_events`, `chat_partial_responses`) with no single canonical source.
  - Rehydration mixes these unevenly, so replay is not deterministic.

### 6) Multi-client attach is fragile under interruptions and queue transitions

- Symptom: different tabs can drift in what they render.
- Root reason:
  - Attach protocol is run/status oriented but not backed by first-class turn/event cursors.
  - Cursor semantics are partial and tied to current run logic rather than a universal append-only stream contract.

### 7) Frontend complexity and race handling are too high

- Symptom: difficult-to-debug edge cases in polling/reconnect/stream ownership.
- Root reason:
  - Chat page owns too many responsibilities at once (transport, queue UX, recovery, timers, rendering).
  - System architecture complexity leaks into UI code.

---

## B) Real Optimal Solution (No Backward Compatibility)

## 1) Canonical Model: Turn-Centric + Event-Sourced

Make one durable source of truth for runtime state:

### Core tables

1. `chat_turns`

- `id`
- `session_id`
- `user_message_id`
- `status` (`queued | running | completed | interrupted | failed | cancelled`)
- `reason` (nullable, e.g. `user_stop`, `steer`, `error`)
- `queued_at`
- `started_at`
- `ended_at`
- `queue_priority` (optional)
- `position_snapshot` (optional)

2. `chat_turn_events` (append-only)

- `id` (monotonic)
- `session_id`
- `turn_id`
- `seq` (global per-session cursor)
- `turn_seq` (per-turn cursor)
- `chunk` (`UIMessageChunk` JSONB)
- `created_at`

3. `chat_turn_drafts` (materialized projection)

- `turn_id` PK
- `assistant_message_snapshot` (`UIMessage` JSONB)
- `last_seq`
- `updated_at`

4. `chat_messages` (committed transcript projection)

- user + completed/interrupted assistant messages
- keeps display portability and fast initial load

Replace session-scoped `partial` with turn-scoped drafts.

## 2) Streaming Contract

### Always stream/persist AI SDK chunks

- Worker emits `UIMessageChunk` via `toUIMessageStream`.
- Backend appends each chunk to `chat_turn_events` first (transactional with seq allocation), then publishes to pub/sub.
- SSE endpoint replays by cursor then tails live pub/sub.

This guarantees:

- late joiner determinism,
- multi-tab consistency,
- CLI parity.

## 3) Queue + Steer as First-Class API

### API (new)

1. `POST /chat/sessions/:id/turns`

- creates user message + `chat_turn(status=queued)`.

2. `POST /chat/sessions/:id/steer`

- body: `{ targetTurnId?: string }`
- marks steer intent + signals interrupt for active turn.
- scheduler picks target turn next (or FIFO if omitted).

3. `POST /chat/sessions/:id/interrupt`

- explicit stop; sets reason and interrupts active turn.

4. `GET /chat/sessions/:id/state`

- returns `activeTurn`, full queue list (ids, previews, queuedAt, startedAt, status), last cursor.

5. `GET /chat/sessions/:id/turns/:turnId/stream?afterSeq=...`

- deterministic replay + live tail for that turn.

6. `GET /chat/sessions/:id/events?afterSeq=...` (optional global observer stream)

- useful for CLI and diagnostics.

## 4) Execution Loop Semantics

Workflow/scheduler logic:

1. dequeue next turn (respect steer target if present)
2. mark `running` + `started_at`
3. stream chunks; append events + update draft projection
4. on interrupt:

- append `abort` or `data-turn-status(interrupted)` chunk,
- finalize assistant message from latest draft,
- mark turn `interrupted` + `ended_at`

5. on completion:

- append `finish` chunk,
- finalize assistant message,
- mark turn `completed` + `ended_at`

Never rely on volatile in-memory state as transcript truth.

## 5) Client Model (N-clients first)

### UI + CLI flow

1. Load `GET state` + committed messages + current draft(s).
2. If active turn exists, attach with `afterSeq` cursor.
3. Consume chunks with `readUIMessageStream`.
4. On reconnect, replay from cursor and continue.

### Important AI SDK alignment choice

- Use `useChat` with custom transport and `resume: false`.
- Handle reconnection via your own cursor-based attach (because abort + resume conflict is documented).

## 6) Timing + UX Correctness

Display both timestamps:

- `queued_at` (user intent time)
- `started_at` (execution start time)

For steered turns:

- show explicit badge: `Steered` + `Started at ...`
- avoid silently implying execution started at submit time.

## 7) Minimal Metadata Needed in Stream

Stay in AI SDK semantics:

- use standard chunks for text/tool.
- use `data-turn-status` chunk for app lifecycle markers (queued/running/interrupted/completed).

No custom protocol fork required.

---

## C) Why this is optimal

1. Single canonical truth for replay (append-only event log).
2. Multi-client attachment becomes deterministic cursor math.
3. Stop + steer become explicit turn-state transitions, not side effects.
4. AI SDK compatibility is preserved (UIMessageChunk + readUIMessageStream).
5. Frontend complexity drops: less polling gymnastics, clearer turn-state rendering.

---

## D) What to delete/simplify from current shape

1. Session-scoped partial response as primary reconnect mechanism.
2. Queue-as-count-only model.
3. Run-centric lifecycle that hides turn-level intent/state.
4. `resume: true` reliance when abort/steer is required.
5. Ambiguous stop/steer UI without queue item identity.

---

## E) Immediate implementation order (safe and direct)

1. Introduce `chat_turns` + `chat_turn_events` + `chat_turn_drafts` schema.
2. Write projector: events -> drafts/messages/turn status.
3. Replace queue API to return queue items, not just count.
4. Switch frontend to cursor + turn attach; render queue identities.
5. Add explicit steer target selection and badges.
6. Remove `resume: true` path and unify reconnect behavior.
