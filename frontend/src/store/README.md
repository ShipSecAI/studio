# Store Directory

State management using Zustand for frontend application state.

## Store Files

- **executionTimelineStore.ts** - Timeline state for workflow execution visualization
- **workflowStore.ts** - Current workflow editor state (nodes, edges, viewport)
- **authStore.ts** - Authentication and user session state
- **uiStore.ts** - Global UI state (modals, sidebars, theme)

## State Management Pattern

### Zustand Stores
- Lightweight, simple state management
- TypeScript-first with proper type safety
- Selectors for derived state
- Actions for state mutations
- Subscribe to specific state slices

### Timeline Store Features
- Event-based timeline state management
- Node status tracking (pending, running, completed, failed)
- Playback position and speed control
- Real-time event processing and visualization

### Usage Example
```typescript
import { useExecutionTimelineStore } from '../store/executionTimelineStore';

const { events, currentNode, isPlaying, setPosition } = useExecutionTimelineStore();

// Subscribe to specific state
const currentEvent = useExecutionTimelineStore(state =>
  state.events.find(e => e.nodeRef === currentNode)
);
```

## Best Practices

- Keep stores focused on specific domains
- Use TypeScript interfaces for state shape
- Implement proper state selectors to prevent unnecessary re-renders
- Separate actions from state mutations
- Use middleware for logging and persistence when needed