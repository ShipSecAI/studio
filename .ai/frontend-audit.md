## Frontend Baseline Audit – 2025-10-17

### Navigation & Screens
- Entry flow: `WorkflowList` → `/workflows/:id` → `WorkflowBuilder` with Design/Review toggle in `TopBar`.
- No global app shell; each page renders its own layout. Review mode relies on shared `WorkflowBuilder` tree rather than a dedicated shell.

### State Management
- Multiple standalone Zustand stores (`workflowStore`, `workflowUiStore`, `executionStore`, `executionTimelineStore`, `componentStore`) without selector helpers; components subscribe to entire store objects (risking unnecessary re-renders).
- Canvas directly mutates timeline state (e.g., `useExecutionTimelineStore.setState`) and embeds execution/timeline logic inside React Flow handlers.
- Execution timeline store duplicates derived data responsibilities (events → nodeStates) but is invoked imperatively from components.
- No `src/store/index.ts` to co-locate exports or memoized selectors.

### Layout & Components
- `WorkflowBuilder` composes `TopBar`, `Sidebar`, `Canvas`, timeline inspector manually; no reusable shell or layout primitives.
- Inspector resize logic is inline within `WorkflowBuilder` instead of reusable hooks.
- Bottom panel still present with timeline/log tabs even though Review inspector replaces much of that functionality.
- UI components rely on Tailwind + Radix primitives; theme tokens exist but semantic status colors are hard-coded in multiple files.

### UX & Interactions
- Alerts via `window.alert` for save/run errors instead of consistent toast system.
- Review mode toggles do not disable design-only affordances beyond drag/connect restrictions.
- Loading states for workflows/components are handled inline with booleans; no skeletons.
- Execution timeline playback loop triggers `seek` on each frame, causing store writes and potential React Flow re-renders.

### Tooling & Config
- `bun run lint` fails: ESLint 9 expects flat config (`eslint.config.js`) but repo still references legacy `.eslintrc` (missing in frontend).
- No Storybook or component preview tooling configured.

### Tests & Quality
- Store tests exist only for `executionStore` (`src/store/__tests__/executionStore.test.ts`).
- Layout/components (TopBar, BottomPanel) have tests but do not cover Review inspector flow.
- No end-to-end or integration tests for workflow creation/save/run path.

### Immediate Recommendations
1. Introduce shared store selector helpers to reduce re-render pressure (`createSelectors`).
2. Build `AppShell` layout with slots for top bar, side panels, canvas, inspector, timeline.
3. Replace alert dialogs with toast system and consolidate error handling in services.
4. Add ESLint flat config and ensure lint/typecheck/test commands run cleanly.
5. Plan Storybook (Phase 5) for complex components (Canvas, Inspector, Timeline).
