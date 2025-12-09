# Services Directory

API service layer that abstracts all backend communication and provides centralized data management.

## Core Services

### API Service (`api.ts`)
Centralized API communication layer that:
- Wraps the generated `@shipsec/backend-client` for type-safe API calls
- Centralizes backend URL configuration and authentication headers
- Validates responses using Zod schemas from `@shipsec/shared`
- Provides consistent error handling and retry logic
- Implements request/response interceptors for authentication and logging

### Authentication Service
- Handles Clerk authentication integration
- Manages organization scoping and role-based access
- Provides token refresh and session management
- Handles authentication state across the application

### Real-time Services
- **Workflow Stream Service**: WebSocket connections for live workflow status updates
- **Terminal Stream Service**: Server-Sent Events for real-time terminal output
- **Event Stream Service**: Live execution event processing and timeline updates

## Usage Patterns

### API Calls
```typescript
import { apiService } from '../services/api';

// Type-safe API calls with automatic error handling
const workflows = await apiService.getWorkflows();
const workflow = await apiService.getWorkflow('workflow-id');
const run = await apiService.createWorkflowRun('workflow-id', inputs);
```

### Real-time Updates
```typescript
import { useWorkflowStream } from '../hooks/useWorkflowStream';

// Live workflow status updates
const { data, isConnected, error } = useWorkflowStream(runId);
```

## Error Handling

All services implement consistent error handling:
- API errors are transformed to user-friendly messages
- Network errors trigger automatic retry with exponential backoff
- Authentication errors redirect to login flow
- Validation errors are displayed inline with form fields

## Data Synchronization

- React Query is used for server state synchronization
- Automatic background refetching and cache invalidation
- Optimistic updates for immediate UI feedback
- Conflict resolution for concurrent modifications

Never import axios directly in components - always use the service layer for consistent error handling and type safety.