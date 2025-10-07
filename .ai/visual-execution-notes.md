# Visual Execution & Trace Capture Concepts

## Live Run UX
- Canvas node states: idle, running (pulsing), success (green), failure (shaking red). Edges animate data flow.
- Bottom console streams structured logs per node; supports filters and artifact previews.
- Progress updates (e.g., HTTPX scanned 89/127) derived from `NODE_PROGRESS` events emitted by modules.

## Replay Mode
- Historical runs selectable from timeline; playback re-applies captured events to animate the DAG.
- Scrubber jumps to a timestamp; canvas + console reflect state at that moment.
- Diff view highlights behavioral changes between runs (new nodes, altered outputs).

## Trace Event Schema (concept)
```
NODE_STARTED, NODE_LOG, NODE_PROGRESS, NODE_ARTIFACT,
NODE_COMPLETED, NODE_FAILED, WORKFLOW_STATUS
```
Each stores `runId`, `nodeId`, timestamp, payload.

## Capture Pipeline
1. DSL workflow schedules `recordEvent` activities around each node execution.
2. Activities and executor send log/progress/artifact events via streaming channel to a Trace Collector service.
3. Collector writes append-only events (Postgres/Redis Streams) for live fan-out + replay.
4. UI subscribes to live events for active runs; fetches stored events for historical runs.
5. Artifacts saved to object storage; metadata referenced by `NODE_ARTIFACT` events.

## Developer Hooks
- Module SDK exposes `context.log()`, `context.progress()`, `context.emitArtifact()` to emit trace events.
- Worker handles retries and heartbeats, preserving trace continuity.
