# Store Directory

Zustand state management stores organized by domain:

- **workflowStore.ts** - Workflow data and operations
- **uiStore.ts** - UI preferences and theme settings
- **executionStore.ts** - Execution state and logs

Each store follows single responsibility principle. Use local state (useState) for component-specific state.