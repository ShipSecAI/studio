# Store Directory

Client-only UI state management using Zustand.

> **Server state (API data) does NOT belong here.** Use TanStack Query hooks in `src/hooks/queries/` instead. See `frontend/docs/state.md` for the decision guide.

## Store Files

- **workflowStore.ts** — Current workflow editor state (nodes, edges, viewport)
- **workflowUiStore.ts** — Canvas UI toggles, panel sizing, minimap state
- **executionStore.ts** — Workflow run lifecycle, SSE stream wiring, log/event aggregation
- **executionTimelineStore.ts** — Timeline playback state, selected run/node
- **authStore.ts** — Authentication and user session state (used by `queryKeys.ts` for org scoping)

## When to Use Zustand vs TanStack Query

| Data source                            | Tool                                       |
| -------------------------------------- | ------------------------------------------ |
| Backend API response                   | TanStack Query hook (`src/hooks/queries/`) |
| UI-only state shared across components | Zustand store (this directory)             |
| UI-only state scoped to one component  | Local `useState`                           |

## Usage Example

```typescript
import { useExecutionTimelineStore } from '../store/executionTimelineStore';

const { events, currentNode, isPlaying, setPosition } = useExecutionTimelineStore();

// Subscribe to specific state slice to prevent unnecessary re-renders
const currentEvent = useExecutionTimelineStore((state) =>
  state.events.find((e) => e.nodeRef === currentNode),
);
```

## Best Practices

- Keep stores focused on client-only UI concerns
- Never store API data in Zustand — use TanStack Query instead
- Use TypeScript interfaces for state shape
- Use selectors to subscribe to specific slices and prevent unnecessary re-renders
- Separate actions from state mutations
