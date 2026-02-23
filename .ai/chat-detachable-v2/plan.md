# Detachable Chat Sessions v2 — Plan

Timestamp: 2026-02-23
Branch: `feat/chat-detachable-v2` (from `7c5adc8c`)
Backup of v1: `detachable-sessions-v1-backup`

## Problem

When a user refreshes the browser mid-stream, or opens the same chat in a second
tab, they lose the in-progress AI response. The existing v1 implementation tried
to solve this with Redis Streams, cursor-based replay, lease-based control, and a
full event-sourcing system. It was over-engineered and fragile.

## Design Principles

1. **Postgres is the source of truth** for all messages (completed AND partial).
2. **Redis pub/sub is ephemeral** — used only for real-time push to connected clients.
3. **No new eventing infrastructure** — no Redis Streams, no cursors, no snapshots.
4. **No lease mechanism** — Temporal serializes writes; there's no multi-writer conflict.
5. **Reconnect = read from Postgres + subscribe to pub/sub** — that's it.

## Architecture

```
                    ┌──────────────────────────────┐
                    │       Temporal Worker         │
                    │                               │
                    │  runChatAgentStepActivity      │
                    │   ├─ stream tokens via AI SDK │
                    │   ├─ publish deltas → pub/sub │
                    │   └─ flush partial → backend  │
                    └────────────┬─────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
              ▼                  ▼                   ▼
     Redis pub/sub        Backend API          Postgres
     (ephemeral)      (NestJS service)      (durable store)
     chat:stream:ID                         chat_messages
                                            chat_sessions
                                            chat_partial_responses
```

### Flow: User sends message

1. `POST /chat/sessions/:id/messages` (existing endpoint)
2. Backend saves user message to `chat_messages`
3. Backend signals Temporal workflow
4. Worker starts AI generation:
   - Publishes token deltas to `chat:stream:{sessionId}` via Redis pub/sub
   - Every ~500ms, calls backend API to flush accumulated partial response to
     `chat_partial_responses` table
   - On completion: saves final assistant message to `chat_messages` (via activity),
     deletes partial response row

### Flow: Client connects (fresh load or refresh)

1. Frontend calls `GET /chat/sessions/:id/messages` → gets completed messages
2. Frontend calls `GET /chat/sessions/:id/status` → gets processing state
3. If `status === 'processing'`:
   - Fetch partial response: `GET /chat/sessions/:id/partial`
   - Open SSE stream: `GET /chat/sessions/:id/stream` → subscribes to pub/sub
   - Render partial response text, then continue with live deltas
4. If `status === 'idle'`:
   - Just render messages. Done.

### Flow: Second tab / CLI attach

Same as refresh flow. Each client independently:

1. Reads messages from Postgres
2. Checks status
3. If processing: reads partial + subscribes to pub/sub

Redis pub/sub fans out to all subscribers automatically.

### Flow: CLI attach (NDJSON)

```bash
curl -N -H "x-internal-token: ..." \
  "http://localhost:3211/api/v1/chat/sessions/{id}/stream?format=ndjson"
```

Backend subscribes to pub/sub internally, forwards to HTTP response as NDJSON.

## Database Changes

### New table: `chat_partial_responses`

```sql
CREATE TABLE chat_partial_responses (
  session_id UUID PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  parts      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- One row per active streaming session (at most).
- Upserted by worker during streaming, deleted on completion.
- Parts uses the same `UIMessage.parts` format as `chat_messages`.

### New column on `chat_sessions`

```sql
ALTER TABLE chat_sessions ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'idle';
-- values: 'idle' | 'processing'
```

This is the only state the frontend needs to decide whether to open a stream.

## API Changes

### New endpoints

| Method | Path                         | Purpose                                                 |
| ------ | ---------------------------- | ------------------------------------------------------- |
| `GET`  | `/chat/sessions/:id/status`  | Returns `{ status: 'idle' \| 'processing' }`            |
| `GET`  | `/chat/sessions/:id/partial` | Returns current partial response parts (or 404 if none) |
| `GET`  | `/chat/sessions/:id/stream`  | SSE/NDJSON stream of live deltas from pub/sub           |
| `POST` | `/chat/sessions/:id/partial` | Internal-only: worker flushes partial response          |

### Modified endpoints

| Method | Path                          | Change                                                      |
| ------ | ----------------------------- | ----------------------------------------------------------- |
| `POST` | `/chat/sessions/:id/messages` | Also sets `processing_status = 'processing'` on the session |

### Existing endpoints (unchanged)

- `POST /chat/sessions` — create session
- `GET /chat/sessions` — list sessions
- `GET /chat/sessions/:id` — get session (add processing_status to response)
- `PATCH /chat/sessions/:id` — update title
- `DELETE /chat/sessions/:id` — delete session
- `GET /chat/sessions/:id/messages` — get completed messages

## Worker Changes

### `publishStreamChunk` — keep as-is (pub/sub)

The existing `globalRedis.publish(...)` is exactly what we need. No changes.

### Add periodic partial response flush

During `runChatAgentStepActivity`, after accumulating token deltas:

- Every ~500ms (or every N tokens), POST the accumulated parts to
  `{backendUrl}/api/v1/chat/sessions/{sessionId}/partial`
- On activity completion (success or error):
  - POST final status update to mark session as `idle`
  - Partial response row gets cleaned up

### On error: emit error via pub/sub + set status to idle

Currently on error, the worker publishes `{ type: 'status', status: 'idle' }`.
Keep this, but also ensure the session's `processing_status` is set back to `idle`.

## Frontend Changes

### Replace `DefaultChatTransport` with detachable transport

The current `useChat` + `DefaultChatTransport` from AI SDK works for single-tab
live streaming. For detachable sessions, we need:

1. **On mount / session switch:**
   - `GET /messages` → set `initialMessages`
   - `GET /status` → if processing, enter "attached" mode
   - If attached: `GET /partial` → show accumulated text, then open `/stream` SSE

2. **On send message:**
   - `POST /messages` → triggers streaming as before
   - Subscribe to pub/sub stream SSE for live updates
   - AI SDK `useChat` still handles protocol parsing (we keep the existing SSE format)

3. **On refresh:**
   - Same as "on mount" — reads from Postgres, attaches if processing

### Key insight: keep `useChat` for the live streaming path

When the user sends a message in the active tab, the existing
`DefaultChatTransport` + `useChat` flow works perfectly. We only add the
"reconnect" behavior for:

- Page refresh while streaming
- Second tab opening
- CLI attach

This means the frontend change is **additive**, not a rewrite.

## Implementation Commits

### Commit 1: Schema + partial response repo

Files:

- `backend/drizzle/0027_add-chat-partial-responses.sql`
- `backend/src/database/schema/chat-partial-responses.ts`
- `backend/src/database/schema/chat-sessions.ts` (add processing_status column)
- `backend/src/database/schema/index.ts`
- `backend/src/chat/chat-partial.repository.ts`

### Commit 2: Backend status + partial + stream endpoints

Files:

- `backend/src/chat/chat.controller.ts` (add GET status, GET partial, GET stream, POST partial)
- `backend/src/chat/chat.service.ts` (add status/partial/stream methods)
- `backend/src/chat/chat.module.ts`
- `backend/src/chat/dto/chat-session.dto.ts` (add stream query DTO)

What this does:

- `GET /status` → reads `processing_status` from session
- `GET /partial` → reads from `chat_partial_responses`
- `GET /stream` → subscribes to Redis pub/sub, forwards as SSE/NDJSON
- `POST /partial` (internal) → upserts partial response
- `POST /messages` → also sets processing_status = 'processing'

### Commit 3: Worker partial flush + status lifecycle

Files:

- `worker/src/temporal/activities/chat-agent.activities.ts`

What this does:

- Add `flushPartialResponse(sessionId, parts)` helper that POSTs to backend
- In `runChatAgentStepActivity`: accumulate parts, flush every 500ms
- On completion: POST status=idle to backend, which clears partial response
- On error: same — POST status=idle

### Commit 4: Frontend reconnect behavior

Files:

- `frontend/src/pages/ChatInterface.tsx`
- `frontend/src/hooks/useChatReconnect.ts` (new hook)

What this does:

- Add `useChatReconnect` hook that:
  - On mount: checks `/status`
  - If processing: fetches `/partial`, opens `/stream` SSE
  - Merges partial response + live deltas into message display
- Keep `useChat` for the active send path (unchanged)
- Handle the transition: when reconnected stream completes, merge into normal state

### Commit 5: E2E tests

Files:

- `e2e-tests/core/chat-detachable.test.ts`

Test matrix:

1. **Happy path**: send message → verify stream completes → messages persisted
2. **Partial flush**: send message → wait 1s → check `/partial` has content
3. **Reconnect**: send message → disconnect → reconnect → verify partial + resume
4. **Multi-client**: two clients both reading `/stream` → both see same events
5. **Completion cleanup**: after stream completes → `/partial` returns 404, status=idle
6. **Error path**: missing AI config → error event → status returns to idle

### Commit 6: OpenAPI regeneration

Files:

- `openapi.json`
- `packages/backend-client/src/client.ts`

## What We're NOT Building

- ❌ Redis Streams / event log
- ❌ Cursor-based replay
- ❌ Lease mechanism (acquire/renew/release)
- ❌ Snapshot fallback
- ❌ Command/Events CQRS pattern
- ❌ Event taxonomy (12 types)
- ❌ Frontend transport state in sessionStorage
- ❌ Compatibility adapters

## Estimated Complexity

| Area               | Lines changed (approx) | Difficulty     |
| ------------------ | ---------------------- | -------------- |
| Schema + repo      | ~60                    | Low            |
| Backend endpoints  | ~150                   | Medium         |
| Worker flush       | ~50                    | Low            |
| Frontend reconnect | ~100                   | Medium         |
| E2E tests          | ~150                   | Medium         |
| Total              | ~510                   | vs ~2000 in v1 |

## Risk Mitigations

1. **Pub/sub miss on reconnect**: Subscribe-then-read pattern ensures no gap.
   Frontend subscribes to SSE first, then reads partial from Postgres, then
   deduplicates/merges.

2. **Partial flush timing**: 500ms is conservative. If worker crashes between
   flushes, we lose at most 500ms of text. On reconnect the user sees slightly
   stale partial, then live stream catches up. Invisible to the user.

3. **Redis pub/sub down**: Live streaming is degraded but not fatal. Partial
   responses in Postgres still work. User can poll `/partial` as fallback.
   Completed messages are always in Postgres regardless.

4. **Stale partial response**: If worker crashes without cleanup, the partial
   response row persists. Backend should check: if `processing_status` is `idle`
   AND partial response exists, delete it (lazy cleanup).
