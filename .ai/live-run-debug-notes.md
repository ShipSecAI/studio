# Live Run Debugging Plan

## Symptoms
- Live workflow runs stop receiving timeline/log updates after some time.
- SSE stream appears to hang; UI shows stale data even though worker continues emitting events.

## Debug Checklist
1. **Frontend SSE diagnostics**
   - Open DevTools → Network → filter EventStream.
   - Inspect `/api/v1/workflows/runs/:runId/stream` entry.
   - Confirm keepalive comments and `trace` events continue; note HTTP status / reconnect attempts.
   - In console, add temporary logging in `useExecutionStore.connectStream` to confirm handlers fire.

2. **Backend stream health**
   - `pm2 logs shipsec-backend --nostream --lines 200` while running workflow.
   - Look for warnings from `workflows.controller.ts` stream handler (LISTEN/NOTIFY failures, pump errors).
   - Ensure SSE response is not prematurely ending (no "Failed to set up LISTEN/NOTIFY" spam).

3. **Worker emissions**
   - `pm2 logs shipsec-worker --nostream --lines 200` to verify TraceAdapter continues to `record` events for the same run.
   - Check Postgres `workflow_traces` table to ensure sequences increase while UI stalls (`select count(*) from workflow_traces where run_id = '...'`).

4. **Reproduction workflow**
   - Use Live Event Heartbeat workflow (`test.live.event.heartbeat`) to emit steady progress events.
   - Run http://localhost:5173/workflows/33536272-7a30-4d56-978b-c031a514b02b under live mode; record timestamps when stream stops.

5. **Edge cases**
   - Verify what happens when zooming timeline or pausing playback; check if `timelineZoom` logic accidentally filters events.
   - Confirm SSE headers include `Cache-Control: no-cache` and `connection: keep-alive` (no proxies closing connection).

## Next steps
- Gather browser console + backend logs for a run where stream stalls.
- Compare `events.length` in store vs. `workflow_traces` count.
- If SSE disconnects, add auto-reconnect/backoff logic.
