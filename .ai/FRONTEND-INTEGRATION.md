# Frontend Integration with Backend API

## Overview

The frontend now uses a **type-safe TypeScript client** generated from the backend's OpenAPI specification. This provides full type safety, autocompletion, and compile-time validation for all API calls.

## Architecture

```
┌─────────────────┐
│    Frontend     │
│   (React App)   │
└────────┬────────┘
         │ uses
         ▼
┌─────────────────────────┐
│  @shipsec/backend-client│  ← Type-safe API wrapper
│  (OpenAPI Generated)    │
└────────┬────────────────┘
         │ HTTP calls
         ▼
┌─────────────────┐
│     Backend     │
│   (NestJS API)  │
│  + Swagger Docs │
└─────────────────┘
```

## Package: `@shipsec/backend-client`

### Files

- **`src/client.ts`** - Auto-generated TypeScript types from OpenAPI spec
- **`src/api-client.ts`** - High-level API wrapper with methods
- **`src/index.ts`** - Package exports
- **`openapi.json`** - OpenAPI specification (git-ignored, regenerated)
- **`test-client.ts`** - Integration test script

### Key Features

✅ **Fully Type-Safe**
  - Request and response types are inferred from OpenAPI spec
  - Path parameters, query parameters, and request bodies are all typed
  - TypeScript catches API misuse at compile time

✅ **Auto-Generated**
  - Types are generated using `openapi-typescript`
  - Run `bun run generate` to update types when backend changes
  - Ensures frontend always matches backend API contract

✅ **Modern Fetch API**
  - Uses `openapi-fetch` library (lightweight, no axios dependency)
  - Returns `{ data?, error? }` pattern for clear error handling
  - Supports middleware for logging, auth, etc.

### API Methods

#### Workflows
- `listWorkflows()` - Get all workflows
- `getWorkflow(id)` - Get a specific workflow
- `createWorkflow(data)` - Create new workflow
- `updateWorkflow(id, data)` - Update workflow
- `deleteWorkflow(id)` - Delete workflow
- `commitWorkflow(id)` - Compile workflow to DSL
- `runWorkflow(id)` - Execute workflow

#### Workflow Runs
- `getWorkflowRunStatus(runId, temporalRunId?)` - Get execution status
- `getWorkflowRunResult(runId, temporalRunId?)` - Get result
- `getWorkflowRunTrace(runId)` - Get execution trace
- `cancelWorkflowRun(runId, temporalRunId?)` - Cancel execution

#### Files
- `listFiles(limit?)` - List uploaded files
- `uploadFile(file)` - Upload file (multipart/form-data)
- `downloadFile(id)` - Download file (returns Blob)
- `deleteFile(id)` - Delete file
- `getFileMetadata(id)` - Get file metadata

#### Components
- `listComponents()` - Get all available components
- `getComponent(id)` - Get component details

### Usage Example

```typescript
import { createShipSecClient } from '@shipsec/backend-client';

// Create client
const client = createShipSecClient({
  baseUrl: 'http://localhost:3000',
});

// Make type-safe API calls
const response = await client.listWorkflows();

if (response.error) {
  console.error('API error:', response.error);
  return;
}

// TypeScript knows response.data is defined here
console.log('Workflows:', response.data);
```

## Frontend Integration

### Updated Files

**`frontend/src/services/api.ts`**
- Replaced axios with `@shipsec/backend-client`
- All existing API methods now use the type-safe client
- Added transformation layer between frontend Node format and backend API format
- Added new `files` API section

**`frontend/package.json`**
- Added `@shipsec/backend-client` workspace dependency
- Removed direct axios usage in favor of the client

### Data Transformation

The frontend uses React Flow's node format, which differs from the backend's simpler format:

**Frontend Node (React Flow)**
```typescript
{
  id: 'n1',
  type: 'input',
  position: { x: 0, y: 0 },
  data: {
    label: 'File Loader',
    componentSlug: 'core.file.loader',
    parameters: { fileId: '123' },
    // ... other React Flow data
  }
}
```

**Backend Node (API)**
```typescript
{
  id: 'n1',
  type: 'core.file.loader',
  label: 'File Loader',
  position: { x: 0, y: 0 },
  config: { fileId: '123' }
}
```

The `api.ts` service handles this transformation automatically.

## Regenerating the Client

When the backend API changes:

```bash
# 1. Make sure backend is running
cd backend && bun run dev

# 2. Regenerate the client
cd packages/backend-client
bun run generate

# 3. Verify types across the monorepo
cd ../..
bun run typecheck
```

The `generate` script will:
1. Fetch the latest OpenAPI spec from `http://localhost:3000/docs-json`
2. Generate TypeScript types using `openapi-typescript`
3. Update `src/client.ts` with new types

## Testing

### Integration Test

Run the full API client integration test:

```bash
cd packages/backend-client
bun run test-client.ts
```

This tests:
- ✅ Health check
- ✅ List components (found 4)
- ✅ List workflows
- ✅ Create workflow
- ✅ Get workflow
- ✅ Delete workflow
- ⏭️  Update workflow (skipped due to validation issue)

### Frontend E2E

Start the full stack:

```bash
# Terminal 1: Backend + Worker
pm2 start pm2.config.cjs

# Terminal 2: Frontend
cd frontend && bun run dev
```

Visit `http://localhost:5173` and verify:
- Workflow list loads
- Can create new workflow
- Can open workflow editor
- Components list loads in sidebar

## Known Issues

1. **Workflow Update Validation**
   - The PUT `/workflows/:id` endpoint has a validation issue with nestjs-zod
   - Workaround: Use POST (create) followed by DELETE (old) for now
   - Backend logs show: "Invalid input: expected object, received string"
   - Root cause: ZodValidationPipe may be misconfigured

## Benefits

✅ **Type Safety** - Catch API errors at compile time, not runtime
✅ **Developer Experience** - Full IntelliSense/autocompletion for API calls  
✅ **Maintainability** - Single source of truth (OpenAPI spec)
✅ **Documentation** - API types serve as inline documentation
✅ **Refactoring** - Breaking changes to API are caught immediately
✅ **Testing** - Easy to mock with typed interfaces

## Future Improvements

- [ ] Add request/response logging middleware
- [ ] Add authentication token handling
- [ ] Add automatic retry logic for failed requests
- [ ] Generate React Query hooks from OpenAPI spec
- [ ] Add WebSocket support for real-time updates
- [ ] Fix workflow update validation issue

