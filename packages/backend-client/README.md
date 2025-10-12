# ShipSec Backend Client

Type-safe TypeScript client for the ShipSec API, auto-generated from OpenAPI specification.

## Installation

This package is part of the ShipSec monorepo. Install dependencies from the root:

```bash
bun install
```

## Usage

```typescript
import { createShipSecClient } from '@shipsec/backend-client';

// Create client instance
const client = createShipSecClient({
  baseUrl: 'http://localhost:3001',
});

// Make API calls with full type safety
const workflows = await client.listWorkflows();
const workflow = await client.getWorkflow('workflow-id');
const newWorkflow = await client.createWorkflow({
  name: 'My Workflow',
  description: 'A security scan workflow',
  nodes: [...],
  edges: [...],
  viewport: { x: 0, y: 0, zoom: 1 },
});
```

## Regenerating the Client

When the backend API changes, regenerate the client types:

```bash
# From the packages/backend-client directory
bun run generate
```

This will:
1. Fetch the latest OpenAPI spec from the running backend
2. Generate TypeScript types using `openapi-typescript`

**Note:** Make sure the backend is running before regenerating the client.

## API Methods

### Workflows
- `listWorkflows()` - Get all workflows
- `getWorkflow(id)` - Get a specific workflow
- `createWorkflow(data)` - Create a new workflow
- `updateWorkflow(id, data)` - Update a workflow
- `deleteWorkflow(id)` - Delete a workflow
- `commitWorkflow(id)` - Compile workflow to DSL
- `runWorkflow(id)` - Execute a workflow

### Workflow Runs
- `getWorkflowRunStatus(runId)` - Get run status
- `getWorkflowRunResult(runId)` - Get run result
- `getWorkflowRunTrace(runId)` - Get execution trace
- `cancelWorkflowRun(runId)` - Cancel a running workflow

### Files
- `listFiles()` - List all uploaded files
- `uploadFile(file)` - Upload a file
- `downloadFile(id)` - Download a file (returns Blob)
- `deleteFile(id)` - Delete a file
- `getFileMetadata(id)` - Get file metadata

### Components
- `listComponents()` - Get all available components
- `getComponent(id)` - Get component details

## Type Safety

All responses are fully typed based on the OpenAPI specification. The client uses `openapi-fetch` which provides:

- ✅ Full TypeScript type inference
- ✅ Request/response validation
- ✅ Path parameter type checking
- ✅ Query parameter type checking
- ✅ Request body type checking

## Error Handling

All methods return `{ data?, error? }` objects:

```typescript
const response = await client.getWorkflow('123');

if (response.error) {
  console.error('API Error:', response.error);
  return;
}

// TypeScript knows data is available here
console.log(response.data);
```


