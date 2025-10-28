# ShipSec Studio Architecture

## Overview

ShipSec Studio is a component-based security workflow orchestration platform built with:
- **Frontend**: React (workflow builder)
- **Backend**: NestJS on Bun (REST API, workflow management)
- **Worker**: Node.js + Temporal.io (workflow execution)
- **Storage**: PostgreSQL + MinIO
- **Orchestration**: Temporal.io cluster

## Monorepo Structure

```
shipsec-studio/
├── packages/
│   ├── component-sdk/          # 🎯 Pure component definition SDK
│   │   └── src/
│   │       ├── interfaces.ts   # Service interfaces (IFileStorageService, etc.)
│   │       ├── types.ts        # ComponentDefinition, ExecutionContext
│   │       ├── registry.ts     # Singleton component registry
│   │       ├── context.ts      # ExecutionContext factory
│   │       └── runner.ts       # Component execution logic
│   │
│   └── backend-client/         # Generated TypeScript client for backend API
│
├── worker/                     # 🔧 Temporal worker (Node.js + tsx)
│   └── src/
│       ├── components/         # Component implementations
│       │   ├── core/           # file-loader, trigger-manual, webhook
│       │   └── security/       # subfinder, etc.
│       ├── adapters/           # Service interface implementations
│       │   ├── file-storage.adapter.ts  # MinIO + PostgreSQL
│       │   └── trace.adapter.ts         # In-memory trace collector
│       └── temporal/
│           ├── workflows/      # Temporal workflow definitions
│           ├── activities/     # runComponentActivity, setRunMetadataActivity, finalizeRunActivity
│           └── workers/        # dev.worker.ts
│
├── backend/                    # 🌐 REST API (NestJS on Bun)
│   └── src/
│       ├── workflows/          # Workflow CRUD + compilation
│       ├── storage/            # File upload/download API
│       ├── integrations/       # OAuth provider orchestration & token vault
│       ├── components/         # Component listing API
│       ├── dsl/                # Graph → DSL compiler
│       ├── temporal/           # Temporal client (start/query workflows)
│       └── database/           # PostgreSQL schemas
│
└── frontend/                   # ⚛️ React workflow builder
    └── src/
        ├── components/         # Canvas, node editor
        └── hooks/              # API integration
```

## Key Concepts

### 1. Component SDK (`packages/component-sdk`)

**Purpose**: Framework-agnostic component definition system

**Key Files**:
- `interfaces.ts` - Defines service contracts that components depend on:
  ```typescript
  interface IFileStorageService {
    downloadFile(id: string): Promise<{buffer: Buffer, metadata: {...}}>;
  }
  ```
- `types.ts` - Core types:
  ```typescript
  interface ComponentDefinition<I, O> {
    id: string;
    category: 'trigger' | 'input' | 'discovery' | 'transform' | 'output';
    runner: RunnerConfig;
    inputSchema: z.ZodType<I>;
    outputSchema: z.ZodType<O>;
    execute: (params: I, context: ExecutionContext) => Promise<O>;
  }
  
  interface ExecutionContext {
    runId: string;
    componentRef: string;
    logger: Logger;
    emitProgress: (message: string) => void;
    storage?: IFileStorageService;    // Injected at runtime
    secrets?: ISecretsService;        // Injected at runtime
    artifacts?: IArtifactService;     // Injected at runtime
    trace?: ITraceService;            // Injected at runtime
  }
  ```
- `registry.ts` - Singleton registry:
  ```typescript
  export const componentRegistry = new ComponentRegistry();
  ```

**Why Separate**: 
- Backend can import for validation without heavy dependencies
- Components are portable and testable (mock interfaces)
- Clean contracts between execution layer and business logic

### 2. Worker Package (`worker/`)

**Purpose**: Executes workflows by running components with real services

**Runtime**: Node.js with tsx (Bun incompatible with Temporal.io workers)

**Architecture**:

#### Components (`worker/src/components/`)
Component implementations that register themselves:
```typescript
// worker/src/components/core/file-loader.ts
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const definition: ComponentDefinition = {
  id: 'core.file.loader',
  async execute(params, context) {
    const storage = context.storage; // IFileStorageService interface
    const {buffer, metadata} = await storage.downloadFile(params.fileId);
    return {content: buffer.toString('base64')};
  }
};

componentRegistry.register(definition);
```

#### Adapters (`worker/src/adapters/`)
Concrete implementations of SDK interfaces:
```typescript
// worker/src/adapters/file-storage.adapter.ts
class FileStorageAdapter implements IFileStorageService {
  constructor(private minioClient: Client, private db: Database) {}
  
  async downloadFile(fileId: string) {
    const file = await this.db.query('SELECT * FROM files WHERE id = $1', [fileId]);
    const stream = await this.minioClient.getObject(bucket, file.objectKey);
    return {buffer, metadata};
  }
}
```

#### Temporal Worker (`worker/src/temporal/workers/dev.worker.ts`)
```typescript
// Initialize real services
const minioClient = new Client({...});
const db = drizzle(pool);

// Create adapters
const storageAdapter = new FileStorageAdapter(minioClient, db);
const traceAdapter = new TraceAdapter(db);
const secretsAdapter = new SecretsAdapter(db);
const logAdapter = new LokiLogAdapter(new LokiLogClient({ baseUrl: process.env.LOKI_URL! }), db);

// Inject into activities
initializeComponentActivityServices({
  storage: storageAdapter, 
  trace: traceAdapter, 
  logs: logAdapter, 
  secrets: secretsAdapter
});

// Start worker
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  workflowsPath,
  activities: {
    runComponentActivity,
    setRunMetadataActivity,
    finalizeRunActivity,
  },
});
```

### 3. Backend Package (`backend/`)

**Purpose**: REST API for frontend, workflow orchestration

**Runtime**: Bun (fast HTTP server)

**Key Responsibilities**:
1. Accept workflow graphs from frontend
2. Validate nodes against component registry
3. Compile graphs into DSL (topologically sorted actions)
4. Store workflow metadata in PostgreSQL
5. Start workflows on Temporal via `TemporalService`
6. Serve file uploads/downloads via MinIO
7. List available components from registry

**Key Services**:
- `WorkflowsService` - CRUD + compilation + Temporal integration
- `FilesService` - File upload/download/metadata
- `TemporalService` - Temporal client wrapper
- `DSLCompiler` - Graph → DSL transformation
- `IntegrationsService` - OAuth orchestration + encrypted token vault (new)

#### IntegrationsModule (OAuth connections)

- Backed by `integration_tokens` (encrypted access/refresh tokens) and `integration_oauth_states` tables for state validation.
- Supports provider-specific OAuth metadata (`integration-providers.ts`) with GitHub and Zoom pre-configured. Scopes are deduplicated and PKCE is applied where required.
- REST endpoints:
  - `GET /integrations/providers` – provider catalog for the UI
  - `POST /integrations/:provider/start` – generate authorization URL + save state
  - `POST /integrations/:provider/exchange` – exchange code, encrypt tokens, upsert connection
  - `POST /integrations/connections/:id/refresh` – refresh with stored refresh token
  - `DELETE /integrations/connections/:id` – revoke connection
- `TokenEncryptionService` wraps AES-GCM with `INTEGRATION_STORE_MASTER_KEY` (falls back to `SECRET_STORE_MASTER_KEY`) so all credentials at rest remain encrypted.
- `IntegrationsService.getProviderToken(provider, userId)` gives backend components/activities a single entry point to retrieve valid access tokens; it auto-refreshes near-expiry tokens before returning them.

**Frontend surface**: `/integrations` mirrors the Secrets manager. `IntegrationsManager` lists providers, shows active connections, and launches OAuth flows. `/integrations/callback/:provider` handles redirects, exchanges the code via the API, dispatches a `integration:connected` event, and routes back to the manager with status feedback.

## Workflow Execution Flow

```
1. Frontend creates workflow graph
   └─> POST /workflows with nodes & edges

2. Backend receives graph
   └─> Validates nodes against componentRegistry (@shipsec/component-sdk)
   └─> Compiles graph → DSL (topologically sorted actions)
   └─> Saves to PostgreSQL
   └─> Calls TemporalService.startWorkflow()

3. Temporal Server receives workflow start request
   └─> Schedules workflow task on queue "shipsec-default"

4. Worker polls Temporal queue
   └─> Picks up workflow task
   └─> Executes shipsecWorkflowRun() workflow function

5. Workflow orchestrates component execution by calling runComponentActivity() for each component
   └─> Each component execution uses the same runComponentActivity
   └─> Activity receives componentId and parameters
   └─> Looks up component in registry by componentId
   └─> Creates ExecutionContext with injected services
   └─> Runs component.execute(params, context)
   └─> Component uses context.storage.downloadFile(...)

6. Results flow back
   └─> Activity completes with outputs
   └─> Workflow continues to next component or completes
   └─> Backend polls Temporal for result
   └─> Frontend displays result
```

## Dependency Injection Pattern

**Problem**: Components need services (storage, secrets) but shouldn't depend on concrete implementations (MinIO, PostgreSQL).

**Solution**: Interface-based dependency injection

```typescript
// 1. SDK defines interface (contract)
interface IFileStorageService {
  downloadFile(id: string): Promise<{buffer: Buffer, metadata: {...}}>;
}

// 2. Component uses interface (no concrete dependency)
const fileLoader: ComponentDefinition = {
  async execute(params, context) {
    const storage = context.storage; // IFileStorageService
    return await storage.downloadFile(params.fileId);
  }
}

// 3. Worker provides implementation (adapter pattern)
class FileStorageAdapter implements IFileStorageService {
  constructor(private minioClient, private db) {}
  async downloadFile(id) { /* MinIO + PostgreSQL logic */ }
}

// 4. Worker injects at runtime
const adapter = new FileStorageAdapter(minioClient, db);
const context = createExecutionContext({
  storage: adapter, // Injected!
});
```

**How injection happens during execution**:
- Activities receive service adapters during worker initialization via `initializeComponentActivityServices`
- Each component execution gets an ExecutionContext with injected services
- Single activity (`runComponentActivity`) handles all component types dynamically using the componentId to look up the right component in the registry

**Benefits**:
- ✅ Components are portable and testable (mock interfaces)
- ✅ Adapters can be swapped (MinIO → S3, PostgreSQL → MongoDB)
- ✅ Backend can import components for validation without MinIO/DB

## Running the System

```bash
# Start infrastructure (Temporal, PostgreSQL, MinIO, Loki via docker-compose)
docker compose up -d

# Start backend + worker + frontend (via PM2)
bun run dev:stack

# Or start services individually
pm2 start pm2.config.cjs  # starts backend and worker
cd frontend && bun dev    # starts frontend dev server
```

## Development Workflow

```bash
# Typecheck all packages
cd backend && bun run typecheck
cd ../worker && bun run typecheck
cd ../packages/component-sdk && bun run typecheck

# Run tests
cd backend && bun test
cd ../worker && bun test

# Add new component
# 1. Create worker/src/components/<category>/<name>.ts
# 2. Import in worker/src/components/index.ts
# 3. Register with componentRegistry.register(definition)
```

## Package Dependencies

```
frontend
  └─> @shipsec/backend-client

backend
  ├─> @shipsec/component-sdk (validation)
  └─> @shipsec/worker (component listing)

worker
  ├─> @shipsec/component-sdk (SDK types + registry)
  └─> @shipsec/shared (execution schemas and types)

component-sdk
  └─> (zod only - zero runtime dependencies)

shared
  └─> (zod, TypeScript types for execution contracts)
```

## Future Enhancements

- [ ] Docker runner implementation (currently stubbed)
- [ ] Remote runner for distributed execution
- [x] Secrets management service (completed: SecretsAdapter with PostgreSQL backend)
- [x] Artifact storage service (completed: IArtifactService interface implemented)
- [x] Real-time trace streaming via WebSockets (completed: ITraceService with TraceAdapter)
- [ ] Component marketplace
