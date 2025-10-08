# ShipSec Studio – Implementation Plan

This plan is written for an LLM coding agent (“Agent”). Each phase ends with a human review before continuing.  
**Frontend freeze:** per latest direction, defer all new frontend work until backend Phases 5–6 ship; Phase 7 remains on hold.

---
## Phase 1 – Workflow Storage & CRUD API

**Goal:** Define backend data model and REST endpoints to store workflow graphs sent from the frontend.

- [x] **Step 1:** Define shared TypeScript DTOs for `WorkflowGraph`, with validation.
- [x] **Step 2:** Create a repository (in-memory for now) to persist workflows.
- [x] **Step 3:** Implement `WorkflowsModule`, `WorkflowsService`, `WorkflowsController` with CRUD endpoints.
- [ ] **Step 4:** (Optional) Add frontend API client stubs for workflows.
- [x] **Step 5:** Add minimal tests validating controller behavior.
- [ ] **Step 6:** Commit `feat: add workflow storage CRUD`. ➜ **Human review before next phase**

---
## Phase 2 – Component Registry Foundation

**Goal:** Scaffold ShipSec SDK component registry and sample components.

- [x] **Step 1:** Set up backend directory structure under `src/components`.
- [x] **Step 2:** Implement component interfaces (`ComponentDefinition`, `RunnerConfig`, `ExecutionContext`).
- [x] **Step 3:** Build `ShipSecComponentRegistry` with register/get/list methods.
- [x] **Step 4:** Provide stubbed `ExecutionContext` (logger, secrets, artifacts).
- [x] **Step 5:** Create sample components (FileLoader, Subfinder, Webhook) with placeholder logic; register them.
- [x] **Step 6:** Add unit tests ensuring registry works.
- [x] **Step 7:** Commit `feat: scaffold component registry`. ➜ **Human review before next phase**

---
## Phase 3 – DSL Compiler & Validation

**Goal:** Convert stored workflow graphs into a validated DSL representation.

- [x] **Step 1:** Define DSL types (`WorkflowDefinition`, `ActionDefinition`).
- [x] **Step 2:** Implement `compileWorkflowGraph` function (validate, topological sort, build actions).
- [x] **Step 3:** Add `POST /workflows/:id/commit` endpoint using compiler; store DSL.
- [x] **Step 4:** Add tests verifying sample graph compiles correctly.
- [x] **Step 5:** Commit `feat: add workflow compiler`. ➜ **Human review before next phase**

---
## Phase 4 – Temporal Infrastructure & Client Integration

**Goal:** Stand up Temporal + MinIO infrastructure locally and replace the stub runner with a real Temporal client in the Nest API.

- [ ] **Step 1:** Expand `docker-compose.yml` to include Temporal server/UI and MinIO while reusing the existing Postgres service (new `temporal` database/schema).
- [ ] **Step 2:** Document required env vars (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, MinIO creds) in README/`.env.example`.
- [ ] **Step 3:** Add Temporal SDK dependencies to the backend and create `TemporalModule`/`TemporalService` that manages connections, namespaces, and workflow starts.
- [ ] **Step 4:** Update `WorkflowsService` to start workflows through Temporal (generate run IDs, call client) and expose status/result/cancel helpers.
- [ ] **Step 5:** Commit `feat: add temporal infrastructure & client`. ➜ **Human review before next phase**

---
## Phase 5 – Temporal Worker Execution

**Goal:** Move component execution into Temporal workers with dedicated task queues and activities.

- [ ] **Step 1:** Implement worker entrypoints (e.g., `src/temporal/workers/dev.worker.ts`) that register workflows/activities and initialise the component registry.
- [ ] **Step 2:** Port the existing inline runner into Temporal activities (invoke registry components, capture outputs/artifacts, emit trace events).
- [ ] **Step 3:** Ensure namespace/queue naming is configurable (default to `shipsec-dev` namespace, `shipsec-default` task queue).
- [ ] **Step 4:** Provide scripts (package.json targets) to run API + worker separately and update documentation.
- [ ] **Step 5:** Commit `feat: add temporal worker execution`. ➜ **Human review before next phase**

---
## Phase 6 – Execution Trace Foundation (Temporal-backed)

**Goal:** Extend trace capture to cover Temporal-driven runs and persist traces for retrieval.

- [x] **Step 1:** Define trace event types (`NODE_STARTED`, `NODE_COMPLETED`, etc.).
- [x] **Step 2:** Implement in-memory trace collector.
- [x] **Step 3:** Emit trace events around component execution in SDK/workflow.
- [x] **Step 4:** Add `GET /workflow-runs/:id/trace` endpoint.
- [ ] **Step 5:** Pipe Temporal activity/workflow events into the trace collector and persist runs for later querying.
- [ ] **Step 6:** Commit `feat: augment trace persistence for temporal runs`. ➜ **Human review before next phase**

---
## Phase 7 – Frontend Integration (Initial) **(On Hold)**

**Goal:** Hook frontend to new backend APIs once backend runner/trace work is stable.

- [ ] **Step 1:** Update frontend API client to call workflow CRUD/commit/run/trace endpoints. **Deferred.**
- [ ] **Step 2:** Wire UI to save workflows and display traces (basic view). **Deferred.**
- [ ] **Step 3:** Commit `feat: connect frontend to backend APIs` after backend readiness review. ➜ **Human review before next phase**

---
## Phase 8 – Final Review & Roadmap

- [ ] **Step 1:** Human-led review of entire codebase vs design docs.
- [ ] **Step 2:** Document remaining TODOs (real Docker/K8s runner, Temporal connection, secrets, artifacts).
- [ ] **Step 3:** Produce roadmap for subsequent sprints.
