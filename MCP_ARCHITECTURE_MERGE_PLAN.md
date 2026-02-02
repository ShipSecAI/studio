# MCP Architecture Merge Plan: PR #209 + PR #243

**Date**: 2026-02-02
**Branches**: `mcp-library` (PR #209) ← `main` (includes PR #243)
**Status**: Draft - Pending Review

---

## Executive Summary

This document outlines the integration plan for merging **PR #209 (MCP Library)** with **PR #243 (Tool Mode + MCP Gateway)**. PR #243 is already merged into main, while PR #209 remains open with merge conflicts.

### The Conflict

- **PR #209** implements a centralized "MCP Library" that manages MCP servers via backend API, with worker spawning stdio processes directly
- **PR #243** implements "Tool Mode" with MCP Gateway using Docker containers + Streamable HTTP protocol

### The Vision

The goal is a unified architecture where:
1. **Docker containers** host stdio-based MCP servers (not direct process spawning)
2. **HTTP proxy** (mcp-stdio-proxy) bridges stdio to Streamable HTTP
3. **MCP Gateway** orchestrates all tool calls via unified JSON-RPC endpoint
4. **MCP Library** provides UI/UX for managing server configurations
5. **Tool Registry** (Redis-backed) manages tool metadata and credentials

---

## Architecture Comparison

| Aspect | PR #209 (MCP Library) | PR #243 (Tool Mode) | Proposed Final |
|--------|----------------------|---------------------|----------------|
| **Server Lifecycle** | Direct stdio process spawn in worker | Docker container with HTTP proxy | Docker + HTTP proxy |
| **Tool Discovery** | Backend API → Worker → MCP Client | MCP Gateway → Tool Registry | MCP Gateway → Tool Registry |
| **Communication** | Direct MCP SDK calls | Streamable HTTP (JSON-RPC) | Streamable HTTP |
| **Agent Integration** | Manual tool registration in ai-agent.ts | `@ai-sdk/mcp` via MCP Gateway | `@ai-sdk/mcp` via MCP Gateway |
| **Credential Storage** | PostgreSQL (encrypted headers) | Redis (per-run) | Both: PG for config, Redis for runtime |
| **UI Management** | McpLibraryPage (full CRUD) | Tool mode nodes in workflows | Both: MCP Library page + tool mode nodes |

---

## Current Architecture: PR #209

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MCP LIBRARY (PR #209)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Frontend: McpLibraryPage.tsx                                              │
│    ↓                                                                       │
│  Backend: /api/v1/mcp-servers/* (McpServersController)                     │
│    ↓                                                                       │
│  PostgreSQL: mcp_servers table (encrypted headers)                         │
│    ↓                                                                       │
│  Worker: fetchEnabledMcpServersActivity()                                  │
│    ↓                                                                       │
│  Worker: McpClientService (connection pooling)                             │
│    ↓                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │     StdioClientTransport (spawns child process)                     │   │
│  │     HTTP/SSE/WebSocket transports (direct connection)               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│    ↓                                                                       │
│  AI Agent: Manual tool registration (jsonSchemaToZod + registerMcpLibraryTool) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Files:**
- `backend/src/mcp-servers/mcp-servers.service.ts` (670 lines)
- `backend/src/database/schema/mcp-servers.ts` (mcp_servers, mcp_server_tools tables)
- `worker/src/services/mcp-client.service.ts` (stdio process spawning)
- `worker/src/components/ai/ai-agent.ts` (+270 lines for MCP Library integration)

---

## Current Architecture: PR #243

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOOL MODE (PR #243)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Workflow: Tool-mode nodes marked with `mode: 'tool'`                      │
│    ↓                                                                       │
│  Compiler: Generates tool registration signals (not execution)              │
│    ↓                                                                       │
│  Temporal: Registers tools in Tool Registry (Redis)                        │
│    ↓                                                                       │
│  Tool Registry: mcp:run:{runId}:tools (1-hour TTL)                         │
│    ↓                                                                       │
│  MCP Gateway: GET/POST /mcp/gateway (Streamable HTTP)                      │
│    ↓                                                                       │
│  Agent: createMCPClient() → tools/list → tools/call                        │
│                                                                             │
│  For External MCP Servers:                                                 │
│    ┌───────────────────────────────────────────────────────────────────┐   │
│  Docker: mcp-server-* container                                        │   │
│    ↓                                                                  │   │
│  HTTP Proxy: mcp-stdio-proxy (StdioClientTransport → Express)         │   │
│    ↓                                                                  │   │
│  Stdio MCP: python/node MCP server                                     │   │
│    └───────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Files:**
- `backend/src/mcp/mcp-gateway.service.ts` (539 lines)
- `backend/src/mcp/tool-registry.service.ts` (Redis-backed)
- `worker/src/components/core/mcp-runtime.ts` (Docker container launcher)
- `worker/src/components/core/mcp-server.ts` (MCP server component)
- `docker/mcp-stdio-proxy/server.mjs` (stdio → HTTP bridge)

---

## Proposed Final Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      UNIFIED MCP ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    CONFIGURATION LAYER                              │   │
│  │                                                                      │   │
│  │  Frontend: McpLibraryPage (server CRUD) + Workflow tool-mode nodes  │   │
│  │     ↓                                                                │   │
│  │  Backend: McpServersModule (/api/v1/mcp-servers/*)                 │   │
│  │     + McpModule (/mcp/gateway)                                      │   │
│  │     ↓                                                                │   │
│  │  PostgreSQL: mcp_servers (persistent config)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     WORKFLOW EXECUTION                              │   │
│  │                                                                      │   │
│  │  1. User creates workflow with tool-mode nodes                      │   │
│  │  2. Compiler detects mode='tool' → generates registration           │   │
│  │  3. Temporal workflow:                                              │   │
│  │     - Registers component tools in Tool Registry                    │   │
│  │     - For MCP server nodes: starts Docker container                 │   │
│  │     - Registers external MCP tools in Tool Registry                │   │
│  │  4. Tool Registry (Redis): mcp:run:{runId}:tools                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    AGENT EXECUTION                                  │   │
│  │                                                                      │   │
│  │  Agent Component (ai-agent.ts):                                     │   │
│  │    1. Receives MCP Gateway URL + session token (runId, nodeIds)    │   │
│  │    2. createMCPClient() → connects to /mcp/gateway                 │   │
│  │    3. tools/list → discovers scoped tools                          │   │
│  │    4. tools/call → executes via gateway                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    MCP GATEWAY                                      │   │
│  │                                                                      │   │
│  │  GET/POST/DELETE /mcp/gateway:                                      │   │
│  │    - Creates McpServer instance per run                             │   │
│  │    - Registers tools from Tool Registry                            │   │
│  │    - Proxies external MCP calls via StreamableHTTPClientTransport  │   │
│  │    - Executes component tools via Temporal signal                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    EXTERNAL MCP SERVERS                             │   │
│  │                                                                      │   │
│  │  Docker container: shipsec/mcp-stdio-proxy                          │   │
│  │    Environment: MCP_COMMAND, MCP_ARGS, PORT                         │   │
│  │    → Spawns stdio MCP server as subprocess                          │   │
│  │    → Exposes HTTP endpoint: /mcp (Streamable HTTP)                 │   │
│  │                                                                      │   │
│  │  Examples:                                                          │   │
│  │  - shipsec/mcp-aws-cloudtrail (python awslabs.cloudtrail-mcp-server)│   │
│  │  - shipsec/mcp-aws-cloudwatch (python awslabs.cloudwatch-mcp-server)│   │
│  │  - Any stdio MCP server (node, python, etc.)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File-by-File Merge Analysis

### 1. backend/src/database/schema/index.ts ✅ SIMPLE

**Conflict**: Both branches add new exports
```typescript
<<<<<<< HEAD
export * from './mcp-servers';
=======
export * from './node-io';
>>>>>>> main
```

**Resolution**: Keep both
```typescript
export * from './mcp-servers';
export * from './node-io';
```

---

### 2. bun.lock ✅ AUTO-RESOLVABLE

**Conflict**: Lockfile ordering conflict
- PR #209 adds `@modelcontextprotocol/sdk`
- PR #243 adds `@ai-sdk/mcp`

**Resolution**: Run `bun install` to regenerate

---

### 3. frontend/src/App.tsx ✅ KEEP HEAD

**Conflict**: Import formatting + McpLibraryPage import
```typescript
<<<<<<< HEAD
// No semicolons
import { McpLibraryPage } from '@/pages/McpLibraryPage'
=======
// Semicolons, missing McpLibraryPage
>>>>>>> main
```

**Resolution**: Accept HEAD (preserves MCP Library page integration)

---

### 4. frontend/src/components/layout/AppLayout.tsx ✅ KEEP HEAD

**Conflict 1**: Import differences
```typescript
<<<<<<< HEAD
import { ServerCog } from 'lucide-react'
import { setMobilePlacementSidebarClose } from '@/components/layout/Sidebar'
=======
// Missing ServerCog
import { setMobilePlacementSidebarClose } from '@/components/layout/sidebar-state'
>>>>>>> main
```

**Conflict 2**: Navigation items
```typescript
<<<<<<< HEAD
{
  name: 'MCP Library',
  href: '/mcp-library',
  icon: ServerCog,
},
=======
// No MCP Library nav item
>>>>>>> main
```

**Resolution**: Accept HEAD, verify import paths

---

### 5. frontend/src/components/workflow/ConfigPanel.tsx ✅ KEEP HEAD

**Conflict**: TODO comment
```typescript
<<<<<<< HEAD
// TODO: McpLibraryToolSelector will be integrated in a future PR
// import { McpLibraryToolSelector } from './McpLibraryToolSelector'
=======
// No TODO comment
>>>>>>> main
```

**Resolution**: Accept HEAD (preserves forward-looking comment)

---

### 6. worker/src/components/ai/ai-agent.ts ⚠️ CRITICAL REFACTORING NEEDED

**Conflict Type**: Architectural incompatibility

**PR #209 approach** (lines 33-46):
```typescript
import { mcpToolContractName } from './mcp-tool-contract';
import { getMcpClientService } from '../../services/mcp-client.service.js';
// Manual tool registration with jsonSchemaToZod
```

**PR #243 approach** (main):
```typescript
import { llmProviderContractName, McpToolDefinition } from '@shipsec/contracts';
import { createMCPClient } from '@ai-sdk/mcp';
// Uses inputs()/parameters() helpers
```

**Resolution Strategy**: Main-first integration

1. **Accept main's import structure**
   - Use `@shipsec/contracts` for all contract types
   - Add MCP Library service imports separately

2. **Accept main's schema architecture**
   - Use `inputs()` for connection-carrying ports
   - Use `parameters()` for configuration
   - Add MCP Library parameters to `parameters()`:

```typescript
const parameterSchema = parameters({
  // ... existing parameters from main ...
  mcpLibraryEnabled: param(
    z.boolean().default(true),
    {
      label: 'MCP Library',
      editor: 'boolean',
      description: 'Automatically load tools from MCP servers configured in the MCP Library.',
    }
  ),
  mcpLibraryServerExclusions: param(
    z.array(z.string()).optional(),
    {
      label: 'Excluded MCP Servers',
      editor: 'json',
      description: 'List of MCP server IDs to exclude from the library.',
      visibleWhen: { mcpLibraryEnabled: true },
    }
  ),
  mcpLibraryToolExclusions: param(
    z.array(z.string()).optional(),
    {
      label: 'Excluded MCP Tools',
      editor: 'json',
      description: 'List of tool names to exclude from MCP Library servers.',
      visibleWhen: { mcpLibraryEnabled: true },
    }
  ),
});
```

3. **Preserve MCP Library execution logic**
   - Keep `jsonSchemaToZod()`, `registerMcpLibraryTool()`, `loadMcpLibraryTools()` functions
   - Integrate into main's execute() function

4. **Remove duplicate UI metadata**
   - Accept main's schema-driven approach

---

### 7. worker/tsconfig.tsbuildinfo ✅ DELETE

**Conflict**: Modify/delete conflict
- File deleted in main, modified in HEAD

**Resolution**: Delete (accept main)

---

## Migration Strategy

### Phase 1: Prepare PR #209 Branch

```bash
# On mcp-library branch
git fetch origin main
git checkout main -- .gitignore  # Update any ignore patterns
git checkout main -- worker/tsconfig.tsbuildinfo  # Remove deleted file
```

### Phase 2: Manual Merge

```bash
git merge main --no-commit --no-ff
```

Resolve conflicts in order:
1. `backend/src/database/schema/index.ts` - Add both exports
2. `bun.lock` - Accept both, then `bun install`
3. `frontend/src/App.tsx` - Keep HEAD
4. `frontend/src/components/layout/AppLayout.tsx` - Keep HEAD, verify imports
5. `frontend/src/components/workflow/ConfigPanel.tsx` - Keep HEAD
6. `worker/src/components/ai/ai-agent.ts` - **CRITICAL** - Follow refactoring guide below
7. `worker/tsconfig.tsbuildinfo` - Delete

### Phase 3: Refactor ai-agent.ts

**Step 1**: Update imports
```typescript
// From main
import {
  LLMProviderSchema,
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
  llmProviderContractName,
  type McpToolDefinition,
} from '@shipsec/contracts';

// ADD for MCP Library
import {
  getMcpClientService,
  type McpServerConfig,
  type McpToolInfo,
} from '../../services/mcp-client.service.js';
```

**Step 2**: Add MCP Library parameters
```typescript
const parameterSchema = parameters({
  // ... existing parameters from main ...

  // MCP Library integration
  mcpLibraryEnabled: param(
    z.boolean().default(true),
    {
      label: 'MCP Library',
      editor: 'boolean',
      description: 'Automatically load tools from MCP servers configured in the MCP Library.',
    }
  ),
  mcpLibraryServerExclusions: param(
    z.array(z.string()).optional(),
    {
      label: 'Excluded MCP Servers',
      editor: 'json',
      description: 'List of MCP server IDs to exclude from the library.',
    }
  ),
  mcpLibraryToolExclusions: param(
    z.array(z.string()).optional(),
    {
      label: 'Excluded MCP Tools',
      editor: 'json',
      description: 'List of tool names to exclude from MCP Library servers.',
    }
  ),
});
```

**Step 3**: Preserve MCP Library functions (from HEAD)
Keep these functions from PR #209:
- `jsonSchemaToZod()` - Convert JSON Schema to Zod
- `registerMcpLibraryTool()` - Register single MCP Library tool
- `loadMcpLibraryTools()` - Load all MCP Library tools

**Step 4**: Integrate into execute() function
After main's tool registration, add:
```typescript
// Load MCP Library tools if enabled
if (params.mcpLibraryEnabled !== false) {
  const mcpLibraryTools = await loadMcpLibraryTools({
    serverExclusions: params.mcpLibraryServerExclusions,
    toolExclusions: params.mcpLibraryToolExclusions,
    sessionId, toolFactory, agentStream, usedToolNames, organizationId, logger
  });

  for (const entry of mcpLibraryTools) {
    registeredTools[entry.name] = entry.tool;
  }
}
```

### Phase 4: Build and Test

```bash
# Backend
cd backend && npm run build

# Frontend
cd frontend && npm run build

# Worker
cd worker && npm run build && npm run test

# Full project
npm run typecheck && npm run lint
```

---

## Components to Keep vs Remove

### From PR #209 - KEEP

| Component | File | Reason |
|-----------|------|--------|
| MCP Library UI | `frontend/src/pages/McpLibraryPage.tsx` | Server management UI |
| MCP Server CRUD | `backend/src/mcp-servers/*` | Persistent config storage |
| MCP Server schema | `backend/src/database/schema/mcp-servers.ts` | Database tables |
| Encryption service | `backend/src/mcp-servers/mcp-servers.encryption.ts` | Header encryption |
| Health check | `backend/src/mcp-servers/mcp-servers.service.ts` | Server health monitoring |
| API client | `packages/backend-client/src/client.ts` | Frontend API bindings |
| Shared types | `packages/shared/src/mcp.ts` | MCP type definitions |

### From PR #209 - REMOVE/REFACTOR

| Component | File | Action | Replacement |
|-----------|------|--------|-------------|
| MCP Client Service | `worker/src/services/mcp-client.service.ts` | **DEPRECATE** | Use MCP Gateway + `@ai-sdk/mcp` |
| Stdio process spawning | `worker/src/services/mcp-client.service.ts` | **REMOVE** | Use Docker + mcp-stdio-proxy |
| Direct MCP SDK usage | `worker/src/components/ai/ai-agent.ts` | **REFACTOR** | Use `createMCPClient()` |
| Manual tool registration | `worker/src/components/ai/ai-agent.ts` | **REFACTOR** | Use MCP Gateway pattern |
| JSON Schema to Zod | `worker/src/components/ai/ai-agent.ts` | **KEEP** | Still needed for MCP Library |
| `mcp-tool-contract.ts` | `worker/src/components/ai/mcp-tool-contract.ts` | **REMOVE** | Use `@shipsec/contracts` |

### From PR #243 - FOUNDATION (KEEP ALL)

| Component | File | Reason |
|-----------|------|--------|
| MCP Gateway | `backend/src/mcp/mcp-gateway.service.ts` | Central orchestration |
| Tool Registry | `backend/src/mcp/tool-registry.service.ts` | Runtime tool state |
| MCP Gateway Controller | `backend/src/mcp/mcp-gateway.controller.ts` | Streamable HTTP endpoint |
| MCP Runtime | `worker/src/components/core/mcp-runtime.ts` | Docker container mgmt |
| MCP Server Component | `worker/src/components/core/mcp-server.ts` | Workflow node |
| Stdio Proxy | `docker/mcp-stdio-proxy/server.mjs` | stdio → HTTP bridge |
| Agent Integration | `worker/src/components/ai/ai-agent.ts` | `@ai-sdk/mcp` usage |

---

## Architecture Decision Records

### ADR-001: Docker Over Direct Process Spawning

**Status**: Accepted

**Context**: PR #209 spawns stdio MCP servers as child processes in the worker. PR #243 uses Docker containers.

**Decision**: Use Docker containers for all stdio MCP servers.

**Rationale**:
- **Isolation**: Containers provide resource limits and cleanup guarantees
- **Portability**: Consistent environment across deployments
- **Security**: Containers can run with minimal privileges
- **Monitoring**: Docker stats and logs are easier to aggregate
- **Scaling**: Can orchestrate with Docker Swarm/Kubernetes

**Consequences**:
- Must maintain mcp-stdio-proxy image
- Container startup latency (~1-2s)
- Port allocation management required

---

### ADR-002: Streamable HTTP Protocol

**Status**: Accepted

**Context**: PR #209 uses direct MCP SDK calls (stdio/HTTP/SSE/WebSocket). PR #243 standardizes on Streamable HTTP.

**Decision**: All MCP communication uses Streamable HTTP (JSON-RPC over HTTP).

**Rationale**:
- **Web-native**: Works with existing HTTP infrastructure
- **Stateless**: Easier to scale horizontally (with sticky sessions)
- **Observable**: Standard HTTP metrics and tracing
- **Session-based**: Natural multi-tenancy via session tokens

**Consequences**:
- Stdio servers must use mcp-stdio-proxy
- HTTP SSE for streaming responses
- Session affinity required for horizontal scaling

---

### ADR-003: Dual Storage Pattern

**Status**: Accepted

**Context**: PR #209 stores config in PostgreSQL. PR #243 stores runtime state in Redis.

**Decision**: Use PostgreSQL for persistent configuration, Redis for runtime state.

**Pattern**:
| Storage | Purpose | TTL | Example |
|---------|---------|-----|---------|
| PostgreSQL | Server definitions, user preferences | Permanent | `mcp_servers` table |
| Redis | Tool registry, active sessions | 1 hour | `mcp:run:{runId}:tools` |

**Rationale**:
- **PG**: ACID guarantees, relational queries, audit trail
- **Redis**: Fast lookups, automatic expiration, pub/sub ready

**Consequences**:
- Tool discovery hits PG once, caches in Redis
- Session cleanup handled by Redis TTL
- Two systems to monitor

---

### ADR-004: MCP Gateway as Single Entry Point

**Status**: Accepted

**Context**: PR #209 has agents call MCP servers directly. PR #243 routes all calls through MCP Gateway.

**Decision**: All agent → MCP tool communication flows through MCP Gateway.

**Rationale**:
- **Security**: Single auth point, credential isolation
- **Observability**: One place to log all tool calls
- **Flexibility**: Can swap implementations without changing agents
- **Tool Registry Integration**: Gateway has full context of available tools

**Consequences**:
- Gateway is scaling bottleneck (documented limitation)
- Adds hop latency (~10-50ms)
- Gateway failure blocks all tool calls

---

## Testing Checklist

### Unit Tests
- [ ] `mcp-servers.service.ts`: CRUD, encryption, health check
- [ ] `tool-registry.service.ts`: Registration, scoping, cleanup
- [ ] `mcp-gateway.service.ts`: Tool discovery, execution, proxying
- [ ] `mcp-runtime.ts`: Container launch, port allocation
- [ ] `ai-agent.ts`: MCP Library integration with new schema

### Integration Tests
- [ ] MCP Library → Tool Registry flow
- [ ] MCP Gateway → Docker container flow
- [ ] Agent → MCP Gateway → Temporal flow
- [ ] Multi-agent tool scoping

### E2E Tests
- [ ] Create MCP server in UI → Agent can use tools
- [ ] Workflow with tool-mode node → Agent execution
- [ ] Docker container lifecycle (start → use → cleanup)
- [ ] MCP Library exclusions (server/tool level)

### Load Tests
- [ ] 100 concurrent MCP Gateway sessions
- [ ] 1000 tools in single registry
- [ ] 50 Docker containers running simultaneously

---

## Rollout Plan

### Step 1: Merge Preparation (1 day)
- [ ] Create integration branch from `mcp-library`
- [ ] Resolve all merge conflicts per this plan
- [ ] Run full test suite
- [ ] Create PR for review

### Step 2: Code Review (2-3 days)
- [ ] Architectural review
- [ ] Security review (credential handling)
- [ ] Performance review (scalability concerns)
- [ ] Documentation review

### Step 3: Staged Rollout (1 week)
- [ ] Deploy to dev environment
- [ ] Test with sample workflows
- [ ] Deploy to staging
- [ ] E2E testing with real MCP servers

### Step 4: Production Launch
- [ ] Feature flag: MCP Library enabled
- [ ] Monitor: Gateway latency, error rates
- [ ] Monitor: Docker resource usage
- [ ] Monitor: Redis memory usage

---

## Open Questions

1. **MCP SDK Duplication**: We have both `@modelcontextprotocol/sdk` (PR #209) and `@ai-sdk/mcp` (PR #243). Can we consolidate?

2. **Gateway Scaling**: Current implementation is single-instance. When do we need horizontal scaling?

3. **Container Cleanup**: Who is responsible for stopping Docker containers after workflow completion?

4. **Credential Rotation**: How do we handle rotated API keys without restarting workflows?

5. **Tool Discovery Caching**: Should we cache external tool metadata to reduce startup latency?

---

## References

- **PR #209**: https://github.com/ShipSecAI/studio/pull/209
- **PR #243**: https://github.com/ShipSecAI/studio/pull/243
- **MCP Protocol**: https://modelcontextprotocol.io/
- **AI SDK MCP**: https://sdk.vercel.ai/docs/ai-sdk-core/mcp
- **Issue Tracking**: ENG-96, ENG-97, ENG-98, ENG-100, ENG-101, ENG-102, ENG-103, ENG-132

---

**Document Version**: 1.0
**Last Updated**: 2026-02-02
**Authors**: Generated via Claude Code (Ultrawork Mode)
