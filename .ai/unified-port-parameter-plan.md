# Unified Port + Parameter System (Full Cutover)

## Intent
Move to the unified port/parameter API with explicit UI for inputs (including connection status + manual overrides) and eliminate all legacy paths.

## Process Rules
- After each phase, check off completed items and add brief Phase Notes.
- End each phase with one or more commits.
- Update this plan if scope changes.

## Phase 0: RFC Alignment
Todos:
- [x] Update RFC to show Inputs in the ConfigPanel with connection/override status.
- [x] Record the no-backcompat stance in the RFC.

### Phase Notes
- RFC now specifies Parameters + Inputs sections, with manual overrides and `valuePriority` behavior.

## Phase 1: SDK + Types
Intent: Ship the new core API in `@shipsec/component-sdk`.
Todos:
- [x] Add `port()`, `param()`, `inputs()`, `outputs()`, `parameters()` helpers.
- [x] Add branded schema types (`PortSchema`, `ParamSchema`, etc.).
- [x] Update `ComponentDefinition` + `defineComponent` typing to use new shapes.
- [x] Update port/parameter metadata extraction helpers for UI/validation.
- [x] Add or update component-sdk unit tests.
- [x] Commit checkpoint.

### Phase Notes
- Introduced `defineComponent` + unified schema builders without breaking legacy `ComponentDefinition`.
- Registry now extracts parameters from `parameters()` schemas, with legacy UI parameters as fallback.
- Committed SDK/type updates.

## Phase 2: Backend Compiler + Workflow Schema
Intent: Compile params + input overrides into workflow actions.
Todos:
- [x] Extend workflow action schema to store `params` and port override values.
- [x] Update DSL compiler to extract params + overrides from node config.
- [x] Update DSL validation to use separated schemas.
- [x] Add/adjust backend tests (compiler + validation).
- [x] Commit checkpoint.

### Phase Notes
- Backend workflow schema and compiler now persist params and input overrides.
- DSL validator and tests updated to reflect separated inputs/params.

## Phase 3: Worker Runtime
Intent: Execute components with separated inputs/params and override rules.
Todos:
- [x] Update activity payload to `{ inputs, params }`.
- [x] Resolve inputs from mappings + overrides (respect `valuePriority`).
- [x] Update worker tests or add coverage for overrides.
- [x] Commit checkpoint.

### Phase Notes
- Worker activity payload now carries `inputs` + `params` and honors override priority.
- Worker tests updated to cover override handling.

## Phase 4: Frontend UI + Data Model
Intent: Surface inputs + parameters with clear status and overrides.
Todos:
- [x] Update node config shape to store parameter values + input overrides.
- [x] ConfigPanel renders Parameters + Inputs sections from schemas.
- [x] Inputs show Connected/Manual/Empty status.
- [x] Manual override editor uses `PortMeta.editor` and `valuePriority`.
- [x] Remove any legacy `parameters` field usage.
- [x] Commit checkpoint.

### Phase Notes
- Full cutover from legacy `parameters` to `config.params` and `config.inputOverrides`.
- Updated serializer, ConfigPanel, WorkflowNode, and validation logic.

## Phase 5: Component Migration
Intent: Migrate all components to the unified API.
Todos:
- [x] Split each component into `inputs`, `outputs`, `parameters`.
- [x] Update `execute` signatures to `{ inputs, params }`.
- [x] Remove `ui.parameters` from component definitions.
- [x] Commit checkpoint (can be multiple commits by component group).

### Phase Notes
- Migrated components by category (core, ai, github, it-automation, manual-action, notification, security, test).
- Committed each category as a separate checkpoint.

## Phase 6: Cleanup + Enforcement
Intent: Remove legacy paths and lock the new system.
Todos:
- [ ] Remove deprecated helpers/legacy typing paths.
- [ ] Add lint rule to forbid `ui.parameters`.
- [ ] Update docs/runbooks to reflect the new system.
- [ ] Commit checkpoint.

## Validation (End of Each Phase)
- [x] `bun run typecheck` (Backend + Frontend)
- [ ] `bun run lint`
- [ ] `bun run test` (plus targeted backend/worker suites as needed)
