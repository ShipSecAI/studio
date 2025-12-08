# Hooks Directory

Custom React hooks for reusable state logic and side effects.

## Real-time Hooks

- **useTerminalStream.ts** - Server-Sent Events for real-time terminal output
- **useTimelineTerminalStream.ts** - Terminal playback synchronized to timeline position
- **useWorkflowStream.ts** - WebSocket connections for live workflow status updates
- **useEventStream.ts** - Execution event processing and timeline generation

## API Hooks

- **useWorkflows.ts** - Workflow CRUD operations and caching
- **useWorkflowRuns.ts** - Workflow run execution and status tracking
- **useComponents.ts** - Component catalog and metadata
- **useFiles.ts** - File upload, download, and management
- **useSecrets.ts** - Secrets management and credential access

## UI Hooks

- **useDebounce.ts** - Input debouncing for search and filtering
- **useLocalStorage.ts** - Local storage persistence
- **useKeyboardShortcuts.ts** - Global keyboard shortcut handling
- **useModal.ts** - Modal state management
- **useToast.ts** - Toast notification system

## Real-time Data Flow

```typescript
// Terminal streaming with timeline synchronization
const { chunks, isConnected, error } = useTimelineTerminalStream(runId, timelinePosition);

// Live workflow status updates
const { run, isRunning, progress } = useWorkflowStream(runId);

// Event-driven timeline updates
const { events, timeline } = useEventStream(runId);
```

## Best Practices

- Implement proper cleanup in useEffect hooks
- Handle connection errors and reconnection logic
- Use React Query for API data synchronization
- Debounce user inputs to prevent excessive API calls
- Implement loading and error states for all async operations
- Use TypeScript generics for reusable hook logic