# Artifact Library Implementation Plan

_Owner: Codex (feat/issue-57)_  
_Context: https://github.com/ShipSecAI/studio/issues/57_

## Problem
Security components (Prowler, dnsx, etc.) emit JSON/NDJSON reports that currently vanish once the run finishes unless a human downloads them manually. This blocks:
- debugging past runs (no shared source-of-truth per run);
- chaining workflows off of previous outputs;
- building run diffing and historical comparisons.

## Objectives
1. Let any component opt into saving generated files as **Run Artifacts** (scoped to a single run) and/or the workspace-level **Artifact Library**.
2. Persist artifacts with metadata (name, size, mime type, origin component, timestamps, destination flags).
3. Provide download + inspection affordances from both the Run Inspector UI and a global library view.
4. Allow future workflows to reference library artifacts as inputs.

## Deliverables
| Track | Deliverable |
| --- | --- |
| Backend | DB schema/migrations for artifacts, repository/service/controller, REST endpoints for run + global listings, download proxying, and DTOs in `@shipsec/shared`. |
| Worker | Artifact adapter that reuses MinIO + Drizzle, updated `IArtifactService` contracts, execution-context helpers, and component-level toggles (start with Prowler). |
| Frontend | Run Inspector “Artifacts” tab, global Artifact Library page, builder parameter controls for opting-in/out + picking artifacts as inputs, API client coverage. |
| Docs | Extend `.ai/file-storage-implementation.md` + `docs/execution-contract.md` with artifact payloads and runbook notes. |
| QA | Repository + service unit tests, worker adapter tests, component integration tests, frontend store/component tests. |

## Workstreams

### 1. Backend Platform
1. **Schema & Migration**
   - New table `artifacts` (id uuid pk, run_id, workflow_id, component_ref, file_id FK → files.id, destinations JSONB, metadata JSONB, checksum?, organization_id, created_at).
   - Add `artifacts` to `MigrationGuard.REQUIRED_TABLES`.
2. **Repository & Service**
   - CRUD helpers (create, list by run, list workspace, soft delete optional).
   - Service coordinates with `FilesService` (download) and ensures org scoping.
3. **DTOs & Shared Schemas**
   - Add `ArtifactMetadataSchema` to `@shipsec/shared` plus API response envelopes (`RunArtifactsResponse`, `ArtifactLibraryListResponse`).
4. **Controllers**
   - `GET /workflows/runs/:runId/artifacts`
   - `GET /artifacts` (filter by component, mime, date, search text).
   - `GET /artifacts/:id/download` (streams underlying file).
5. **API Client**
   - Expose new endpoints in `packages/backend-client` and wrap inside `frontend/src/services/api.ts`.

### 2. Worker & Component SDK
1. **IArtifactService Upgrade**
   - Expand interface to accept `{ runId, componentRef, destinations: ('run' | 'library')[], metadata? }`.
   - Support download by artifact ID with metadata response.
2. **Artifact Adapter**
   - New adapter using existing MinIO + Drizzle connections (parallel to `FileStorageAdapter`).
   - Handles (a) writing buffers to MinIO (maybe reuse files bucket) and (b) inserting artifact rows referencing stored file IDs.
3. **Execution Context Wiring**
   - `createExecutionContext` remains unchanged; worker now injects real adapter (both in `workflow-runner` inline mode and Temporal activity).
   - Provide helper `context.artifacts?.uploadFromPath` or doc snippet so components don’t need to re-read files unnecessarily.
4. **Component Integration**
   - Extend component metadata schemas (Zod) to include config options (e.g., boolean `saveRunArtifacts`, `publishToLibrary`, `artifactLabel`).
   - Update `security.prowler.scan` to honor toggles, upload generated ASFF bundle(s), and return artifact IDs in output for downstream reuse.
5. **Temporal Run Metadata**
   - Ensure artifact uploads capture `organizationId` (pass via run options).

### 3. Frontend Experience
1. **API Layer**
   - `api.executions.getRunArtifacts(runId)` and `api.artifacts.list()`/`download(id)`.
   - Types derived from `@shipsec/shared`.
2. **Run Inspector**
   - Add `Artifacts` tab (next to Events / Logs / Data) inside `ExecutionInspector`.
   - New zustand slice to fetch + cache per-run artifacts; table cards show metadata, download button, JSON preview if small text.
3. **Artifact Library Page**
   - Route `/artifacts` with filters (search, component, type, run).
   - Sorting + bulk actions (download, copy artifact ID).
4. **Builder Controls**
   - Config panel surfaces component parameters for artifact saving with toggle/help text.
   - Input fields for `file`/`json` types gain artifact-picker modal that hits the library endpoint.
5. **Navigation**
   - Add “Artifact Library” entry to `AppLayout` sidebar, feature flag with permissions if needed.

### 4. Documentation & Contracts
1. Update `.ai/file-storage-implementation.md` with artifact flow diagrams.
2. Append `docs/execution-contract.md` describing new API payloads and SSE events (if any).
3. Add notes to `.ai/implementation-plan.md` Phase 8 backlog referencing artifacts progress.

### 5. Testing & Validation
1. **Backend**
   - Drizzle repository tests (artifact create/list scoped by org).
   - Service/controller e2e tests using Nest testing module + supertest.
2. **Worker**
   - Adapter unit tests (upload/download), integration test ensuring artifact rows exist after component upload.
   - Prowler component test verifying toggles emit artifacts.
3. **Frontend**
   - Store tests for new artifact slices.
   - Component tests (Artifacts tab rendering, library table interactions).
4. **Manual Validation**
   - Run Prowler workflow end-to-end with toggles on/off, confirm run artifacts present, global library shows saved items, downloading works, and referencing artifact as workflow input executes successfully.

## Open Questions
- Should artifacts reuse `files` table or have dedicated storage objects per component? (Plan assumes reuse with metadata linking.)
- Retention/quotas: do we need TTL or quotas now? (Assume no; note as future enhancement.)
- Permissions: does every viewer access entire library or respect workflow roles? (Default to existing org-level auth; revisit if finer controls needed.)

## Next Steps
1. Land DB schema + backend APIs.
2. Implement worker adapter + sample component integration.
3. Build frontend artifacts UX + selectors.
4. Refresh docs and run test suites before PR.

