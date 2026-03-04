# Chat Steer + Queue Implementation Plan

**Date**: 2026-03-04
**Branch**: `codex/eng-218-chat-infinite-polling`

## Architecture Overview

```
CURRENT: One runId per message → stale-run hammering

  User sends msg  → Backend creates runId  → startRun(runId)  → signal workflow
  User sends msg2 → Backend creates runId2 → startRun(runId2) → signal workflow
  ↑ Old activity still emitting for runId1 → 124K error logs

NEW: Queue + Steer — workflow owns generation lifecycle

  User sends msg  → Backend: idle? startRun + signal → { runId }
  User sends msg2 → Backend: processing? just signal  → { queued: true }
  User clicks Steer → Backend: POST /interrupt → signal interruptGeneration
  Workflow: cancel activity → persist draft → start next gen
```

## State Machine

```
                    ┌──────────┐
         ┌─────────│   IDLE   │◄──────────────────────┐
         │         └────┬─────┘                        │
         │              │ userMessage signal            │
         │              ▼                               │
         │    ┌────────────────────┐                    │
         │    │   PROCESSING       │                    │
         │    │   generationId: N  │                    │
         │    │   runId: <uuid>    │                    │
         │    └───┬───────────┬────┘                    │
         │        │           │                         │
         │   natural      interrupt                     │
         │   complete      signal                       │
         │        │           │                         │
         │        │           ▼                         │
         │        │  ┌─────────────────┐                │
         │        │  │ INTERRUPTING    │                │
         │        │  │ cancel activity │                │
         │        │  │ flush draft     │                │
         │        │  │ persist state   │                │
         │        │  └───────┬─────────┘                │
         │        │          │                          │
         │        ▼          ▼                          │
         │    ┌──────────────────────┐                  │
         │    │ CHECK PENDING QUEUE  │                  │
         │    │ pending.length > 0?  │                  │
         │    └───┬──────────────┬───┘                  │
         │     yes│              │no                    │
         │        │              └──────────────────────┘
         │        ▼
         │   ┌───────────────────────┐
         └───│ START NEXT GENERATION │
             │ generationId: N+1     │
             │ bundle queued msgs    │
             │ new runId             │
             └───────────────────────┘
```

## Phase 1: Workflow (chat-agent.workflow.ts)

### New signals/queries

- `interruptGenerationSignal = defineSignal('interruptGeneration')`
- `getGenerationIdQuery = defineQuery<number>('getGenerationId')`
- `getPendingCountQuery = defineQuery<number>('getPendingCount')`

### Main loop redesign

- Add monotonic `generationId` counter (starts at 0, increments per generation)
- Add `interruptRequested` flag, set by signal handler
- Wrap `runChatAgentStepActivity` in `CancellationScope.cancellable()`
- Use `condition(() => interruptRequested)` racing with activity completion
- On interrupt: cancel scope → activity gets CancelledFailure → flush partial state
- After any generation (natural or interrupted): check `pendingUserMessages`, auto-start next if non-empty
- Bundle ALL pending messages into one generation turn
- Pass `generationId` to activity input
- Forward `generationId` across `continueAsNew`

### Temporal cancellation model

- `CancellationScope.cancellable()` wraps the activity call
- When interrupted, `scope.cancel()` propagates to activity
- Activity receives cancellation via `Context.current().cancellationSignal`
- Activity catches it, flushes accumulated state, returns partial result with `interrupted: true`

## Phase 2: Activity (chat-agent.activities.ts)

### Changes

1. Add `generationId` to `ChatAgentStepInput` and `ChatAgentStepOutput`
2. Tag all `emitStreamEvent` calls with `generationId`
3. Pass `Context.current().cancellationSignal` to `streamText()` as `abortSignal` — stops LLM immediately on cancel
4. Check `cancellationSignal.aborted` in stream loop — break out, flush accumulated parts
5. On cancellation:
   - Flush partial response via `flushPartialResponse(sessionId, accumulatedParts)`
   - Emit `{ type: 'generation-interrupted', generationId }` event
   - Return partial `ChatAgentStepOutput` with `interrupted: true` + accumulated assistant parts
6. Add `interrupted` boolean to `ChatAgentStepOutput`
7. Handle `CancelledFailure` gracefully — don't let it propagate as unhandled error

### Key: abortSignal → streamText

The AI SDK's `streamText` accepts `abortSignal`. When cancelled, the LLM HTTP request is immediately aborted. No more tokens generated. Tool calls in progress get cancelled too.

## Phase 3: Backend (chat.service.ts + chat.controller.ts + temporal.service.ts)

### sendMessage() — queue-aware

- If `session.processingStatus === 'idle'`: create runId, startRun(), signal workflow → return `{ runId, queued: false }`
- If `session.processingStatus === 'processing'`: DON'T create runId. Save user message to DB. Signal workflow to enqueue. Return `{ queued: true, activeRunId: session.activeRunId }`

### New endpoint: POST /:id/interrupt

- Verify session ownership
- Check session is actually processing
- Signal workflow with `interruptGeneration` signal
- Return `{ success: true }`

### Enhanced /status endpoint (avoid extra API call)

- Add `pendingCount` and `generationId` to response (queried from Temporal workflow)
- Frontend uses these to show queue state and detect generation transitions

### temporal.service.ts additions

- `signalChatInterrupt(sessionId)` — sends `interruptGeneration` signal
- `queryChatGenerationId(sessionId)` — queries current generationId
- `queryChatPendingCount(sessionId)` — queries pending message count

### chat.controller.ts additions

- `POST :id/interrupt` endpoint
- Update `POST :id/messages` response type to include `queued` flag

## Phase 4: Frontend Transport (durable-chat-transport.ts)

### sendMessages() — handle queued response

- If response has `runId`: connect to stream as before (idle → immediate start)
- If response has `queued: true`: return empty/minimal stream. Polling loop handles reconnection when next generation starts.

### New methods

- `interruptGeneration(sessionId)`: POST to `/interrupt`
- Update `SendMessageResponse` type: `{ runId?: string; queued?: boolean; activeRunId?: string }`

## Phase 5: Frontend UI (ChatInterface.tsx + chatStore.ts)

### chatStore.ts

- Add: `queuedMessageCount: number`, `currentGenerationId: number | null`
- Add: `setQueueState(count, genId)`, `clearQueueState()`

### ChatInterface.tsx

- **Steer button**: Appears when `isAgentWorking && queuedMessageCount > 0`. On click: `chatTransport.interruptGeneration(sessionId)`. Placed in StatusBar area.
- **Queue indicator**: Small badge near input "1 queued" when `queuedMessageCount > 0`
- **Polling updates**: `/status` now returns `pendingCount` + `generationId`. Track generation transitions. On `activeRunId` change → reconnect to new stream.
- **Interrupted content**: When `generation-interrupted` event received, show interrupted assistant message with dimmed styling + "interrupted" badge.
- **Send while processing**: Show toast "Message queued", increment local queue count optimistically.

### UX Flow

1. User sends message while agent is working → message appears, "queued" badge shown
2. "Steer now" button appears in status bar
3. User clicks Steer → current generation stops, interrupted content shown dimmed, next generation starts with queued messages
4. If user doesn't steer → current generation finishes naturally, queued messages auto-process next

## Phase 6: Stale-run hardening (defense in depth)

### Backend: 409 for run mismatch

- `appendRunEvent` endpoint: return 409 with `{ error: 'run-mismatch' }` instead of 500

### Activity: fast exit on mismatch

- Add `staleRun` flag — once set, skip ALL further append/emit calls
- If backend returns 409: set `staleRun = true`, log once, stop emitting
- Circuit breaker: 3 consecutive failures (any reason) → stop emitting

### Key: This is independent safety net

Even if queue/steer has edge cases, stale runs can never hammer the backend.

## Execution Order

| Order | Phase                         | Parallel?                  | Depends on |
| ----- | ----------------------------- | -------------------------- | ---------- |
| 1     | Phase 6 (stale-run hardening) | Yes, parallel with Phase 1 | None       |
| 1     | Phase 1 (workflow)            | Yes, parallel with Phase 6 | None       |
| 2     | Phase 2 (activity)            | Sequential                 | Phase 1    |
| 3     | Phase 3 (backend)             | Sequential                 | Phase 1+2  |
| 4     | Phase 4 (transport)           | Sequential                 | Phase 3    |
| 5     | Phase 5 (UI)                  | Sequential                 | Phase 4    |

## Risk Mitigations

| Risk                                       | Mitigation                                                     |
| ------------------------------------------ | -------------------------------------------------------------- |
| Temporal CancellationScope race conditions | Use `condition()` + flag pattern, not raw Promise.race         |
| Activity doesn't stop fast enough          | AbortSignal passed to streamText stops LLM call immediately    |
| Interrupted tool calls leave side effects  | Persist all tool state; next gen sees full context             |
| Queue grows unbounded                      | Workflow bundles ALL pending into next gen; queue drains fully |
| Frontend misses generation transitions     | Polling loop detects activeRunId changes                       |
| Stale run still hammers despite redesign   | Phase 6 is defense-in-depth, always active                     |

## What This Fixes

1. **Stale-run hammering**: Eliminated by design — workflow owns generation lifecycle
2. **Lost context on interrupt**: Interrupted drafts + tool calls persisted and included in next generation
3. **No user control during streaming**: Steer button gives users power to redirect the agent
4. **Multiple rapid messages cause chaos**: Queue absorbs them, bundles into single generation

## Files Changed

| File                                                      | Phase | Change Type      |
| --------------------------------------------------------- | ----- | ---------------- |
| `worker/src/temporal/workflows/chat-agent.workflow.ts`    | 1     | Major refactor   |
| `worker/src/temporal/activities/chat-agent.activities.ts` | 2, 6  | Major refactor   |
| `backend/src/chat/chat.service.ts`                        | 3     | Moderate changes |
| `backend/src/chat/chat.controller.ts`                     | 3     | New endpoints    |
| `backend/src/temporal/temporal.service.ts`                | 3     | New methods      |
| `backend/src/chat/chat-stream-event.repository.ts`        | 6     | Error handling   |
| `frontend/src/lib/durable-chat-transport.ts`              | 4     | Moderate changes |
| `frontend/src/pages/ChatInterface.tsx`                    | 5     | UI additions     |
| `frontend/src/store/chatStore.ts`                         | 5     | Queue state      |

No database schema migrations needed — generationId travels inside event JSON, not as a column.
