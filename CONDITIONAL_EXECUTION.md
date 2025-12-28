# Conditional Execution Implementation

## Feature
Implementing conditional execution with skip propagation for workflow branching based on human input decisions.

## Base Problem

When a workflow component (e.g., Manual Approval) completes with specific output ports active (e.g., `approved` or `rejected`), the workflow scheduler should:

1. Skip nodes connected to inactive ports
2. Execute nodes connected to active ports
3. Display "Skipped" badge on skipped nodes in the UI

### Current Issue

The approval component outputs both ports simultaneously in its result:
```typescript
outputSummary: {
  status: "rejected",
  approved: false,  // This is the rejection flag
  respondedBy: "betterclever",
  // ...
}
```

However, the workflow expects the component to return `activeOutputPorts` that indicates which output ports are **actually active**:
- When **approved**: `activeOutputPorts: ['approved']`
- When **rejected**: `activeOutputPorts: ['rejected']`

### Root Cause

In `worker/src/temporal/workflows/index.ts` (lines 48-94), when a human input is resolved:

1. The workflow stores results locally: `results.set(action.ref, { approved: ... })`
2. Creates a **local** `activePorts` array (lines 58-94) based on the resolution
3. Never passes this `activePorts` to the scheduler via the activity result

The `handleSuccess` function (line 80) receives `activePorts` from `outcome.result?.activePorts`, but since the approval component's `execute()` returns `{ pending: true }`, the actual activity result doesn't contain `activeOutputPorts`.

### Expected Fix

The approval component should return a final result with `activeOutputPorts` set based on the resolution. Currently, it only returns `pending: true` during the wait phase and relies on the workflow to resume with resolution data.

The component needs to complete with both output values AND `activeOutputPorts` field so the workflow scheduler knows which edges to follow.
