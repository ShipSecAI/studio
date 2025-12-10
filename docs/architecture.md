# ShipSec Studio Architecture

## Overview

ShipSec Studio is a component-based security workflow orchestration platform designed for security teams to build, execute, and monitor reconnaissance workflows. The system combines visual workflow building with a robust execution backend.

**Core Architecture Pattern:**
```
Frontend (React 19) ←→ Backend (NestJS) ←→ Temporal ←→ Worker (Node.js)
     ↓                    ↓                      ↓                  ↓
  Visual Builder      REST API              Workflow           Component
  & Timeline          & Auth                Orchestration        Execution
```

**Technology Stack:**
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI, ReactFlow, xterm.js
- **Backend**: NestJS, TypeScript, Bun runtime, PostgreSQL, Drizzle ORM, Clerk Auth
- **Worker**: Node.js, TypeScript, Temporal.io, Docker containers
- **Infrastructure**: PostgreSQL, Temporal, MinIO, Redis, Loki, Redpanda (Kafka)

## Monorepo Structure

```
shipsec-studio/
├── packages/
│   ├── component-sdk/          # 🎯 Framework-agnostic component SDK
│   │   └── src/
│   │       ├── interfaces.ts   # Service contracts (storage, secrets, trace)
│   │       ├── types.ts        # ComponentDefinition, ExecutionContext
│   │       ├── registry.ts     # Singleton component registry
│   │       ├── context.ts      # ExecutionContext factory
│   │       ├── terminal.ts     # Terminal streaming utilities
│   │       └── runner.ts       # Component execution logic
│   │
│   ├── backend-client/         # Generated TypeScript API client
│   └── shared/                 # Shared types and schemas

├── worker/                     # 🔧 Component execution engine (Node.js)
│   └── src/
│       ├── components/         # Security component implementations
│       │   ├── core/           # file-loader, trigger-manual, webhook
│       │   └── security/       # subfinder, dnsx, nmap, httpx, etc.
│       ├── adapters/           # Service interface implementations
│       │   ├── file-storage.adapter.ts  # MinIO + PostgreSQL
│       │   ├── kafka-log.adapter.ts     # Kafka logging transport
│       │   ├── loki-log.adapter.ts      # Loki log aggregation
│       │   ├── kafka-trace.adapter.ts   # Event streaming
│       │   └── terminal-stream.adapter.ts # Terminal streaming
│       └── temporal/
│           ├── workflows/      # Workflow orchestration logic
│           ├── activities/     # Component execution activities
│           └── workers/        # dev.worker.ts

├── backend/                    # 🌐 REST API and orchestration (NestJS)
│   └── src/
│       ├── workflows/          # Workflow CRUD + compilation
│       ├── storage/            # File upload/download API
│       ├── secrets/            # Encrypted secrets management
│       ├── integrations/       # OAuth provider orchestration
│       ├── components/         # Component registry API
│       ├── trace/              # Event management and timeline
│       ├── logging/            # Log ingestion service
│       ├── events/             # Event processing service
│       └── temporal/           # Temporal client wrapper

└── frontend/                   # ⚛️ React workflow builder with timeline
    └── src/
        ├── components/
        │   ├── workflow-builder/  # ReactFlow visual editor
        │   ├── terminal/          # Real-time terminal display (xterm.js)
        │   └── timeline/          # Execution timeline
        ├── store/                 # Zustand state management
        └── hooks/                 # API and real-time hooks
```

## Core System Components

### 1. Component SDK (`packages/component-sdk`)

**Purpose**: Framework-agnostic component definition system with zero runtime dependencies (except Zod).

**Key Interfaces**:
```typescript
interface ComponentDefinition<Input, Output> {
  id: string;
  label: string;
  category: 'triggers' | 'discovery' | 'transform' | 'output';
  runner: DockerRunnerConfig | InlineRunnerConfig;
  inputSchema: ZodSchema<Input>;
  outputSchema: ZodSchema<Output>;
  execute: (input: Input, context: ExecutionContext) => Promise<Output>;
}

interface IFileStorageService {
  upload(buffer: Buffer, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

interface ISecretsService {
  getSecret(secretId: string): Promise<string>;
  rotateSecret(secretId: string, newValue: string): Promise<void>;
}

interface ITraceService {
  record(event: TraceEvent): Promise<void>;
  setRunMetadata(runId: RunMetadata): void;
  finalizeRun(runId: string): void;
}
```

**Component Categories**:
- **Triggers**: Manual, schedule, webhook, file monitor
- **Discovery**: Subfinder, DNSx, Nmap, HTTPx, Katana
- **Transform**: JSON/CSV/text processing and data enrichment
- **Output**: Email, Slack, file export, database storage

### 2. Logging Infrastructure

The system implements a sophisticated three-pipeline logging architecture:

#### Terminal Streaming Pipeline
Real-time terminal output capture and delivery:
- **Capture**: Docker container output captured as base64-encoded chunks with monotonic timestamps
- **Transport**: Redis Streams for real-time streaming with pattern `terminal:{runId}:{nodeRef}:{stream}`
- **Structure**: Each chunk includes sequence number, delta timing, and metadata
- **Memory Management**: MAXLEN policy (5000 entries) with automatic eviction
- **Ordering**: Redis stream IDs provide microsecond-precise chronological ordering

**Frontend Terminal Display**:
- xterm.js integration renders real-time terminal output
- Timeline synchronization allows seeking to specific execution points
- Base64 decoding and terminal formatting for proper display
- Live/replay mode switching with cursor-based navigation

#### Log Streaming Architecture
Structured log transport and persistence:
- **Sources**: Component stdout/stderr and console logs
- **Multi-transport**: Kafka for streaming, Loki for aggregation, PostgreSQL for metadata
- **Structure**: JSON log entries with level, timestamp, node metadata, and correlation IDs
- **Backend Processing**: Log ingestion service validates, enriches, and persists logs
- **Query Interface**: Frontend can query logs by run ID, node, time range, and level

#### Event Streaming Pipeline
Workflow lifecycle event tracking:
- **Event Types**: NODE_STARTED, NODE_COMPLETED, NODE_FAILED, NODE_PROGRESS
- **Transport**: Kafka-based event streaming with per-run sequence numbering
- **Structure**: Events include run context, node references, timestamps, and optional data payloads
- **Timeline Generation**: Frontend processes event sequences to create visual execution timeline
- **Real-time Updates**: Events flow through Kafka → Backend → WebSocket to update live timeline

### 3. Worker Architecture

**Purpose**: Executes components in isolated environments with real service implementations.

**Component Execution**:
```typescript
async function runComponentActivity(
  componentId: string,
  input: unknown,
  context: ActivityContext
): Promise<unknown> {
  const component = componentRegistry.getComponent(componentId);
  const executionContext = createExecutionContext({
    storage: globalStorage,
    secrets: allowSecrets ? globalSecrets : undefined,
    artifacts: scopedArtifacts,
    trace: globalTrace,
    logCollector: globalLogs,
    terminalCollector: globalTerminal,
  });

  return await component.execute(input, executionContext);
}
```

**Service Adapters**:
- **File Storage**: MinIO integration with PostgreSQL metadata
- **Secrets**: HashiCorp Vault with AES-256 encryption
- **Tracing**: Redis/pubsub for real-time events
- **Logging**: Kafka, Loki, and database persistence
- **Terminal**: Redis streams for real-time output

### 4. Backend Services

**Core Modules**:
- **WorkflowsModule**: Workflow CRUD, compilation, Temporal integration
- **AuthModule**: Clerk-based authentication and multi-tenancy
- **SecretsModule**: Encrypted secrets management with versioning
- **IntegrationsModule**: OAuth orchestration and token vault
- **TraceModule**: Event management and timeline generation
- **LoggingModule**: Log ingestion and processing

**Key API Endpoints**:
- `POST /api/v1/workflows` - Create and compile workflows
- `POST /api/v1/workflows/{id}/runs` - Execute workflows
- `GET /api/v1/runs/{runId}/terminal` - Get terminal chunks
- `GET /api/v1/runs/{runId}/logs` - Get execution logs
- `GET /api/v1/runs/{runId}/events` - Get trace events
- `GET /api/v1/runs/{runId}/stream` - SSE streaming endpoint

### 5. Frontend Architecture

**Real-time Features**:
- **Visual Builder**: ReactFlow-based workflow editor with drag-and-drop
- **Terminal Display**: xterm.js integration for real-time terminal output
- **Execution Timeline**: Zustand-based timeline state with event synchronization
- **Live Updates**: WebSocket/SSE streaming for real-time status updates

**State Management**:
- **Timeline Store**: Zustand for execution timeline state
- **API State**: React Query for server state management
- **Component State**: Local React state with hooks

## Workflow Execution and Replay

### Live Workflow Execution
```
1. Frontend creates workflow graph (ReactFlow)
   └─> POST /api/v1/workflows with nodes & edges

2. Backend validates and compiles
   └─> Validates nodes against componentRegistry
   └─> Compiles graph → DSL (topological sort + join strategies)
   └─> Stores in PostgreSQL
   └─> Calls TemporalService.startWorkflow()

3. Temporal orchestrates execution
   └─> Schedules workflow on "shipsec-workflows" queue
   └─> Worker picks up and executes components via activities

4. Component execution in Worker
   └─> runComponentActivity() looks up component in registry
   └─> Creates ExecutionContext with injected services
   └─> Executes in Docker container with isolation
   └─> Streams logs, events, and terminal output in real-time

5. Real-time monitoring
   └─> Events → Kafka → Backend → WebSocket to Frontend
   └─> Terminal → Redis Streams → SSE to Frontend
   └─> Logs → Kafka → Loki → Backend API queries
   └─> Timeline updates based on event sequence processing
```

### Workflow Replay Mechanism

**Data Sources for Replay**:
- **Terminal Cast Files**: Asciinema-compatible `.cast` files created from Redis Stream chunks and stored in MinIO
- **Structured Logs**: Loki with nanosecond precision and labels
- **Trace Events**: PostgreSQL with sequence numbers and event types
- **Artifacts**: MinIO with component outputs and files

**Replay Process**:
1. **Terminal Archival**: Redis Stream chunks are converted to Asciinema `.cast` files and stored in MinIO after workflow completion
2. **Historical Data Retrieval**: Frontend fetches complete execution data from backend APIs
3. **Timeline Reconstruction**: Events are processed to rebuild execution timeline with accurate timing
4. **Terminal Playback**: Cast files are loaded and decoded to reconstruct terminal output at specific timeline positions
5. **State Restoration**: Node states, progress indicators, and data flow are reconstructed from event history
6. **Seeking Interface**: Users can navigate to any point in execution with cursor-based seeking

**Timeline Features**:
- **Playback Controls**: Play, pause, seek forward/backward through execution
- **Node State Visualization**: Each node shows status based on surrounding events
- **Data Flow Display**: Visual representation of data packets moving between components
- **Terminal Seeking**: Terminal display updates to show output at selected timeline position
- **Speed Control**: Adjustable replay speed for detailed analysis

**API Endpoints for Replay**:
- `GET /api/v1/runs/{runId}/events` - Fetch trace events with pagination
- `GET /api/v1/runs/{runId}/terminal` - Retrieve terminal chunks with cursor
- `GET /api/v1/runs/{runId}/logs` - Query logs with time range and filters
- `GET /api/v1/runs/{runId}/stream` - SSE endpoint for live updates

## Database Schema

**Core Tables**:
```sql
-- Workflow definitions with graph data
workflows (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  graph JSONB NOT NULL,         -- Visual graph structure
  compiled_definition JSONB,   -- Executable DSL
  organization_id VARCHAR
);

-- Workflow execution instances
workflow_runs (
  run_id TEXT PRIMARY KEY,
  workflow_id UUID NOT NULL,
  temporal_run_id TEXT,
  inputs JSONB NOT NULL,
  status VARCHAR,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Component execution results
workflow_nodes (
  id UUID PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_ref TEXT NOT NULL,
  component_id TEXT NOT NULL,
  inputs JSONB,
  outputs JSONB,
  status VARCHAR,
  error_message TEXT
);

-- Secure storage
secrets (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  current_version INTEGER DEFAULT 1,
  versions JSONB NOT NULL,     -- Encrypted secret versions
  organization_id VARCHAR
);

-- OAuth integrations
integrations (
  id UUID PRIMARY KEY,
  provider VARCHAR NOT NULL,
  user_id VARCHAR NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  scopes JSONB,
  expires_at TIMESTAMP
);
```

## Security Architecture

**Multi-tenant Authentication**:
- **Clerk Integration**: Production-ready authentication
- **Organization Isolation**: Tenant-based data separation
- **Role-Based Access**: Admin, User, Viewer roles

**Data Security**:
- **Secrets Encryption**: AES-256-GCM encryption at rest
- **Container Isolation**: Docker isolation for component execution
- **Network Security**: TLS encryption, proper CORS configuration
- **Access Control**: Fine-grained permissions and audit logging


This architecture provides a robust foundation for security workflow orchestration with comprehensive observability and strong security practices.