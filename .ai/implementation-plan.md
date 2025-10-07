# ShipSec Studio – Implementation Plan

This plan is written for an LLM coding agent (“Agent”). Each phase ends with a human review before continuing.

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
## Phase 4 – Temporal Worker Skeleton

**Goal:** Integrate Temporal workflow skeleton with component registry (mocked execution if necessary).

- [ ] **Step 1:** Add `src/temporal` with client/worker placeholders.
- [ ] **Step 2:** Implement `ShipSecWorkflow.run` (topological sort, invoke components using registry).
- [ ] **Step 3:** Wire activities via SDK `invoke` (even if stubbed).
- [ ] **Step 4:** Add `POST /workflows/:id/run` endpoint executing workflow (mocked).
- [ ] **Step 5:** Commit `feat: add temporal workflow skeleton`. ➜ **Human review before next phase**

---
## Phase 5 – Runner Abstractions (Initial)

**Goal:** Implement inline runner and scaffold Docker runner support.

- [ ] **Step 1:** For inline components, call `execute()` directly through SDK.
- [ ] **Step 2:** Create Docker runner skeleton (spawn command, capture logs; stub output if no docker).
- [ ] **Step 3:** Update sample components to use runners (FileLoader read file, Subfinder simulate output, Webhook log/send HTTP).
- [ ] **Step 4:** Add tests covering inline runner and stubbed Docker logic.
- [ ] **Step 5:** Commit `feat: implement initial runners`. ➜ **Human review before next phase**

---
## Phase 6 – Execution Trace Foundation

**Goal:** Capture and expose component execution events.

- [ ] **Step 1:** Define trace event types (`NODE_STARTED`, `NODE_COMPLETED`, etc.).
- [ ] **Step 2:** Implement in-memory trace collector.
- [ ] **Step 3:** Emit trace events around component execution in SDK/workflow.
- [ ] **Step 4:** Add `GET /workflow-runs/:id/trace` endpoint.
- [ ] **Step 5:** Commit `feat: add execution trace foundation`. ➜ **Human review before next phase**

---
## Phase 7 – Frontend Integration (Initial)

**Goal:** Hook frontend to new backend APIs.

- [ ] **Step 1:** Update frontend API client to call workflow CRUD/commit/run/trace endpoints.
- [ ] **Step 2:** Wire UI to save workflows and display traces (basic view).
- [ ] **Step 3:** Commit `feat: connect frontend to backend APIs`. ➜ **Human review before next phase**

---
## Phase 8 – Final Review & Roadmap

- [ ] **Step 1:** Human-led review of entire codebase vs design docs.
- [ ] **Step 2:** Document remaining TODOs (real Docker/K8s runner, Temporal connection, secrets, artifacts).
- [ ] **Step 3:** Produce roadmap for subsequent sprints.
