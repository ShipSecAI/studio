# Features Directory

Feature-specific modules that encapsulate related components, hooks, and business logic.

## Feature Modules

- **auth** - Authentication, user management, and organization access
- **workflows** - Workflow creation, editing, and execution
- **terminal** - Real-time terminal display and streaming
- **timeline** - Execution timeline visualization and controls
- **secrets** - Secrets management and credential handling
- **integrations** - OAuth connections and third-party services
- **artifacts** - File management and artifact browser

## Feature Module Structure

Each feature module follows this organization:
```
feature/
├── components/     # Feature-specific UI components
├── hooks/         # Feature-specific custom hooks
├── services/      # Feature API calls and data logic
├── types/         # Feature-specific TypeScript types
├── utils/         # Feature helpers and utilities
└── index.ts       # Public exports
```

## Benefits

- **Encapsulation**: Related functionality is grouped together
- **Scalability**: Features can be developed and tested independently
- **Reusability**: Cross-cutting concerns are properly separated
- **Maintainability**: Clear boundaries between different application areas

## Usage Example

```typescript
// Import from feature module
import { useTerminalStream } from '../features/terminal';
import { TerminalPanel } from '../features/terminal/components';

// Use feature components and hooks
const { output, isConnected } = useTerminalStream(runId);
return <TerminalPanel output={output} />;
```

This approach keeps the application organized and makes features easier to develop, test, and maintain.