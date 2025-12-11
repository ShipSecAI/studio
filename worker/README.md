# ShipSec Studio Worker

Node.js component execution engine with Temporal.io integration for running security workflows in isolated environments.

## Prerequisites
- Bun latest (see root `README.md` for install instructions)
- Infrastructure services running (`just dev` from repo root)
- Docker for containerized component execution

## Development Commands
```bash
# Install workspace dependencies (run once from repo root)
bun install

# Start the worker process
bun dev

# Type-check and lint before committing
bun run typecheck
bun run lint

# Run component tests
bun run test
```

## Architecture Overview

### Core Technologies
- **Node.js** with TypeScript for component execution
- **Temporal.io** for workflow orchestration and activities
- **Docker** for isolated component execution
- **tsx** for TypeScript execution (Bun incompatible with Temporal)
- **Component SDK** for framework-agnostic component definitions

### Component Execution Flow

```typescript
// Workflow orchestrates component execution
const runComponentActivity = async (componentId, input, context) => {
  const component = componentRegistry.getComponent(componentId);
  const executionContext = createExecutionContext({
    storage: globalStorage,
    secrets: globalSecrets,
    artifacts: scopedArtifacts,
    trace: globalTrace,
    logCollector: globalLogs,
    terminalCollector: globalTerminal,
  });

  return await component.execute(input, executionContext);
};
```

### Service Adapters

The worker provides concrete implementations of SDK interfaces:

#### File Storage Adapter
- **MinIO Integration**: S3-compatible object storage
- **PostgreSQL Metadata**: File metadata and organization
- **Artifact Management**: Component outputs and execution results

#### Secrets Adapter
- **HashiCorp Vault**: Enterprise-grade secret management
- **AES-256 Encryption**: Secure secret storage
- **Version Control**: Multiple secret versions with rollback

#### Trace Adapter
- **Event Streaming**: Kafka-based event publishing
- **Redis Transport**: Real-time event delivery
- **Timeline Generation**: Sequential event numbering

#### Logging Adapters
- **Kafka Log Transport**: Structured log streaming
- **Loki Integration**: Log aggregation and querying
- **PostgreSQL Persistence**: Log metadata and indexing

#### Terminal Adapter
- **Redis Streams**: Real-time terminal output streaming
- **Base64 Encoding**: Efficient binary data transport
- **Monotonic Timestamps**: Precise chronological ordering

## Component System

### Component Categories

#### Core Components
- **file-loader**: File upload and content extraction
- **trigger-manual**: Manual workflow execution trigger
- **text-block**: Markdown documentation and notes
- **text-joiner**: Text concatenation and formatting

#### Security Components
- **subfinder**: Subdomain discovery
- **dnsx**: DNS resolution and enumeration
- **nmap**: Network scanning and discovery
- **httpx**: HTTP probing and discovery
- **nuclei**: Vulnerability scanning
- **katana**: Web crawling and discovery

### Component Registry

```typescript
// Component registration
const definition: ComponentDefinition = {
  id: 'security.subfinder',
  label: 'Subfinder',
  category: 'discovery',
  runner: { kind: 'docker', image: 'projectdiscovery/subfinder' },
  inputSchema: z.object({
    domain: z.string(),
    timeout: z.number().default(30),
  }),
  execute: async (input, context) => {
    // Component execution logic
  },
};

componentRegistry.register(definition);
```

## Temporal Integration

### Activities
- **runComponentActivity**: Execute individual components
- **setRunMetadataActivity**: Store workflow execution metadata
- **finalizeRunActivity**: Complete workflow and cleanup resources

### Workflows
- **Workflow Orchestration**: Topological sorting and dependency resolution
- **Join Strategies**: Handle multiple parent dependencies (all, any, first)
- **Error Handling**: Retry policies and graceful degradation
- **Heartbeating**: Long-running activity support

### Worker Configuration
```typescript
const worker = await Worker.create({
  connection,
  namespace: 'shipsec-studio',
  taskQueue: 'shipsec-workflows',
  workflowsPath: require.resolve('./temporal/workflows'),
  activities: {
    runComponentActivity,
    setRunMetadataActivity,
    finalizeRunActivity,
  },
});
```

## Project Structure
```
src/
├── components/         # Component implementations
│   ├── core/          # Core utility components
│   └── security/      # Security tool integrations
├── adapters/          # Service interface implementations
│   ├── file-storage.adapter.ts
│   ├── kafka-log.adapter.ts
│   ├── loki-log.adapter.ts
│   ├── kafka-trace.adapter.ts
│   └── terminal-stream.adapter.ts
├── temporal/          # Workflow orchestration
│   ├── workflows/     # Workflow definitions
│   ├── activities/    # Activity implementations
│   └── workers/       # Worker configuration
└── utils/             # Utilities and helpers
```

## Container Execution

### Docker Integration
- **Isolated Execution**: Components run in isolated Docker containers
- **Resource Limits**: CPU and memory constraints enforced
- **Network Isolation**: Bridge network configuration
- **Volume Management**: Isolated storage volumes for file operations

### Terminal Capture
- **PTY Allocation**: Pseudo-terminal for interactive tools
- **Stream Multiplexing**: stdout, stderr, and PTY stream capture
- **Chunk Encoding**: Base64 encoding for efficient transport
- **Real-time Streaming**: Redis Stream-based output delivery

## Development Workflow

1. **Infrastructure**: Start required services with `just dev`
2. **Component Development**: Create components in `src/components/`
3. **Registration**: Import and register components in `src/components/index.ts`
4. **Testing**: Write component tests in `__tests__/` directories
5. **Validation**: Check types with `bun run typecheck`

## Where To Read More
- **[Architecture Overview](../docs/architecture.md)** - Complete system design and component execution
- **[Component Development](../docs/component-development.md)** - Building security components
- **[Component SDK](../packages/component-sdk)** - Framework-agnostic component interfaces