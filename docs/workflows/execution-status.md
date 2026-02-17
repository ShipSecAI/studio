# Workflow Execution Status

This document describes the different execution statuses a workflow run can have and when each status applies.

## Status Overview

| Status           | Color  | Description                                                    |
| ---------------- | ------ | -------------------------------------------------------------- |
| `QUEUED`         | Blue   | Workflow is waiting to be executed                             |
| `RUNNING`        | Blue   | Workflow is actively executing                                 |
| `COMPLETED`      | Green  | Workflow finished successfully - all nodes completed           |
| `FAILED`         | Red    | Workflow failed - at least one node failed or workflow crashed |
| `CANCELLED`      | Gray   | Workflow was cancelled by user                                 |
| `TERMINATED`     | Gray   | Workflow was forcefully terminated                             |
| `TIMED_OUT`      | Amber  | Workflow exceeded maximum execution time                       |
| `AWAITING_INPUT` | Purple | Workflow is paused waiting for human input                     |
| `STALE`          | Amber  | Orphaned record - data inconsistency (see below)               |

## Status Transitions

```
QUEUED → RUNNING → COMPLETED
                 → FAILED
                 → CANCELLED
                 → TERMINATED
                 → TIMED_OUT
                 → AWAITING_INPUT → RUNNING (when input provided)
```

## Detailed Status Descriptions

### QUEUED

The workflow run has been created and is waiting to start execution. This is the initial state before the Temporal worker picks up the workflow.

### RUNNING

The workflow is actively executing. At least one node has started processing.

### COMPLETED

All nodes in the workflow have finished successfully. This is a terminal state.

**Conditions:**

- All expected nodes have `COMPLETED` trace events
- No `FAILED` trace events

### FAILED

The workflow encountered an error during execution. This is a terminal state.

**Conditions:**

- At least one node has a `FAILED` trace event, OR
- Some nodes started but not all completed (workflow crashed/lost)

### CANCELLED

The user manually cancelled the workflow execution. This is a terminal state.

### TERMINATED

The workflow was forcefully terminated (e.g., via Temporal API). This is a terminal state.

### TIMED_OUT

The workflow exceeded its maximum allowed execution time. This is a terminal state.

### AWAITING_INPUT

The workflow has reached a human input node and is waiting for user interaction. The workflow will resume to `RUNNING` when input is provided.

### STALE

**Special Status - Data Inconsistency Warning**

The run record exists in the database but there's no evidence it ever executed:

- No trace events in the database
- Temporal has no record of this workflow

**Common Causes:**

1. **Fresh Temporal instance with old database** - The Temporal server was reset/reinstalled but the application database retained old run records
2. **Failed workflow start** - The backend created a run record but the Temporal workflow failed to start (network error, Temporal unavailable, etc.)
3. **Data migration issues** - Database was migrated without corresponding Temporal data

**Recommended Action:**

- Review these records and delete them if they represent stale data
- Investigate why the data inconsistency occurred to prevent future occurrences

## Status Determination Logic

When querying run status, the system follows this logic:

1. **Query Temporal** - Get the workflow status from Temporal server
2. **If Temporal returns status** - Use the normalized Temporal status
3. **If Temporal returns NOT_FOUND** - Infer status from trace events:
   - No `STARTED` events → `STALE` (orphaned record)
   - Any `FAILED` events → `FAILED`
   - All nodes have `COMPLETED` events → `COMPLETED`
   - Some `STARTED` but incomplete → `FAILED` (crashed)

## Frontend Badge Colors

Status badges use these colors for visual distinction:

- **Blue** (active): `QUEUED`, `RUNNING`
- **Green** (success): `COMPLETED`
- **Red** (error): `FAILED`
- **Amber** (warning): `TIMED_OUT`, `STALE`
- **Gray** (neutral): `CANCELLED`, `TERMINATED`
- **Purple** (attention): `AWAITING_INPUT`
