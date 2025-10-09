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

> **Current State Snapshot – 2025-10-09**
>
> - Temporal services run via docker compose (`shipsec-temporal`, `shipsec-temporal-ui`, `shipsec-postgres`, `shipsec-minio`).
> - Backend (`bun run dev`) and worker (`npm run worker:dev` via tsx/Node.js) are managed through PM2 (`pm2.config.cjs`). Use `npx pm2 start pm2.config.cjs`, `npx pm2 logs <name> --lines 100 --nostream`, etc.
> - **Phase 5 Complete:** Temporal worker execution fully functional with Node.js runtime (Bun incompatible with Temporal SDK).
> - **Phase 5.5 Complete:** Real file storage and component registry API shipped.
> - Nest backend now owns:
>   * `TemporalModule`/`TemporalService` that auto-register `shipsec-dev` namespace and returns task queue info.
>   * `WorkflowsService` starting workflow type `shipsecWorkflowRun` through Temporal, with status/result/cancel passthroughs.
>   * `StorageModule` with MinIO integration for file upload/download/delete operations.
>   * `ComponentsModule` exposing component registry via REST API.
>   * Optional demo bootstrap disabled (`WorkflowsBootstrapService` removed from providers).
> - Worker (`backend/src/temporal/workers/dev.worker.ts`) registers:
>   * Workflow `shipsecWorkflowRun` and activity `runWorkflowActivity`.
>   * Service container with `FilesService` and `StorageService` for component DI.
>   * Database + MinIO connections initialized at worker startup.
> - Components:
>   * `core.file.loader` - Real component fetching files from MinIO by UUID reference.
>   * `core.trigger.manual` - Manual trigger with payload.
>   * `shipsec.subfinder.run` - Docker-based subdomain discovery (stubbed).
>   * `core.webhook.post` - HTTP POST webhook sender (stubbed).
> - Database schema includes: `workflows`, `files` tables (Drizzle ORM migrations applied).
> - Tests (`bun test`) and `bun run typecheck` pass; PM2 tasks expect `.env` populated with `DATABASE_URL`, Temporal vars, MinIO config.
> - **End-to-end verified:** File upload → MinIO storage → Workflow execution → Component fetches file → Base64 result returned.
> - Next steps: Phase 6 (trace persistence to database for Temporal runs).

---
## Phase 5 – Temporal Worker Execution

**Goal:** Move component execution into Temporal workers with dedicated task queues and activities.

- [x] **Step 1:** Implement worker entrypoints (e.g., `src/temporal/workers/dev.worker.ts`) that register workflows/activities and initialise the component registry.
- [x] **Step 2:** Port the existing inline runner into Temporal activities (invoke registry components, capture outputs/artifacts, emit trace events).
- [x] **Step 3:** Ensure namespace/queue naming is configurable (default to `shipsec-dev` namespace, `shipsec-default` task queue).
- [x] **Step 4:** Provide scripts (package.json targets) to run API + worker separately and update documentation.
- [x] **Step 5:** Commit `feat: add temporal worker execution`. ➜ **Human review before next phase**

---
## Phase 5.5 – File Storage & Component Registry API

**Goal:** Implement real file storage with MinIO and expose component registry to frontend.

- [x] **Step 1:** Integrate MinIO client and create storage service for file upload/download/delete operations.
- [x] **Step 2:** Create files database schema and repository for metadata tracking.
- [x] **Step 3:** Implement Files REST API (`POST /files/upload`, `GET /files`, `GET /files/:id/download`, `DELETE /files/:id`).
- [x] **Step 4:** Update file loader component from mock to real MinIO-backed implementation.
- [x] **Step 5:** Implement service container for dependency injection in Temporal workers.
- [x] **Step 6:** Add Component Registry API (`GET /components`, `GET /components/:id`) with OpenAPI docs.
- [x] **Step 7:** End-to-end test file upload → workflow execution → MinIO fetch → result.
- [x] **Step 8:** Commit `feat: implement real file storage with MinIO` and `feat: add component registry API`. ➜ **Phase complete**

---
## Phase 5.9 – Component SDK Package Separation

**Goal:** Extract component SDK into separate worker package with clean interfaces, eliminating backend coupling.

- [ ] **Step 1:** Create `worker/` package with its own `package.json` and TypeScript config.
- [ ] **Step 2:** Define SDK interfaces (`IFileStorageService`, `ISecretsService`, etc.) in `worker/src/sdk/interfaces.ts`.
- [ ] **Step 3:** Move component registry, types, context, and runner to `worker/src/sdk/`.
- [ ] **Step 4:** Move all component implementations to `worker/src/components/` (core, security categories).
- [ ] **Step 5:** Create service adapters in `worker/src/adapters/` that implement SDK interfaces using backend services.
- [ ] **Step 6:** Move Temporal worker code to `worker/src/temporal/workers/` and update to use adapters.
- [ ] **Step 7:** Update root `package.json` to use npm/bun workspaces for monorepo structure.
- [ ] **Step 8:** Update backend to remove component code and adjust imports where needed.
- [ ] **Step 9:** Test end-to-end workflow execution with new architecture.
- [ ] **Step 10:** Update documentation (README, architecture diagrams).
- [ ] **Step 11:** Commit `refactor: extract component SDK to separate worker package`. ➜ **Human review before next phase**

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
