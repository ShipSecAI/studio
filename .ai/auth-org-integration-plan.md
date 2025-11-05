# ShipSec Studio – Auth & Org Integration Plan

Purpose: align ShipSec Studio with identity, organization, and role model while keeping the Studio package open-source friendly. The plan assumes two roles (`ADMIN`, `MEMBER`). Clerk issues end-user tokens for authenticated sessions.

_Last updated: 2025-02-15_

---

## Roadmap Snapshot

| Phase | Status | Goal |
|-------|--------|------|
| Phase 0 | 🟢 Completed | Baseline analysis & scaffolding |
| Phase 1 | 🟢 Completed | Modular auth provider abstraction |
| Phase 2 | 🟡 In Progress | Org-scoped persistence & access guards |
| Phase 3 | 🟡 In Progress | Frontend + client auth plumbing |
| Phase 4 | ⚪ Not Started | Extensibility & custom auth hooks |
| Phase 5 | ⚪ Not Started | Documentation & rollout |

---

## Phase 0 – Baseline Analysis & Scaffolding

**Goal:** Capture current auth gaps, confirm schema touch points, and prepare migration scaffolding.

- [x] Inventory backend routes requiring protection; note existing repositories that need `organizationId` filtering.  
  _Routes:_ `/workflows/*`, `/secrets/*`, `/files/*`, `/components`, `/testing/webhook` (dev), `/docs`, `/health` (public).  
  _Repositories needing org scoping:_ `WorkflowRepository`, `WorkflowRunRepository`, `WorkflowVersionRepository`, `TraceRepository`, `FilesRepository`, `SecretsRepository`, `LogStreamRepository`.
- [x] Map Temporal worker touch points needing org context propagation.  
  _Worker hotspots:_ `worker/src/temporal/workflow-runner.ts` (add org-aware `ExecuteWorkflowOptions` + trace/log context), `worker/src/temporal/workflow-scheduler.ts` (propagate metadata), `worker/src/temporal/workers/*` (task queue init payload), `worker/src/temporal/activities` (set run metadata), adapters for persistence (`worker/src/adapters/trace.adapter.ts`, `worker/src/adapters/loki-log.adapter.ts`, `worker/src/adapters/file-storage.adapter.ts`, `worker/src/adapters/secrets.adapter.ts`).
- [x] Draft DB migration stubs for `organization_id` columns (workflows, runs, secrets, files).  
  _Migration:_ `backend/drizzle/0008_add-org-scoping.sql` introduces nullable `organization_id` columns plus indexes; schema definitions updated accordingly.
- [x] Decide on configuration surface (`AUTH_PROVIDER`, provider options) and place holder config schema.  
  _Config:_ `backend/src/config/auth.config.ts` registered via `ConfigModule`, with supporting env examples in `backend/.env.example` (Clerk requires `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` only).

---

## Phase 1 – Modular Auth Provider Abstraction

**Goal:** Introduce a pluggable auth module with a clear provider contract.

- [x] Create `AuthModule` exposing `AuthGuard`, `RolesGuard`, and `AuthContext` injection token.  
  _Module:_ `backend/src/auth/auth.module.ts` registered globally; guards available for downstream modules.
- [x] Implement `LocalDevProvider` (API key / allow-all) to preserve OSS developer experience.  
  _Provider:_ `backend/src/auth/providers/local-auth.provider.ts` supports bearer API keys, optional org headers, and fallback dev mode.
- [x] Implement `ClerkProvider` that verifies Clerk JWTs and normalizes claims to `{ userId, organizationId, roles: ['ADMIN'|'MEMBER'] }`.
- [x] Add configuration + boot-time validation to select provider (`AUTH_PROVIDER=local|clerk`).  
  _AuthService:_ selects provider via `auth` config, logging active strategy on boot (Clerk requires only `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`).
- [ ] Provide testing harness & unit tests for guard behaviours.

---

## Phase 2 – Org-Scoped Persistence & Access Guards

**Goal:** Ensure every resource is stored and queried with organization context and enforced roles.

- [x] Apply schema migrations adding `organization_id` (+ indexes) to workflows, workflow runs, secrets, secret versions, files/artifacts. _(Migration `0008_add-org-scoping.sql` landed and schema types updated.)_
- [x] Backfill existing records using a temporary default org (or flag for manual migration). _(Migration `backend/drizzle/0009_backfill-org-columns.sql` seeds `local-dev` org for legacy rows.)_
- [x] Update repositories & services to require `AuthContext.organizationId`, filter queries, and reject cross-org access. _(Trace + log repositories now scope by org.)_
- [x] Introduce `workflow_roles` (workflow/user/role) table limited to `ADMIN`/`MEMBER`. _(Migration `0010_create_workflow_roles.sql` with repository helper at `backend/src/workflows/repository/workflow-role.repository.ts`.)_
- [x] Implement decorators/guards for resource-level permissions (e.g., only admins can mutate workflows). _(Route-level guard `WorkflowRoleGuard` + `@RequireWorkflowRole` applied to mutating endpoints.)_
- [x] Extend worker run payloads & Trace adapters to persist organization metadata end-to-end. _(Worker Temporal inputs, trace/log adapters now carry `organizationId` through persistence.)_
- [x] Add regression tests covering org isolation and role enforcement. _(Backend workflow service/controller specs updated to exercise org-aware paths.)_

---

## Phase 3 – Frontend & Client Auth Plumbing

**Goal:** Propagate auth tokens from the browser to the Studio backend and respect role-based UI states.

- [x] Update `@shipsec/backend-client` to accept an auth middleware hook and attach bearer tokens. _(Client config now accepts `middleware`, see `packages/backend-client/src/api-client.ts`.)_
- [x] Extend `frontend/src/services/api.ts` to source tokens (Clerk or other) and forward them with each request. _(Auth middleware forwards bearer + organization headers.)_
- [x] Add a lightweight auth store exposing `userId`, `organizationId`, and roles to the UI. _(Persisted Zustand store at `frontend/src/store/authStore.ts`.)_
- [x] Apply role-aware UI gating (disable edits for `MEMBER`, hide destructive actions unless `ADMIN`). _(Workflow builder, list, and secrets respect role checks.)_
- [x] Provide fallback UX for local provider (e.g., API key input banner). _(AuthStatusBanner surfaces local-mode guidance.)_
- [x] Add unit/component tests for auth-aware UI. _(Workflow and secrets pages assert MEMBER read-only state.)_

---

## Phase 4 – Extensibility & Custom Auth Hooks

**Goal:** Ensure community adopters can plug in alternative identity providers with minimal friction.

- [ ] Publish `AuthProviderStrategy` interface and DI token in `@shipsec/backend`.
- [ ] Allow runtime composition via config/env (`AUTH_PROVIDER=custom`, `AUTH_CUSTOM_PROVIDER=modulePath#export`).
- [ ] Provide example custom provider in docs/tests (e.g., GitHub OAuth mock).
- [ ] Validate fallback behaviour when enrichment endpoints are unavailable (graceful degradation to local roles).
- [ ] Document extension points for both frontend (token sourcing) and backend (provider wiring).

---

## Phase 5 – Documentation & Rollout

**Goal:** Provide clear guidance for OSS users and internal teams.

- [ ] Update `docs/guide.md` with auth provider configuration steps.
- [ ] Add a new `docs/auth.md` (or similar) outlining token flow, role matrix, and extension hooks.
- [ ] Record integration notes in `.ai/visual-execution-notes.md` as needed.
- [ ] Deliver migration/runbook instructions for applying the new schema & config.
- [ ] Capture follow-up tasks (e.g., additional roles, audit logging) in repository backlog.

---

**Success Criteria**

- Studio enforces org isolation and `ADMIN`/`MEMBER` roles on every sensitive route.
- Production deployments can plug in Clerk or other identity providers without code changes.
- Local OSS usage remains simple (toggle-able local provider).
- Third parties can register custom auth providers without forking the codebase, and Studio gracefully handles deployments without external dependencies.
