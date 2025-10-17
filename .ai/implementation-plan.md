# ShipSec Studio – Frontend Modernization & State Revamp Plan

This plan supersedes the previous observability roadmap for the frontend. It targets a cohesive workflow-builder experience: predictable state, modular components, polished mode switching, and a documented UI architecture. Each phase builds incrementally and should be merged separately with human review between phases.

**Status update (2025-10-17):** Plan authored. Begin with Phase 0 baseline audit to confirm UX and state management gaps before refactoring.

---

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ⚪ Not Started | Baseline Audit & UX Inventory |
| Phase 1 | ⚪ Not Started | Architecture & Dependency Alignment |
| Phase 2 | ⚪ Not Started | Core State Foundation (Zustand/Hooks) |
| Phase 3 | ⚪ Not Started | Workflow Builder Shell & Layout System |
| Phase 4 | ⚪ Not Started | Review Mode & Timeline Integration Cleanup |
| Phase 5 | ⚪ Not Started | Component Library Hardening & Documentation |
| Phase 6 | ⚪ Not Started | Data Access Layer & API Contracts |
| Phase 7 | ⚪ Not Started | Quality, Testing, and Performance Polish |

**Primary Objective:** Deliver a resilient workflow builder where Design and Review modes share a consistent shell, state slices are composable, and interactions remain responsive for complex executions.

---

## Phase 0 – Baseline Audit & UX Inventory

**Goal:** Capture the current behaviour, pain points, and gaps to validate the plan against reality.

- [ ] Map navigation flow: landing → Workflow List → Builder (Design/Review).
- [ ] Document Zustand stores (`workflow`, `workflowUi`, `execution`, `executionTimeline`, `component`) and note cross-dependencies.
- [ ] Catalogue layout components (TopBar, Sidebar, Canvas, ReviewInspector, RunWorkflowDialog) highlighting duplication or inline logic.
- [ ] Produce notes in `.ai/frontend-audit.md` covering inconsistent states, missing loading/error handling, styling drift, and performance hotspots.
- [ ] Run `bun install`, `bun run lint`, `bun run typecheck`, `bun run test` to lock baseline status.
- **Deliverable:** Audit log summarizing highest-impact issues to tackle in Phases 1–4.

---

## Phase 1 – Architecture & Dependency Alignment

**Goal:** Ensure tooling, bundler config, and shared libraries support modernization with minimal friction.

- [ ] Verify `vite.config.ts` aliases and extract shared config if Storybook/preview tooling is introduced.
- [ ] Establish `src/app` (or `src/core`) for layout shell, providers, and global hooks; document folder conventions in the audit appendix.
- [ ] Review Tailwind tokens and define semantic color layers (status, emphasis, surfaces) for consistent styling.
- [ ] Confirm Radix UI components align with React 19; upgrade if needed.
- [ ] Enforce ESLint/Prettier rules for hook/component ordering and import grouping.
- **Deliverable:** Updated conventions + lint/typecheck passing.

---

## Phase 2 – Core State Foundation (Zustand/Hooks)

**Goal:** Refactor state management into composable slices with selectors, avoiding broad re-renders and coupling to React Flow internals.

- [ ] Introduce `src/store/index.ts` exporting typed hooks with selector helpers (`createSelectors`).
- [ ] Partition stores into domains: `workflowMeta`, `canvasGraph`, `executionLive`, `executionTimeline`, `uiPreferences`.
- [ ] Wrap React Flow state sync in service hooks (`useWorkflowGraph`) rather than mutating inside `Canvas`.
- [ ] Normalize node/edge schemas in `src/schemas/workflowGraph.ts`.
- [ ] Add unit tests per slice covering initialization, updates, and cross-slice coordination.
- **Deliverable:** New store architecture diagram + passing tests; UI behaviour unchanged.

---

## Phase 3 – Workflow Builder Shell & Layout System

**Goal:** Establish a shared application shell with consistent layout primitives and responsive behaviour.

- [ ] Create `AppShell` handling top navigation, side panels, content area, and responsive breakpoints.
- [ ] Move `TopBar`, `Sidebar`, `Canvas`, `RunWorkflowDialog` into shell slots instead of manual composition in `WorkflowBuilder`.
- [ ] Implement reusable resizable panel hook to replace ad-hoc mouse handlers.
- [ ] Introduce skeleton/loading states for workflow load/save operations.
- [ ] Write integration tests ensuring shell renders for new/existing workflows and responds to toggles.
- **Deliverable:** Builder uses AppShell with parity in features and improved resilience.

---

## Phase 4 – Review Mode & Timeline Integration Cleanup

**Goal:** Decouple Review mode UI from design-only components while preserving execution insight.

- [ ] Build dedicated Review inspector module (Events/Logs/Data tabs) consuming selectors, not mutating stores directly.
- [ ] Replace imperative alerts with toast/system messaging.
- [ ] Extract timeline highlighting logic from `Canvas` into `useReviewTimeline` hook controlling playback and selection.
- [ ] Align timeline visuals with semantic Tailwind tokens and ensure accessibility.
- [ ] Add regression tests covering mode switches, run selection, highlighting, and playback.
- **Deliverable:** Review experience isolated; Canvas focuses on design interactions.

---

## Phase 5 – Component Library Hardening & Documentation

**Goal:** Consolidate UI components, ensure accessibility, and document usage for future contributors.

- [ ] Promote repeated patterns (badges, cards, empty states, status banners) into `src/components/ui/` with minimal props.
- [ ] Introduce Storybook (or lightweight preview) for core components (TopBar, Sidebar, Inspector panels, Node card).
- [ ] Document tokens/patterns in `.ai/frontend-components.md` for internal reference.
- [ ] Ensure dialog/menu components meet keyboard and focus standards.
- [ ] Add snapshot or visual regression tests for critical UI elements.
- **Deliverable:** Component catalogue with previews/tests; usage guidelines recorded.

---

## Phase 6 – Data Access Layer & API Contracts

**Goal:** Encapsulate API access, serialization, and optimistic/pessimistic updates to avoid scattershot fetch logic.

- [ ] Create `src/services/workflowsService.ts` (and related services) exposing typed methods with error normalization.
- [ ] Consolidate serialization helpers (`serializeWorkflowForCreate/Update`, `deserializeNodes/Edges`) into shared module with tests.
- [ ] Add hooks (`useWorkflowsQuery`, `useWorkflowMutation`) providing status + caching via lightweight utility (stay within existing dependencies unless justified).
- [ ] Standardize toasts/error handling for create/update/run flows.
- [ ] Contract tests against mocked `@shipsec/backend-client` responses to ensure schema alignment.
- **Deliverable:** Service layer powering builder actions with consistent UX messaging.

---

## Phase 7 – Quality, Testing, and Performance Polish

**Goal:** Ensure the revamped frontend is reliable, performant, and future-proof.

- [ ] Audit bundle size; split heavy dependencies (React Flow, timeline) via dynamic imports where beneficial.
- [ ] Capture performance metrics (React Profiler snapshots, FPS logging) and address hotspots.
- [ ] Expand automated coverage: e2e smoke (Playwright or Bun runner) for workflow create/save/run/review scenarios.
- [ ] Run Lighthouse (or similar) on builder to assess accessibility/performance.
- [ ] Update `.ai/frontend-audit.md` with final metrics, backlog, and deprecation notes.
- **Deliverable:** Performance report, regression suite, and documented follow-ups.

---

## Operational Runbook

Use these commands throughout phases to maintain a consistent dev loop.

### Install & Lint

```bash
cd frontend
bun install
bun run lint
bun run typecheck
```

### Develop & Test

```bash
bun run dev
bun run test
# Optional targeted suites
bun run test --ui
```

### Build Preview

```bash
bun run build
bun run preview
```

### Storybook (Phase 5+)

```bash
bun run storybook
```

### Cleanup

```bash
rm -rf node_modules .turbo .storybook/node_modules
```

---

## Change Log

- `2025-10-17` – Authored frontend modernization plan replacing observability playbook; awaiting Phase 0 audit kickoff.

---

## Next Agent Instructions

1. Execute Phase 0 audit and capture findings in `.ai/frontend-audit.md`.
2. After reviewer alignment, proceed sequentially through phases (avoid bundling phases in one PR).
3. Update this plan after completing each phase (status table, change log, next steps).
4. Maintain test coverage and UX parity before layering new features.
