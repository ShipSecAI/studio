# Chat System: Shortcomings and Over-Engineering Audit (2026-03-04)

## Scope

This document captures:

1. The user-facing behavior gaps (how chat SHOULD behave vs how it behaves now).
2. High-confidence over-engineering hotspots found in the current codebase, with evidence paths.

---

## 1) SHOULD vs DOES (User-Centered)

| Area                      | SHOULD                                                                                                        | DOES NOW                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript durability     | Refresh should reconstruct exactly what user saw: streamed text, tool states, stop markers, steer transitions | Refresh mostly rebuilds from `chat_messages`; live stream-only events are not fully materialized into durable transcript entries          |
| Stop/interrupt visibility | Interrupt should create durable transcript event/part showing where generation stopped                        | `generation-interrupted` is emitted in stream path but not represented as a durable chat message entry users can always see after refresh |
| Interim tool persistence  | Tool-progress and in-flight tool state should survive refresh                                                 | In-flight/interim tool state can be dropped, especially around interruption timing                                                        |
| Queue transparency        | User should see queued message content/order/status (not just count)                                          | UI only exposes `pendingCount`; no queued item identity/preview/state                                                                     |
| Steer clarity             | Steer should target a specific queued message and show that target in UI                                      | Steer is effectively "interrupt now, then continue FIFO" with no explicit selected target                                                 |
| Turn timing correctness   | UI should distinguish `queued_at` vs `started_execution_at`                                                   | Messages are saved on submit, so timeline reflects submit time, not actual execution start after steer                                    |
| Per-turn lifecycle model  | Each turn should have durable states: queued -> running -> interrupted/completed                              | No first-class per-turn durable state model; behavior is inferred from mixed stores                                                       |

---

## 2) Why users feel this is broken

1. They watch tool cards/progress live, click stop, refresh, and some of that state disappears.
2. They cannot tell what exactly is in queue; they only see a number.
3. "Steer" feels ambiguous because no target message is shown.
4. Message ordering/timing can look wrong because submit time is treated as execution timeline.
5. Live path and refresh path are effectively different truth sources.

---

## 3) Concrete shortcoming roots (evidence)

### 3.1 Split persistence model for one UX surface

- Durable transcript source: `chat_messages` (`backend/src/database/schema/chat-messages.ts`)
- Live event source: `chat_stream_events` (`backend/src/database/schema/chat-stream-events.ts`)
- In-flight snapshot source: `chat_partial_responses` (`backend/src/database/schema/chat-partial-responses.ts`)
- These three are not unified into a single durable, replayable turn timeline.

### 3.2 Queue/steer metadata is under-modeled

- Status API only returns `pendingCount`, `generationId`, `activeRunId` (no queued message identities):
  - `backend/src/chat/chat.service.ts`
  - `frontend/src/lib/durable-chat-transport.ts`
  - `frontend/src/store/chatStore.ts`
- UI therefore cannot show "what message you are steering to".

### 3.3 Interrupt path durability holes

- Interrupt signal entrypoint exists (`POST /interrupt`) but transcript materialization is limited:
  - `backend/src/chat/chat.controller.ts`
  - `backend/src/chat/chat.service.ts`
  - `worker/src/temporal/activities/chat-agent.activities.ts`
  - `worker/src/temporal/workflows/chat-agent.workflow.ts`
- Interim tool progression and explicit stop marker are not first-class durable transcript rows.

### 3.4 Timestamp semantics mismatch

- User message persisted immediately on submit (`saveMessage`) before execution:
  - `backend/src/chat/chat.service.ts`
  - `backend/src/chat/chat-session.repository.ts`
- No explicit `started_execution_at` / `completed_at` per user turn.

---

## 4) Over-Engineered Hotspots (High Confidence)

These are areas where complexity appears to exceed current product value and creates fragility.

### OE-1: One feature, three state stores, no canonical event model

- Chat uses `chat_messages` + `chat_stream_events` + `chat_partial_responses` for one UX timeline.
- This is the core source of refresh mismatch and stop/interim loss.
- Evidence: schema files above + `backend/src/chat/chat.service.ts` + `worker/src/temporal/activities/chat-agent.activities.ts`.

### OE-2: Frontend has multiple concurrent recovery/stream paths

- `useChat` stream + passive reconnect + status polling + staleness watchdog + local state refs.
- High synchronization complexity in one component (`frontend/src/pages/ChatInterface.tsx`, 1300+ lines).

### OE-3: Chat page is a god component

- `frontend/src/pages/ChatInterface.tsx` handles transport, queue semantics, polling, reconnects, timers, rendering, input UX, side panels.
- Too many responsibilities in one file increases regression risk.

### OE-4: Backend chat service is also a god service

- Session CRUD + signaling + run lifecycle + stream protocol translation + replay + live pub/sub in one class:
  - `backend/src/chat/chat.service.ts`.

### OE-5: Worker chat activity is doing too much in one place

- LLM orchestration, MCP client lifecycle, tool dedupe, task polling bridge, compaction, stream emission, partial flush, run completion hooks:
  - `worker/src/temporal/activities/chat-agent.activities.ts` (1100+ lines).

### OE-6: Multiple throttling layers on the same UX path

- Transport-level delta batching + UI-level text throttling + browser layout throttling ideas previously layered.
- This is exactly how stream rendering starvation happened.
- Evidence: `frontend/src/lib/durable-chat-transport.ts`, `frontend/src/pages/ChatInterface.tsx`.

### OE-7: Heavy reliance on best-effort `catch {}` / swallow patterns

- Errors are frequently hidden to keep flow alive, but this obscures correctness and durability guarantees.
- Evidence: repeated `catch {}` in chat backend/frontend/worker paths.

### OE-8: Queue semantics are encoded via run IDs, not a real queue model

- Run IDs are overloaded as stream routing and queue routing identity.
- No durable queue entity (item id, payload preview, status, timestamps).
- Evidence: `chat.service.ts`, `chat-agent.workflow.ts`, `chat-session` schema.

### OE-9: Data-contract drift between live stream protocol and durable message schema

- Stream emits rich event types (`tool-progress`, `generation-interrupted`, status transitions), but durable transcript schema is only `role + parts` messages.
- Lossy translation path.

### OE-10: File-level complexity is very high across core areas

- Extremely large files in key domains (UI pages/services/workflows) indicate missing modular boundaries.
- Sample line-count hotspots from this repo:
  - `frontend/src/pages/ChatInterface.tsx` (~1333)
  - `backend/src/workflows/workflows.service.ts` (~2076)
  - `worker/src/temporal/activities/chat-agent.activities.ts` (~1122)
  - `worker/src/temporal/workflows/index.ts` (~1215)
  - `frontend/src/pages/GitHubPage.tsx` (~3103)

---

## 5) Practical target behavior contract (what to build toward)

1. A single canonical turn timeline model (durable) that can replay full UX state after refresh.
2. First-class queue items with IDs, text preview, and lifecycle timestamps.
3. Explicit steer target semantics in API + UI.
4. Durable interrupt/stop markers attached to affected turn(s).
5. Unified refresh path that rehydrates from canonical timeline, not mixed ad-hoc sources.

---

## 6) Blunt bottom line

Current chat architecture is feature-rich but coherence-poor: too many moving parts for one user surface, without a single source of truth for transcript state. The result is exactly what users report: "I saw it live, refreshed, and it vanished."
