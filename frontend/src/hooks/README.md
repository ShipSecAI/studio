# Hooks Directory

Custom React hooks for reusable state logic and side effects.

## Query Hooks (`queries/`)

**All server-state data fetching uses TanStack Query hooks.** See `frontend/docs/state.md` for the full pattern.

| File                       | Hooks                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `useComponentQueries.ts`   | `useComponents` — Component catalogue with slug/id index                                                                                 |
| `useWorkflowQueries.ts`    | `useWorkflowsList`, `useWorkflowsSummary`, `useWorkflow`, `useWorkflowRuntimeInputs` — Workflow metadata, detail + inputs                |
| `useScheduleQueries.ts`    | `useSchedules`, `useCreateSchedule`, `useUpdateSchedule`, `usePauseSchedule`, `useResumeSchedule`, `useRunSchedule`, `useDeleteSchedule` |
| `useWebhookQueries.ts`     | `useWebhooks`, `useWebhook`, `useWebhookDeliveries`, `useCreateWebhook`, `useUpdateWebhook`, `useDeleteWebhook`                          |
| `useSecretQueries.ts`      | `useSecrets` — Secret summaries                                                                                                          |
| `useApiKeyQueries.ts`      | `useApiKeys` — API key management                                                                                                        |
| `useMcpGroupQueries.ts`    | `useMcpGroups`, `useMcpGroupServers`, `useMcpGroupTemplates`, `useSyncMcpGroupTemplates`                                                 |
| `useHumanInputQueries.ts`  | `useHumanInputs`, `useInvalidateHumanInputs` — Action center                                                                             |
| `useExecutionQueries.ts`   | `useExecutionNodeIO`, `useExecutionResult`, `useExecutionRun` — Execution data                                                           |
| `useRunQueries.ts`         | `useRuns`, `useRunDetail`                                                                                                                |
| `useArtifactQueries.ts`    | `useArtifactLibrary`, `useRunArtifacts`                                                                                                  |
| `useIntegrationQueries.ts` | `useIntegrationProviders`, `useIntegrationConnections`, `useProviderConfig`                                                              |

### Adding a New Query Hook

1. Add query keys to `src/lib/queryKeys.ts`
2. Create `src/hooks/queries/use<Domain>Queries.ts`
3. Export `use<Domain>` for reads (wraps `useQuery`)
4. Export `use<Action><Domain>` for writes (wraps `useMutation` + invalidates cache)
5. Import and use in your component — never call `api.*` directly in components

## Prefetch Hook

- **usePrefetchOnIdle.ts** — Warms TanStack Query cache during browser idle time. Called once in `AppLayout`. Add high-traffic queries here for instant page loads.

## Real-time Hooks

- **useTerminalStream.ts** — Server-Sent Events for real-time terminal output
- **useTimelineTerminalStream.ts** — Terminal playback synchronized to timeline position
- **useWorkflowStream.ts** — WebSocket connections for live workflow status updates
- **useEventStream.ts** — Execution event processing and timeline generation

## UI Hooks

- **useDebounce.ts** — Input debouncing for search and filtering
- **useLocalStorage.ts** — Local storage persistence
- **useKeyboardShortcuts.ts** — Global keyboard shortcut handling

## Best Practices

- Use TanStack Query hooks for all API data — never `useState` + `useEffect` for fetching
- Implement proper cleanup in useEffect hooks (real-time streams only)
- Use `useMemo` to derive/filter/transform data from query hooks
- Debounce user inputs to prevent excessive API calls
- Use TypeScript generics for reusable hook logic
