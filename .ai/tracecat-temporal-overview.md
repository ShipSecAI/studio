# Tracecat Temporal Architecture (Research Notes)

- Tracecat uses FastAPI backend to manage workflow definitions (React Flow graph stored as `workflow.object`).
- `WorkflowsManagementService.build_dsl_from_workflow` converts the graph into `DSLInput` objects, validating nodes and dependencies before persistence.
- `/workflows/{id}/commit` endpoint runs tiered validation, writes a `WorkflowDefinition`, and increments workflow version.
- Executions API fetches latest definition, instantiates `DSLInput`, and calls `WorkflowExecutionsService.create_workflow_execution_nowait`.
- `_dispatch_workflow` invokes Temporal via the Python client (`execute_workflow`) with `DSLRunArgs` containing DSL + role context.
- Worker (`tracecat/dsl/worker.py`) registers `DSLWorkflow` and all activities from `DSLActivities.load()`.
- `DSLWorkflow.run` orchestrates actions: evaluates templated args, schedules activities (e.g., `run_action_activity`), handles scatter/gather, child workflows, error handlers.
- Activities call back into Tracecat subsystems, notably the executor service through `ExecutorClient.run_action_memory_backend`.
- Frontend polls backend endpoints that read Temporal history via `WorkflowExecutionsService` (no direct Temporal ↔ UI communication).
