# Chat V2 Progress Board

Last Updated: 2026-03-04T21:08:00+08:00
Branch: `codex/eng-218-chat-infinite-polling`

## Overall

Progress: **88%** (**88/100**)
Status: **In Progress**

## Phase Status

| Phase                     | Weight | Status      | Owner  | Checkpoints Done/Total |
| ------------------------- | -----: | ----------- | ------ | ---------------------- |
| 0 Checkpoint Commit       |      5 | Complete    | leader | 3/3                    |
| 1 Schema + Invariants     |     20 | Complete    | T1     | 8/8                    |
| 2 Backend API + Replay    |     20 | Complete    | T2     | 10/10                  |
| 3 Worker + Workflow       |     20 | Complete    | T3/T4  | 10/10                  |
| 4 Frontend Simplification |     20 | Complete    | T5     | 10/10                  |
| 5 Tests + Perf            |     10 | In Progress | T6     | 5/8                    |
| 6 Cleanup + Docs          |      5 | In Progress | T7     | 4/6                    |

## Checkpoints

- [x] P0.1 checkpoint commit done
- [x] P1.1 new tables and indexes merged
- [x] P2.1 /turns /state /stream contracts live
- [x] P3.1 worker emits raw UIMessageChunk
- [x] P4.1 frontend switched to state + cursor attach
- [ ] P5.1 stress test passes without blank-scroll starvation
- [ ] P6.1 legacy partial/run-centric paths deleted
