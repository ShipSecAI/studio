# Chat V2 Turn Timeline - Finalized Execution Architecture

Last Updated: 2026-03-04T12:53:42Z  
Branch: `codex/eng-218-chat-infinite-polling`

## Goal

Ship Chat V2 queue + steer behavior with a durable generation timeline, while eliminating stale-run hammering.

## Architecture (Final)

- Workflow is the single owner of generation lifecycle (`idle -> processing -> interrupting -> next generation`).
- Messages sent during processing are queued, not started as new runs.
- Interrupt uses Temporal signal + cancellable scope to stop current generation and flush partial output.
- Every stream/event path is tagged with `generationId` for deterministic turn timeline replay.
- After each generation (natural or interrupted), workflow drains queued messages into the next generation.
- Backend and activity enforce stale-run hardening (`run-mismatch` handling + fast emit shutdown).

## Phase Plan (P0-P6)

| Phase | Name                                  | Checkpoint                                                |
| ----- | ------------------------------------- | --------------------------------------------------------- |
| P0    | Baseline checkpoint                   | Checkpoint commit recorded before implementation start    |
| P1    | Workflow generation control           | Queue/interrupt loop + `generationId` in workflow         |
| P2    | Activity cancellation + partial flush | `abortSignal`, interruption event, partial output return  |
| P3    | Backend queue/interrupt APIs          | Queue-aware send, `/interrupt`, enriched `/status`        |
| P4    | Frontend transport adaptation         | Handle queued responses, add interrupt transport API      |
| P5    | Frontend UX + store                   | Queue indicator, steer button, generation-aware reconnect |
| P6    | Stale-run defense in depth            | 409 mismatch + activity fast-exit circuit breaker         |

## Execution Order

1. P1 and P6 in parallel.
2. P2 after P1.
3. P3 after P1 + P2.
4. P4 after P3.
5. P5 after P4.

## Definition of Done

- Queue + steer flow works end-to-end without spawning stale competing runs.
- `generationId` consistently propagates across workflow, activity, backend status, and frontend state.
- Interrupted generations persist partial state and continue with queued input.
- Stale-run traffic does not produce backend error storms.
