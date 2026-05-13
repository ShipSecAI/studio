---
name: run-reporting
description: Report ShipSec workflow, scanner, wiki, and agent runs with a details table and clickable Studio run URL.
---

# Run Reporting

Use this skill whenever the user asks to start, trigger, launch, run, check,
monitor, resume, inspect, or summarize a ShipSec run. This includes workflow
runs, scanner runs, agent runs, security wiki runs, Temporal executions, and
validation/debug runs.

## Required Response Shape

Every run response must include a compact markdown table with the run details.
Include the table when a run starts, when status is checked, and when a run
finishes or fails.

Required fields when known:

| Field        | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Run          | `<workflowRunId or runId>`                                                      |
| Status       | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, or exact observed status           |
| URL          | `[Open run](http://127.0.0.1:5173/workflows/<workflowId>/runs/<workflowRunId>)` |
| Workflow     | `<workflowId or workflow slug/name>`                                            |
| Temporal run | `<temporalRunId>`                                                               |
| Target       | account, repo, cluster, project, domain, or other scanned target                |
| Started      | exact timestamp when available                                                  |
| Notes        | one short sentence for important context, error, or next step                   |

Omit fields that genuinely are not available yet, but do not omit the URL if it
can be constructed from known IDs.

## URL Rules

- Prefer the Studio run page as the primary link:

  ```text
  http://127.0.0.1:<frontend-port>/workflows/<workflowId>/runs/<workflowRunId>
  ```

- Determine the frontend port from the local instance when possible:
  - Instance `0` uses `5173`
  - Other instances usually use `5173 + (instance * 100)`
  - If uncertain, check `just instance show` or the running PM2/docker config

- Use a clickable markdown link, never a bare URL, when writing the final answer.

- If only the Temporal workflow/run IDs are known, include those and state that
  the Studio URL is not available yet.

## Safety

- Never include secrets, API keys, tokens, cloud credentials, or raw auth headers
  in the table.
- If a run failed because of auth, summarize the failure without printing the
  credential value.
- If multiple runs were started, include one row per run or one table per run,
  whichever is easier to scan.

## Example

| Field        | Value                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Run          | `code-wiki-shipsec-studio-20260513-145413`                                                                                     |
| Status       | `RUNNING`                                                                                                                      |
| URL          | [Open run](http://127.0.0.1:5173/workflows/2a77ec42-aa6a-45df-a7e9-134f4b4d58b3/runs/code-wiki-shipsec-studio-20260513-145413) |
| Workflow     | `2a77ec42-aa6a-45df-a7e9-134f4b4d58b3`                                                                                         |
| Temporal run | `019e2166-ed2f-7582-9f7a-894d0aec819b`                                                                                         |
| Target       | `security wiki`                                                                                                                |
| Notes        | Wiki ingestion is running.                                                                                                     |
