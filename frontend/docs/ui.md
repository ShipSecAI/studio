# Frontend UI Conventions

ShipSec Studio’s UI is composed of three primary layers: layout scaffolding, workflow canvas primitives, and a shadcn-based component library. Use this guide when adding new surfaces or extending the canvas.

## Layout Skeleton
- `src/components/layout/TopBar.tsx` – Navigation + run/save controls. Keep it dumb; business logic belongs in stores/hooks.
- `src/components/layout/Sidebar.tsx` – Component catalogue browser. Pull metadata through `useComponentStore`.
- `src/components/layout/BottomPanel.tsx` – Tabs for Logs, Results, and History. Connects to execution/timeline stores.
- `src/components/timeline/*` – Run history timeline cards and filters.

Keep layout components stateless and rely on Zustand selectors to avoid re-renders.

## Workflow Canvas
- `src/components/workflow/Canvas.tsx` orchestrates React Flow nodes/edges, selection state, and drop handlers.
- Node rendering (`WorkflowNode.tsx`) defers status colouring to `nodeStyles.ts` so badges stay consistent.
- Configuration UI lives in `ConfigPanel.tsx` and `ParameterField.tsx`. Parameter metadata comes from backend component definitions.
- Runtime input surfaces (`RuntimeInputsEditor.tsx`, `RunWorkflowDialog.tsx`) read schema hints from the selected workflow definition.

When introducing new node visuals, extend `nodeStyles.ts` first and keep Lucide icons + Tailwind tokens centralized.

## UI Component Library
- Shared primitives sit under `src/components/ui` and follow shadcn patterns (component + `*.styles.ts` when necessary).
- Tailwind tokens rely on CSS variables defined in `src/index.css`. Do not hard-code colours—introduce a new variable instead.
- Use `tailwind-merge` helpers for conditional classnames.

## Accessibility & UX
- All actionable elements require focus styles. Reuse existing `buttonVariants`/`badgeVariants`.
- Provide aria labels for icon-only buttons (see `ComponentBadge.tsx` for reference).
- The canvas should remain keyboard navigable: ensure tab index is maintained when adding overlays or drawers.

## Visual Testing Checklist
Before shipping UI changes:
1. `bun --cwd frontend run lint` (includes Tailwind ordering rules).
2. `bun --cwd frontend run test` – ensure component snapshots/hooks pass.
3. Manual run through: load workflow, execute, verify logs stream and timeline updates.
4. Update screenshots or add a brief “Validation” note in the PR if behaviour changes.

Cross-link any structural change back to `docs/guide.md` so other teams can find the latest UX decisions.
