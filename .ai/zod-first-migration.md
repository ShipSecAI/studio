# Zod-First Typing Migration Plan (Full Cutover)

## Intent
Move to a single Zod-first typing system that keeps all current behavior, removes drift, and eliminates every legacy path (no PortDataType, no port.* helpers, no contract registry). Tools do not exist yet, so the core typing refactor must land before any tool work. Workflow JSON stays exactly the same. No backwards-compatibility shims are allowed.

## Context From Our Conversation
- The current system is not "stronger" overall; it is more explicit but drifts and is less expressive than Zod.
- We must preserve all functionality and pass all tests.
- We want typed `meta` without global Zod module augmentation (use a typed helper).
- Avoid auto-registering vague or complex types as contracts; contracts must be explicit.
- Ports should remain shallow; nested fields stay inside a single port unless explicitly opted in.
- Vague types (`any`/`unknown`) must be explicitly acknowledged.
- This refactor must remove all legacy code paths; no zombies.

## Non-Negotiable Invariants
- Workflow definition JSON remains unchanged (nodes/edges/params/mappings stay identical).
- Every test passes at the end (typecheck, lint, unit, integration, e2e as applicable).
- No legacy typing system code remains in the codebase.
- Shared port/connection logic is centralized in component-sdk and imported by backend/frontend.

## Ralph Wiggum Loop (Process Rule)
- After each phase, update this file by checking off completed todo items and adding any new discovered tasks.
- After each phase, create a git commit (or multiple commits if appropriate for the size of the work).
- Before starting the next phase, validate that all remaining todos in the current phase are either completed or explicitly deferred with a reason.
- Add a short "Phase Notes" subsection when a phase completes, summarizing decisions and any follow-ups.

## Definitions (New System)
- Component definition uses `inputs` and `outputs` Zod schemas only.
- Port metadata is attached via a typed helper, not global Zod augmentation.
- Ports, connection types, and tool schemas are derived from Zod.
- Contracts are explicit named Zod exports with `meta.schemaName`.

### Example API Shape (Target)
```ts
import { z } from 'zod';
import { defineComponent, withPortMeta } from '@shipsec/component-sdk';

const inputs = z.object({
  apiKey: withPortMeta(z.string(), { label: 'API Key', bindingType: 'credential', icon: 'Key' }),
  target: withPortMeta(z.string(), { label: 'Target' }),
});

const outputs = z.object({
  result: withPortMeta(z.string(), { label: 'Result' }),
});

export default defineComponent({
  id: 'security.example',
  label: 'Example',
  category: 'security',
  runner: { kind: 'inline' },
  inputs,
  outputs,
  ui: { icon: 'Shield', description: 'Example component', examples: [] },
  async execute(params, context) { /* ... */ },
});
```

## Phase 0: Baseline + Guardrails
Intent: Freeze expectations and set guardrails before changing behavior.
Todos:
- [x] Snapshot current tests and key workflows that must continue to pass (list critical suites and known workflows).
- [x] Add a temporary migration branch README note explaining the goal and process rules.
- [x] Define success criteria: "all tests pass" + "no PortDataType, no contract registry, no port.* usage remains".
- [x] Add a single-source "migration checklist" pointer to this file for agents.

Must-pass test suites and workflows:
- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run test:e2e`
- Core workflow compile + execute (backend DSL compiler + worker runtime)
- Frontend workflow builder connection validation and editor inference

Exit criteria:
- [x] The team agrees on invariants and the no-backcompat stance.
- [x] A list of must-pass tests and workflows is recorded here.

### Phase Notes
- Added a repo-level README notice pointing to this migration checklist.
- Recorded baseline test suite commands and critical workflow behavior to preserve.

## Phase 1: New Core Typing API in component-sdk
Intent: Build the Zod-first core API and shared helpers.
Todos:
- [ ] Introduce `PortMeta` and `withPortMeta(schema, meta)` helper (typed, no Zod module augmentation).
- [ ] Add `mergePortMeta` behavior so repeated `withPortMeta` merges instead of overwriting.
- [ ] Implement `extractPorts(zodSchema)` that derives `ComponentPortMetadata[]` from Zod.
- [ ] Implement `zodToConnectionType(schema)` and `canConnect()` in component-sdk.
- [ ] Define explicit handling for Zod types: optional, default, nullable, effects, union, enum, record, array, object, void.
- [ ] Implement JSON schema generation directly from Zod (`getToolSchema`) even if tools are not shipped yet.
- [ ] Add a schema validation pipeline that enforces:
  - [ ] Required `meta.label` where needed (default label = field name if absent).
  - [ ] `z.any` / `z.unknown` only with explicit `meta.allowAny` and optional `meta.reason`.
  - [ ] Max depth for port-visible fields (default 1 level); require explicit opt-in for deeper.
  - [ ] `meta.schemaName` required for named contracts; no implicit contracts.
  - [ ] Union or complex types must have explicit `meta.connectionType` or `meta.editor` override.
- [ ] Update component registry to compute/cache derived ports and connection types.
- [ ] Add unit tests for extraction/connection/validation rules in component-sdk.

Exit criteria:
- [ ] SDK exposes a stable API for ports/connection types derived from Zod.
- [ ] Validation pipeline blocks ambiguous schemas without explicit meta.

## Phase 2: Backend Migration (DSL + Runtime)
Intent: Use Zod-derived ports for validation and runtime input handling.
Todos:
- [ ] Replace backend `backend/src/dsl/port-utils.ts` with component-sdk `zodToConnectionType` and `canConnect`.
- [ ] Update DSL validation to use derived ports from Zod (no `metadata.inputs`).
- [ ] Remove `coerceValueForPort` usage in runtime input resolution; use Zod coercion in schemas instead.
- [ ] Update placeholder generation logic to use Zod-derived types (for validation placeholders).
- [ ] Ensure workflow JSON format remains unchanged (validate compile/execute flow).
- [ ] Add or update tests in `backend/src/dsl/__tests__` to reflect Zod-derived port behavior.

Exit criteria:
- [ ] DSL validation and runtime no longer depend on PortDataType or port.* helpers.

## Phase 3: Frontend Migration (Ports + UI)
Intent: Align frontend connection validation and editor inference to Zod-derived metadata.
Todos:
- [ ] Remove frontend port utils (`frontend/src/utils/portUtils.ts` and related compatibility logic).
- [ ] Import shared helpers from component-sdk for compatibility and type checks.
- [ ] Update `frontend/src/utils/connectionValidation.ts` to use `zodToConnectionType` and derived ports.
- [ ] Update editor inference to rely on Zod + `meta.editor` overrides, including secrets and enums.
- [ ] Verify dynamic ports derived from `resolvePorts` schemas render correctly.
- [ ] Add frontend tests or manual verification notes to confirm connection validation behavior.

Exit criteria:
- [ ] UI shows the same ports as before, but derived from Zod.
- [ ] Connection validation is consistent with backend logic.

## Phase 4: Contracts Migration
Intent: Replace contract registry with explicit schema exports.
Todos:
- [ ] Create `packages/contracts` with explicit Zod schema exports.
- [ ] Each contract must include `meta.schemaName` and optional `meta.isCredential`.
- [ ] Replace `registerContract/getContract` usage with direct schema imports.
- [ ] Remove contract registry implementation (`packages/component-sdk/src/contracts.ts`).
- [ ] Update any tests that expected registry behavior.

Exit criteria:
- [ ] No contract registry exists; all contracts are explicit Zod exports.

## Phase 5: Component Cutover (All Components)
Intent: Migrate every component to the new Zod-first definition.
Todos:
- [ ] Replace `inputSchema/outputSchema + metadata.inputs/outputs` with `inputs/outputs` Zod-only on every component.
- [ ] Replace all `port.*` usage with Zod types + `withPortMeta`.
- [ ] Update all `resolvePorts` to return Zod schemas (SDK merges with base schema).
- [ ] Ensure `outputs` is safe when not an object (void/record/any) and does not crash extraction.
- [ ] Tighten `any/unknown` usages or add explicit `meta.allowAny` with justification.
- [ ] Migrate components in waves to reduce risk:
  - [ ] Core components (entry-point, workflow-call, console-log, file-writer, http-request).
  - [ ] Manual actions (approval, selection, form).
  - [ ] Security components (subfinder, dnsx, nuclei, trufflehog, etc).
  - [ ] AI components (agent, providers).
  - [ ] Notification, IT automation, GitHub components.
- [ ] Update component tests to the new API shape without changing assertions.

Exit criteria:
- [ ] No component uses `metadata.inputs/outputs` or `port.*`.

## Phase 6: Remove Legacy Code
Intent: Delete every leftover legacy type system artifact.
Todos:
- [ ] Delete `PortDataType` and `port.*` helpers.
- [ ] Delete old JSON schema mapping and old tool helpers.
- [ ] Remove any compatibility shims or dual-path logic.
- [ ] Delete redundant frontend/backend port logic.
- [ ] Remove unused tests that targeted the legacy API.
- [ ] Audit the repo for legacy symbols with `rg` and confirm zero matches.

Exit criteria:
- [ ] `rg -n \"PortDataType|port\\.\"` returns no matches.
- [ ] `rg -n \"registerContract|getContract\"` returns no matches.

## Phase 7: Validation + Final Pass
Intent: Prove the migration is complete and stable.
Todos:
- [ ] Run full test suite and typecheck.
- [ ] Fix regressions until all tests pass.
- [ ] Validate that workflow JSON inputs and outputs are identical to pre-migration behavior.
- [ ] Confirm no legacy symbols remain.

Exit criteria:
- [ ] All tests pass, and all completion checks are done.

## Completion Checklist
- [ ] All phases completed with updated todo checks.
- [ ] Tests pass.
- [ ] No legacy typing system code remains.
- [ ] Workflow JSON remains unchanged.
