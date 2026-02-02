# MCP Architecture Merge Plan: PR #209 (MCP Library) + PR #243 (Tool Mode)

**Document Version:** 1.0
**Date:** 2026-02-02
**Author:** Technical Documentation Team
**Status:** DRAFT - Pending Review

---

## Table of Contents

1. [Executive Summary](#section-1-executive-summary)
2. [Architecture Comparison](#section-2-architecture-comparison)
3. [Proposed Final Architecture](#section-3-proposed-final-architecture)
4. [File-by-File Merge Analysis](#section-4-file-by-file-merge-analysis)
5. [Migration Strategy](#section-5-migration-strategy)
6. [Components to Keep vs Remove](#section-6-components-to-keep-vs-remove)
7. [Architecture Diagrams](#section-7-architecture-diagrams)
8. [Testing Checklist](#section-8-testing-checklist)

---

## Section 1: Executive Summary

### 1.1 Overview

**PR #209: MCP Library** (Open - `mcp-library` branch)

- **Purpose:** Globally manage MCP servers and their respective tools across the organization
- **Approach:** Database-backed persistent storage of MCP server configurations
- **Key Features:**
  - CRUD operations for MCP server configurations
  - Encrypted header storage for authentication
  - Health check polling and status tracking
  - Tool discovery and management UI
  - Direct stdio process execution

**PR #243: Tool Mode + OpenCode Agent + MCP Gateway** (Merged - `main` branch)

- **Purpose:** Enable AI agents to call workflow components and MCP servers as tools
- **Approach:** Runtime tool registration with MCP Gateway as centralized proxy
- **Key Features:**
  - MCP Gateway with StreamableHTTP transport
  - Tool Registry (Redis-backed) for runtime tool metadata
  - Docker containerized stdio MCP servers with HTTP proxy
  - Tool scoping via workflow graph connections
  - OpenCode agent component with MCP client integration

### 1.2 The Conflict

| Aspect                | PR #209 (MCP Library)                      | PR #243 (Tool Mode)                            | Conflict                                   |
| --------------------- | ------------------------------------------ | ---------------------------------------------- | ------------------------------------------ |
| **Storage**           | PostgreSQL database (`mcp_servers` table)  | Redis runtime registry                         | Different persistence layers               |
| **Tool Registration** | Direct tool discovery from stdio processes | Gateway-mediated registration via internal API | Duplicate registration mechanisms          |
| **Agent Integration** | Direct MCP client connections in agent     | MCP Gateway as single proxy endpoint           | Two different agent communication patterns |
| **Transport**         | Direct stdio, HTTP, SSE, WebSocket         | StreamableHTTP via proxy                       | PR #209 bypasses gateway                   |
| **Server Management** | Database CRUD with health checks           | Docker runtime with proxy endpoints            | No lifecycle coordination                  |

### 1.3 Proposed Final Architecture

**Vision:** Combine PR #209's persistent MCP Library with PR #243's runtime infrastructure

**Key Design Decisions:**

1. **MCP Library** becomes the source of truth for server configurations
2. **Docker + HTTP Proxy** architecture from PR #243 handles all stdio servers
3. **MCP Gateway** remains the single entry point for all tool calls
4. **StreamableHTTP** becomes the universal transport protocol
5. **Tool Registry** provides runtime metadata bridge between library and gateway

**Result:** Persistent, manageable MCP servers that execute through the proven gateway infrastructure.

---

## Section 2: Architecture Comparison

### 2.1 PR #209: MCP Library Approach

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MCP Library Architecture                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Frontend  │         │   Backend    │         │   Worker        │
│             │         │              │         │                 │
│ ┌─────────┐ │         │ ┌──────────┐ │         │ ┌─────────────┐ │
│ │MCP Library│ │         │ │   MCP    │ │         │ │  AI Agent   │ │
│ │   UI     │ │         │ │ Servers  │ │         │ │             │ │
│ └────┬──────┘ │         │ │ Controller│ │         │ └──────┬──────┘ │
│      │       │         │ └────┬─────┘ │         │        │        │
│      │       │         │      │       │         │        │        │
│      │       │         │ ┌────▼─────┐ │         │        │        │
│      │       │         │ │   MCP    │ │         │        │        │
│      │       │         │ │  Service │ │         │        │        │
│      │       │         │ └────┬─────┘ │         │        │        │
│      │       │         │      │       │         │        │        │
│      │       │         │ ┌────▼──────┴───────────────┐│        │        │
│      │       │         │ │     MCP Servers Table     ││        │        │
│      │       │         │ │   (PostgreSQL)            ││        │        │
│      │       │         │ └───────────────────────────┘│        │        │
└──────┼───────┘         └─────────────────────────────┘└────────┼────────┘
       │                                                     │
       │ REST API                                            │ Direct stdio
       │                                                     │
       ▼                                                     ▼
┌─────────────────┐                              ┌──────────────────┐
│  MCP Server     │                              │  Stdio Processes │
│  Configurations │                              │  (npx @modelcontext│
│  (HTTP, stdio,  │                              │   protocol-server │
│   SSE, WebSocket)│                              │   ...)            │
└─────────────────┘                              └──────────────────┘

Key Characteristics:
✓ Persistent configuration storage
✓ CRUD operations for server management
✓ Health check polling
✓ Direct stdio process execution
✗ No runtime tool registration
✗ Agent bypasses gateway
✗ No tool scoping
```

### 2.2 PR #243: Tool Mode Approach

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Tool Mode Architecture                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Frontend  │         │   Backend    │         │   Worker        │
│             │         │              │         │                 │
│ ┌─────────┐ │         │ ┌──────────┐ │         │ ┌─────────────┐ │
│ │Tool Mode│ │         │ │   MCP    │ │         │ │  AI Agent   │ │
│ │   UI    │ │         │ │ Gateway  │ │         │ │             │ │
│ └────┬──────┘ │         │ │Service   │ │         │ └──────┬──────┘ │
│      │       │         │ └────┬─────┘ │         │        │        │
│      │       │         │      │       │         │        │ Streamable│
│      │       │         │ ┌────▼─────┐ │         │        │ HTTP     │
│      │       │         │ │  Tool    │ │         │        │        │
│      │       │         │ │ Registry │ │         │        │        │
│      │       │         │ │ (Redis)  │ │         │        │        │
└──────┼───────┘         └────┬────────┘         └────────┼────────┘
       │                      │                          │
       │ Internal API         │                          │
       │                      │                          │
       ▼                      ▼                          ▼
┌─────────────┐      ┌──────────────┐        ┌──────────────────┐
│  Workflow   │      │  MCP Gateway │        │  Docker          │
│  Nodes      │      │   Controller │        │  Containers      │
│  (Tool Mode)│      │  /mcp/gateway│        │  (stdio MCPs)    │
└─────────────┘      └──────┬───────┘        └────────┬─────────┘
                            │                         │
                            │                         │
                            │   HTTP Proxy (stdio)    │
                            └─────────────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │  MCP Servers     │
                            │  (HTTP endpoints)│
                            └──────────────────┘

Key Characteristics:
✓ Centralized MCP Gateway
✓ Runtime tool registration
✓ Tool scoping via graph connections
✓ Docker containerized stdio servers
✓ StreamableHTTP protocol
✓ Redis-backed tool registry
✗ No persistent server configuration UI
✗ Manual server configuration per workflow
```

### 2.3 Key Differences Table

| Aspect                           | PR #209 (MCP Library)        | PR #243 (Tool Mode)            | Winner (Merge)    |
| -------------------------------- | ---------------------------- | ------------------------------ | ----------------- |
| **Server Configuration Storage** | PostgreSQL (persistent)      | None (ephemeral)               | PR #209           |
| **Tool Discovery**               | Direct from server           | Via gateway registration       | PR #243           |
| **Agent Communication**          | Direct MCP client            | MCP Gateway proxy              | PR #243           |
| **Stdio Server Handling**        | Direct process spawn         | Docker + HTTP proxy            | PR #243           |
| **Transport Protocol**           | Multiple (stdio/HTTP/SSE/WS) | StreamableHTTP only            | PR #243           |
| **Tool Scoping**                 | None                         | Graph-based (connectedNodeIds) | PR #243           |
| **Health Checks**                | Polling-based                | Runtime availability           | PR #243           |
| **UI/UX**                        | Full management UI           | Workflow-only UI               | PR #209 + PR #243 |
| **Authentication**               | Encrypted headers            | JWT session tokens             | Both              |
| **Multi-tenancy**                | Organization-scoped          | Run-scoped                     | Both              |

---

## Section 3: Proposed Final Architecture

### 3.1 Design Principles

1. **Single Source of Truth:** MCP Library (PostgreSQL) stores all server configurations
2. **Unified Gateway:** All tool calls flow through MCP Gateway
3. **Container Isolation:** Stdio servers run in Docker with HTTP proxy
4. **Standardized Transport:** StreamableHTTP for all communication
5. **Runtime Registration:** Tool Registry bridges persistent config to runtime

### 3.2 Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    MERGED ARCHITECTURE: MCP Library + Tool Mode            │
└────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐         ┌──────────────────────┐
│      Frontend        │         │       Backend        │         │       Worker         │
│                      │         │                      │         │                      │
│ ┌────────────────┐   │         │ ┌────────────────┐   │         │ ┌────────────────┐   │
│ │  MCP Library   │   │         │ │   MCP Gateway  │   │         │ │   AI Agent     │   │
│ │  Management UI │   │         │ │   Service      │   │         │ │                │   │
│ └───────┬────────┘   │         │ └───────┬────────┘   │         │ └───────┬────────┘   │
│         │            │         │         │            │         │         │            │
│ ┌───────▼────────┐   │         │ ┌───────▼────────┐   │         │ ┌───────▼────────┐   │
│ │  Tool Mode UI  │   │         │ │  Tool Registry │   │         │ │ MCP Client     │   │
│ │  (per workflow)│   │         │ │  (Redis)       │   │         │ │ (SDK)          │   │
│ └────────────────┘   │         │ └───────┬────────┘   │         │ └───────┬────────┘   │
└────────┼─────────────┘         └─────────┼────────────┘         └─────────┼────────────┘
         │                                 │                               │
         │ REST API                        │ Internal API                 │
         │                                 │                               │
         ▼                                 ▼                               │
┌─────────────────────┐         ┌─────────────────────┐                   │
│   MCP Servers API   │         │  Internal MCP API   │                   │
│   /mcp-servers/*    │         │  /internal/mcp/*    │                   │
└──────────┬──────────┘         └──────────┬──────────┘                   │
           │                               │                               │
           │                               │                               │
           ▼                               ▼                               │
┌─────────────────────┐         ┌─────────────────────┐                   │
│  PostgreSQL DB      │         │   MCP Gateway       │                   │
│  (mcp_servers table)│         │   Controller        │                   │
└─────────────────────┘         │   /mcp/gateway      │                   │
                               └──────────┬──────────┘                   │
                                          │ StreamableHTTP                │
                                          │                               │
                  ┌─────────────────────────┼─────────────────────────┐    │
                  │                         │                         │    │
                  ▼                         ▼                         ▼    ▼
         ┌────────────────┐        ┌────────────────┐      ┌────────────────┐
         │  Docker        │        │  Remote HTTP   │      │  Component    │
         │  Containers    │        │  MCP Servers   │      │  Tools        │
         │  (stdio MCPs)  │        │  (external)    │      │  (ShipSec)    │
         │                │        │                │      │                │
         │ ┌────────────┐ │        │                │      │                │
         │ │ Stdio Proxy│ │        │                │      │                │
         │ └────────────┘ │        │                │      │                │
         └────────────────┘        └────────────────┘      └────────────────┘

Data Flow:
1. User configures MCP server in Library UI → PostgreSQL
2. Workflow with tool-mode node triggers → Internal MCP API
3. Internal API reads config from DB → spawns Docker container (if stdio)
4. Docker container gets HTTP proxy endpoint → registers with Tool Registry
5. AI Agent discovers tools via MCP Gateway → executes through gateway
6. Gateway routes to appropriate destination (Docker/HTTP/Component)
```

### 3.3 Component Responsibilities

**MCP Library (PR #209):**

- ✓ Server configuration CRUD (keep from PR #209)
- ✓ Encrypted header storage (keep from PR #209)
- ✓ Health check tracking (keep from PR #209)
- ✓ Management UI (keep from PR #209)
- ✗ Direct stdio execution (replace with Docker + proxy from PR #243)
- ✗ Direct agent tool loading (replace with gateway discovery from PR #243)

**MCP Gateway (PR #243):**

- ✓ Single entry point for all tool calls (keep)
- ✓ StreamableHTTP transport (keep)
- ✓ Tool registration and discovery (keep)
- ✓ Component tool execution via Temporal (keep)
- ✓ External MCP proxying (keep)
- ✓ Stdio Docker container coordination (keep)

**Tool Registry (PR #243):**

- ✓ Runtime tool metadata bridge (keep)
- ✓ Credential encryption (keep)
- ✓ Tool scoping via connectedNodeIds (keep)

### 3.4 How MCP Library Fits In

```
┌─────────────────────────────────────────────────────────────┐
│            MCP Library Integration Points                    │
└─────────────────────────────────────────────────────────────┘

1. CONFIGURATION PHASE (User Action)
   User → MCP Library UI → /mcp-servers API → PostgreSQL
   Stores: server name, transport type, endpoint, command, args, headers

2. WORKFLOW BUILD PHASE (User Action)
   User → Workflow Canvas → Add MCP Server Node (Tool Mode)
   Node Config: references MCP Library server ID

3. RUNTIME INITIALIZATION (Temporal Workflow)
   Workflow → Internal MCP API → /internal/mcp/register-local-mcp
   API Action:
   a. Read server config from PostgreSQL by ID
   b. If stdio: spawn Docker container with HTTP proxy
   c. Get proxy endpoint URL
   d. Register with Tool Registry (Redis)

4. TOOL DISCOVERY (AI Agent)
   Agent → MCP Gateway → /mcp/gateway (with session token)
   Gateway Action:
   a. Validate session token (runId, organizationId, allowedNodeIds)
   b. Query Tool Registry for allowed tools
   c. Return tool list to agent

5. TOOL EXECUTION (AI Agent)
   Agent → MCP Gateway → /mcp/gateway (tool call)
   Gateway Action:
   a. Route to appropriate handler:
      - Component tool → Temporal signal
      - Local MCP (stdio) → HTTP proxy in Docker
      - Remote MCP (HTTP) → External HTTP call
   b. Return result to agent
```

---

## Section 4: File-by-File Merge Analysis

### 4.1 Backend Files

#### 4.1.1 `backend/src/database/schema/index.ts`

**PR #209 Change:**

```typescript
export * from './mcp-servers';
```

**PR #243 State:** No MCP schema exports (uses different schema)

**Resolution:** ✓ **KEEP PR #209 change**

The `mcp-servers` schema provides persistent storage for MCP Library configurations.

**Action:** Add the export from PR #209

---

#### 4.1.2 `backend/src/app.module.ts`

**PR #209 Change:**

```typescript
import { McpServersModule } from './mcp-servers/mcp-servers.module';

@Module({
  imports: [
    // ... existing imports
    McpServersModule,
  ],
})
```

**PR #243 State:** Has `McpModule` for gateway/tool-registry

**Resolution:** ✓ **KEEP BOTH MODULES**

They serve different purposes:

- `McpServersModule` (PR #209): CRUD for server configurations
- `McpModule` (PR #243): Gateway and runtime tool registration

**Action:** Import both modules

```typescript
@Module({
  imports: [
    // ... existing imports
    McpModule,           // PR #243: Gateway + Tool Registry
    McpServersModule,    // PR #209: Server Configuration CRUD
  ],
})
```

---

#### 4.1.3 `bun.lock`

**Conflict:** Both PRs add dependencies

**PR #209 additions:**

- MCP SDK dependencies
- Encryption libraries

**PR #243 additions:**

- MCP SDK (may overlap)
- Different versions possible

**Resolution:** ⚠️ **RESOLVE DEPENDENCY CONFLICTS**

**Action:**

1. Use `git merge-file` or manual resolution
2. Prefer newer versions where duplicates exist
3. Ensure MCP SDK versions are compatible
4. Run `bun install` and test

```bash
# On main branch
git checkout mcp-library -- backend/package.json
# Resolve conflicts keeping highest versions
bun install
```

---

### 4.2 Frontend Files

#### 4.2.1 `frontend/src/App.tsx`

**PR #209 Change:**

```tsx
import { McpLibraryPage } from '@/pages/McpLibraryPage';

// ... in routes
<Route path="/mcp-library" element={<McpLibraryPage />} />;
```

**PR #243 State:** No MCP Library route

**Resolution:** ✓ **KEEP PR #209 change**

Adds the MCP Library management UI.

**Action:** Add route from PR #209

---

#### 4.2.2 `frontend/src/components/layout/AppLayout.tsx`

**PR #209 Change:**

```tsx
import { ServerCog } from 'lucide-react'

// ... in navigation items
{
  name: 'MCP Library',
  href: '/mcp-library',
  icon: ServerCog,
}
```

**PR #243 State:** No MCP Library nav item

**Resolution:** ✓ **KEEP PR #209 change**

Adds sidebar navigation to MCP Library.

**Action:** Add nav item from PR #209

---

#### 4.2.3 `frontend/src/components/workflow/ConfigPanel.tsx`

**PR #209 Change:**

```tsx
// TODO: McpLibraryToolSelector will be integrated in a future PR
// import { McpLibraryToolSelector } from './McpLibraryToolSelector'
```

**PR #243 State:** Already has tool mode integration

**Resolution:** ⚠️ **CONDITIONAL INTEGRATION**

**Action:**

1. Keep PR #243's tool mode implementation as base
2. Add `McpLibraryToolSelector` as an OPTION for selecting MCP Library servers
3. Implement in follow-up PR (not part of this merge)

**Merge Result:**

```tsx
import { ToolModeConfigPanel } from './ToolModeConfigPanel'; // From PR #243
// import { McpLibraryToolSelector } from './McpLibraryToolSelector'  // PR #209 (future)

// Use ToolModeConfigPanel for now
// McpLibraryToolSelector to be integrated separately
```

---

### 4.3 Worker Files (CRITICAL)

#### 4.3.1 `worker/src/components/ai/ai-agent.ts`

**CRITICAL CONFLICT** - This is the most significant merge conflict.

**PR #209 Approach:**

```typescript
// Direct MCP client connections
import { getMcpClientService } from '../../services/mcp-client.service.js';

const mcpClientService = getMcpClientService();
const client = await mcpClientService.connect(serverConfig);
const tools = await client.listTools();
```

**PR #243 Approach:**

```typescript
// MCP Gateway via createMCPClient
import { createMCPClient } from '@ai-sdk/mcp';

const mcpClient = createMCPClient({
  gatewayUrl: `${gatewayUrl}/mcp/gateway`,
  token: gatewayToken,
});
const tools = await mcpClient.getTools();
```

**Resolution:** ✓ **USE PR #243 APPROACH (GATEWAY)**

**Rationale:**

1. Gateway provides centralized logging and monitoring
2. Gateway handles tool scoping via connectedNodeIds
3. Gateway enables multi-agent isolation
4. Gateway is already deployed and working
5. Direct connections bypass security and monitoring

**Action:** **KEEP PR #243 implementation, REMOVE PR #209 direct MCP client code**

**Specific Changes:**

```typescript
// REMOVE (from PR #209):
import { getMcpClientService } from '../../services/mcp-client.service.js';
import type { McpServerConfig, McpToolInfo } from '../../services/mcp-client.service.js';

// KEEP (from PR #243):
import { createMCPClient } from '@ai-sdk/mcp';
import { DEFAULT_GATEWAY_URL, getGatewaySessionToken } from './utils';

// REMOVE (from PR #209):
const mcpLibraryEnabled = input.mcpLibraryEnabled ?? true;
const mcpLibraryServerExclusions = input.mcpLibraryServerExclusions ?? [];
const mcpLibraryToolExclusions = input.mcpLibraryToolExclusions ?? [];

// REMOVE (from PR #209):
if (mcpLibraryEnabled) {
  const mcpClientService = getMcpClientService();
  const libraryServers = await mcpClientService.getLibraryServers(auth);
  // ... direct connection logic
}

// KEEP (from PR #243):
const gatewayUrl = process.env.MCP_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
const gatewayToken = await getGatewaySessionToken(context, {
  runId: context.executionId,
  allowedNodeIds: connectedToolNodeIds,
});
const mcpClient = createMCPClient({ gatewayUrl, token: gatewayToken });
```

**Result:** Agent uses gateway for all MCP tool access (both library and runtime servers)

---

#### 4.3.2 `worker/src/services/mcp-client.service.ts`

**PR #209 Status:** Creates this file with direct MCP client implementation

**PR #243 Status:** Does not have this file (uses gateway instead)

**Resolution:** ⚠️ **CONDITIONAL - KEEP BUT MARK AS DEPRECATED**

**Rationale:**

1. May be useful for health checks in MCP Library
2. Should NOT be used by AI agent
3. Mark as deprecated for future removal

**Action:**

1. Keep the file for MCP Library health checks
2. Add deprecation notice
3. Update documentation to indicate AI agent should use gateway

```typescript
/**
 * @deprecated Use MCP Gateway for agent tool access.
 * This service is maintained for MCP Library health checks only.
 */
export class McpClientService {
  // ... existing implementation
}
```

---

#### 4.3.3 `worker/src/temporal/activities/mcp-library.activity.ts`

**PR #209 Status:** Creates this file for MCP Library operations

**PR #243 Status:** Has `mcp-runtime.activity.ts` for runtime MCP operations

**Resolution:** ✓ **RENAME AND INTEGRATE**

**Action:**

1. Rename PR #209's `mcp-library.activity.ts` → `mcp-library-config.activity.ts`
2. Keep PR #243's `mcp-runtime.activity.ts` for runtime operations
3. Both activities can coexist

---

#### 4.3.4 `worker/tsconfig.tsbuildinfo`

**Conflict:** Build artifact file

**Resolution:** ⚠️ **DELETE AND REBUILD**

**Action:**

```bash
rm worker/tsconfig.tsbuildinfo
cd worker && bun run build
```

---

### 4.4 New Files from PR #209 to Keep

**Backend:**

- ✓ `backend/src/mcp-servers/` - Entire directory (configuration CRUD)
- ✓ `backend/src/database/schema/mcp-servers.ts` - Database schema
- ✓ `backend/src/database/migrations/*` - Any migrations (check)

**Frontend:**

- ✓ `frontend/src/pages/McpLibraryPage.tsx` - Main library UI
- ✓ `frontend/src/components/workflow/McpLibraryToolSelector.tsx` - Future integration
- ✓ `frontend/src/store/mcpServerStore.ts` - MCP server state management
- ✓ `frontend/src/hooks/useMcpHealthPolling.ts` - Health check hook

**Worker:**

- ✓ `worker/src/services/mcp-client.service.ts` - For health checks only (marked deprecated)
- ✓ `worker/src/temporal/activities/mcp-library-config.activity.ts` - Renamed from mcp-library.activity.ts

**Shared:**

- ✓ `packages/shared/src/mcp.ts` - MCP types shared between frontend/backend

---

### 4.5 Files to Remove from PR #209

**Worker:**

- ✗ Direct MCP client usage in `ai-agent.ts` (replaced with gateway)
- ✗ `mcpTools` input port (use gateway discovery instead)
- ✗ `mcpLibraryEnabled`, `mcpLibraryServerExclusions`, `mcpLibraryToolExclusions` parameters

---

## Section 5: Migration Strategy

### 5.1 Pre-Merge Checklist

**Environment Setup:**

- [ ] Ensure PostgreSQL is running
- [ ] Ensure Redis is running
- [ ] Ensure Docker is running
- [ ] Backup existing database

**Branch Preparation:**

- [ ] Update `main` branch: `git checkout main && git pull origin main`
- [ ] Create merge branch: `git checkout -b merge/mcp-library-tool-mode`

### 5.2 Step-by-Step Merge Process

#### Step 1: Merge PR #209 into merge branch

```bash
git checkout main
git checkout -b merge/mcp-library-tool-mode
git merge origin/mcp-library --no-commit
```

#### Step 2: Resolve conflicts systematically

**2.1 Backend Schema**

```bash
# Edit backend/src/database/schema/index.ts
# Add: export * from './mcp-servers';
git add backend/src/database/schema/index.ts
```

**2.2 Backend Modules**

```bash
# Edit backend/src/app.module.ts
# Add: McpServersModule to imports
git add backend/src/app.module.ts
```

**2.3 Frontend Routes**

```bash
# Edit frontend/src/App.tsx
# Add McpLibraryPage route
git add frontend/src/App.tsx
```

**2.4 Frontend Navigation**

```bash
# Edit frontend/src/components/layout/AppLayout.tsx
# Add MCP Library nav item
git add frontend/src/components/layout/AppLayout.tsx
```

**2.5 Worker AI Agent (CRITICAL)**

```bash
# Edit worker/src/components/ai/ai-agent.ts
# KEEP PR #243 (gateway), REMOVE PR #209 (direct client)
# Remove: mcp-client.service imports
# Remove: mcpLibraryEnabled parameters
# Remove: direct MCP connection logic
git add worker/src/components/ai/ai-agent.ts
```

**2.6 Dependencies**

```bash
# Resolve bun.lock conflicts
# Keep highest version numbers
# Run: bun install
git add bun.lock
```

**2.7 Build Artifacts**

```bash
# Remove and rebuild
rm worker/tsconfig.tsbuildinfo
cd worker && bun run build
git add worker/tsconfig.tsbuildinfo worker/dist/
```

#### Step 3: Handle new files from PR #209

```bash
# Backend MCP servers module
git add backend/src/mcp-servers/

# Frontend MCP Library UI
git add frontend/src/pages/McpLibraryPage.tsx
git add frontend/src/store/mcpServerStore.ts
git add frontend/src/hooks/useMcpHealthPolling.ts
# Note: McpLibraryToolSelector to be integrated later

# Worker services (health check only)
git add worker/src/services/mcp-client.service.ts
git add worker/src/temporal/activities/mcp-library.activity.ts
```

#### Step 4: Database migrations

```bash
# Check if PR #209 has migrations
ls backend/src/database/migrations/ | grep mcp

# If migrations exist, create a combined migration
cd backend
bun run migrate:generate --name=merge_mcp_library_tool_mode
bun run migrate:run
```

#### Step 5: Complete merge

```bash
git commit -m "feat: merge MCP Library (PR #209) with Tool Mode (PR #243)

- Add MCP Library configuration CRUD (PR #209)
- Keep MCP Gateway for all tool execution (PR #243)
- Add MCP Library management UI (PR #209)
- Integrate with existing Tool Registry (PR #243)
- Remove direct MCP client connections from agent (use gateway)
- Add database schema for mcp_servers table
- Add health check polling for MCP servers

Resolves conflicts in:
- backend/src/database/schema/index.ts
- backend/src/app.module.ts
- frontend/src/App.tsx
- frontend/src/components/layout/AppLayout.tsx
- worker/src/components/ai/ai-agent.ts (CRITICAL: kept gateway approach)
- bun.lock (dependency resolution)
- worker/tsconfig.tsbuildinfo (rebuilt)

Co-Authored-By: Krishna <krishna@shipsec.ai>
Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 5.3 Post-Merge Actions

**Database:**

```bash
cd backend
bun run migrate:run
```

**Dependencies:**

```bash
bun install
cd frontend && bun install
cd worker && bun install
```

**Build:**

```bash
# Backend
cd backend && bun run build

# Frontend
cd frontend && bun run build

# Worker
cd worker && bun run build
```

**Tests:**

```bash
# Backend tests
cd backend && bun run test

# Worker tests
cd worker && bun run test

# E2E tests
cd e2e-tests && bun run test
```

---

## Section 6: Components to Keep vs Remove

### 6.1 KEEP from PR #209

**Backend:**
✓ `backend/src/mcp-servers/` - Complete MCP servers module

- Controller (CRUD endpoints)
- Service (business logic)
- Repository (database operations)
- DTOs (API contracts)
- Encryption service (header encryption)
- Module definition

✓ `backend/src/database/schema/mcp-servers.ts` - Database schema

✓ MCP Library management endpoints:

- `GET /mcp-servers` - List all servers
- `GET /mcp-servers/:id` - Get server details
- `POST /mcp-servers` - Create server
- `PATCH /mcp-servers/:id` - Update server
- `DELETE /mcp-servers/:id` - Delete server
- `POST /mcp-servers/:id/toggle` - Enable/disable
- `POST /mcp-servers/:id/test` - Test connection
- `GET /mcp-servers/:id/tools` - List tools
- `GET /mcp-servers/health` - Health status

**Frontend:**
✓ `frontend/src/pages/McpLibraryPage.tsx` - Main management UI
✓ `frontend/src/store/mcpServerStore.ts` - State management
✓ `frontend/src/hooks/useMcpHealthPolling.ts` - Health polling
✓ `frontend/src/components/layout/AppLayout.tsx` - Nav item
✓ `frontend/src/App.tsx` - Route

**Worker:**
✓ `worker/src/services/mcp-client.service.ts` - **For health checks only** (mark deprecated)
✓ `worker/src/temporal/activities/mcp-library.activity.ts` - Rename to `mcp-library-config.activity.ts`

**Shared:**
✓ `packages/shared/src/mcp.ts` - Shared MCP types

### 6.2 REMOVE/REFACTOR from PR #209

**Worker:**
✗ `worker/src/components/ai/ai-agent.ts` - Direct MCP client code

- Remove: `getMcpClientService()` usage
- Remove: `mcpLibraryEnabled` parameter
- Remove: `mcpLibraryServerExclusions` parameter
- Remove: `mcpLibraryToolExclusions` parameter
- Remove: Direct stdio/HTTP/SSE/WebSocket transport creation
- Keep: Gateway-based tool discovery (from PR #243)

✗ `worker/src/components/ai/ai-agent.ts` - MCP tool loading logic

- Remove: Direct tool discovery from library
- Keep: Gateway tool discovery via `createMCPClient`

### 6.3 KEEP from PR #243 (Foundation)

**Backend:**
✓ `backend/src/mcp/` - Complete MCP module

- Gateway service (tool routing)
- Gateway controller (StreamableHTTP endpoint)
- Tool registry (Redis-backed)
- Internal MCP API (registration endpoints)
- Auth guard (JWT session tokens)
- Auth service (token generation)

✓ Docker-based stdio server handling
✓ StreamableHTTP transport
✓ Tool scoping via connectedNodeIds
✓ Runtime tool registration

**Worker:**
✓ `worker/src/components/ai/ai-agent.ts` - Gateway-based implementation
✓ `worker/src/components/core/mcp-runtime.ts` - Docker container management
✓ `worker/src/temporal/activities/` - MCP runtime activities

**Frontend:**
✓ Tool mode UI (workflow canvas integration)
✓ Agent configuration panels

---

## Section 7: Architecture Diagrams

### 7.1 PR #209 Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PR #209: MCP Library Architecture                    │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────┐                    ┌────────────────┐
│   Frontend     │                    │   Backend      │
│                │                    │                │
│ ┌────────────┐ │                    │ ┌────────────┐ │
│ │   MCP      │ │                    │ │   MCP      │ │
│ │  Library   │ │                    │ │  Servers   │ │
│ │    UI      │ │                    │ │ Controller │ │
│ └─────┬──────┘ │                    │ └─────┬──────┘ │
│       │        │                    │       │        │
│       │ REST   │                    │       │        │
│       │ API    │                    │       │        │
└───────┼────────┘                    └───────┼────────┘
        │                                     │
        │                                     │
        ▼                                     ▼
┌────────────────┐                   ┌────────────────┐
│   MCP Server   │                   │   PostgreSQL   │
│  Configurations│                   │    Database    │
│                │                   │                │
│ • HTTP         │                   │ ┌────────────┐ │
│ • Stdio        │                   │ │mcp_servers │ │
│ • SSE          │                   │ │   table    │ │
│ • WebSocket    │                   │ └────────────┘ │
└────────────────┘                   └────────────────┘

         │
         │ Direct Connection
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                     Worker / AI Agent                   │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  McpClientService (Direct Connections)         │    │
│  │                                                │    │
│  │  • HTTP Client                                 │    │
│  │  • SSE Client                                  │    │
│  │  • WebSocket Client                            │    │
│  │  • Stdio Process (direct spawn)                │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │
         │ Direct Calls
         │
         ▼
┌────────────────┐
│  MCP Servers   │
│                │
│ • npx @modelcontextprotocol-server-github
│ • npx @modelcontextprotocol-server-postgres
│ • Custom HTTP endpoints
└────────────────┘

KEY CHARACTERISTICS:
✓ Persistent configuration storage
✓ Management UI
✓ Health check polling
✗ Direct stdio processes (no isolation)
✗ Agent bypasses gateway (no monitoring)
✗ No tool scoping
```

### 7.2 PR #243 Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  PR #243: Tool Mode Architecture                       │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────┐                    ┌────────────────┐
│   Frontend     │                    │   Backend      │
│                │                    │                │
│ ┌────────────┐ │                    │ ┌────────────┐ │
│ │  Tool Mode │ │                    │ │   MCP      │ │
│ │    UI      │ │                    │ │  Gateway   │ │
│ └─────┬──────┘ │                    │ │  Service   │ │
│       │        │                    │ └─────┬──────┘ │
│       │        │                    │       │        │
│       │        │                    │ ┌─────┴──────┐ │
│       │        │                    │ │   Tool     │ │
│       │        │                    │ │  Registry  │ │
│       │        │                    │ │  (Redis)   │ │
└───────┼────────┘                    │ └─────────────┘ │
        │                             └───────┬────────┘
        │                                     │
        │ Internal API                        │
        │                                     │
        ▼                                     │
┌────────────────┐                   ┌────────────────┐
│   Workflow     │                   │   MCP Gateway  │
│  Configuration │                   │   Controller   │
│                │                   │  /mcp/gateway  │
│ • Tool Mode    │                   └───────┬────────┘
│   Nodes        │                           │ StreamableHTTP
└────────────────┘                           │
                                            │
        │                                     │
        │ Internal Registration                │
        │                                     │
        ▼                                     │
┌─────────────────────────────────────┐       │
│         Internal MCP API            │       │
│         /internal/mcp/*             │       │
│                                     │       │
│  • register-component-tool          │       │
│  • register-remote-mcp              │       │
│  • register-local-mcp (stdio)       │       │
│  • generate-gateway-token           │       │
└──────────────┬──────────────────────┘       │
               │                              │
               │                              │
               ▼                              │
      ┌────────────────┐                     │
      │  Docker        │                     │
      │  Containers    │                     │
      │  (stdio MCPs)  │                     │
      │                │                     │
      │ ┌────────────┐ │                     │
      │ │ HTTP Proxy │◄┼─────────────────────┘
      │ └────────────┘ │
      └────────────────┘
               │
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                     Worker / AI Agent                   │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  createMCPClient (via SDK)                     │    │
│  │                                                │    │
│  │  gatewayUrl: /mcp/gateway                      │    │
│  │  token: JWT session token                     │    │
│  │                                                │    │
│  │  Tools discovered from gateway                 │    │
│  │  Tool calls routed through gateway             │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │
         │ Via Gateway
         │
         ▼
┌────────────────┐
│  Tool Targets  │
│                │
│ • Components   │
│ • Docker MCPs  │
│ • Remote MCPs  │
└────────────────┘

KEY CHARACTERISTICS:
✓ Centralized gateway (monitoring, logging)
✓ Docker isolation for stdio servers
✓ Tool scoping via connectedNodeIds
✓ Runtime tool registration
✗ No persistent server configuration UI
```

### 7.3 Proposed Merged Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│              MERGED: MCP Library + Tool Mode Architecture                 │
└────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────┐         ┌───────────────────────┐
│      Frontend         │         │       Backend          │
│                       │         │                       │
│ ┌─────────────────┐   │         │ ┌─────────────────┐   │
│ │   MCP Library   │   │         │ │   MCP Gateway   │   │
│ │  Management UI  │   │         │ │    Service      │   │
│ │                 │   │         │ │                 │   │
│ │ • CRUD Servers  │   │         │ │ • Tool Routing  │   │
│ │ • Health Checks │   │         │ │ • Component Exec│   │
│ │ • Tool Discovery│   │         │ │ • MCP Proxying  │   │
│ └────────┬────────┘   │         │ └────────┬────────┘   │
│          │            │         │          │            │
│ ┌────────▼────────┐   │         │ ┌────────▼────────┐   │
│ │  Tool Mode UI   │   │         │ │  Tool Registry  │   │
│ │  (Per Workflow) │   │         │ │   (Redis)       │   │
│ └─────────────────┘   │         │ └────────┬────────┘   │
└──────────┼────────────┘         └──────────┼────────────┘
           │                                │
           │                                │
           │ REST API                       │ Internal API
           │                                │
           ▼                                ▼
┌──────────────────────┐         ┌──────────────────────┐
│   MCP Servers API    │         │   Internal MCP API    │
│   /mcp-servers/*     │         │   /internal/mcp/*     │
│                      │         │                      │
│ • List servers       │         │ • Register tools      │
│ • Create server      │         │ • Generate token      │
│ • Update server      │         │ • Health check        │
│ • Delete server      │         │ • Cleanup             │
└──────────┬───────────┘         └──────────┬───────────┘
           │                                │
           │                                │
           │                                │
           ▼                                ▼
┌──────────────────────┐         ┌──────────────────────┐
│    PostgreSQL        │         │   MCP Gateway         │
│    mcp_servers table │         │   Controller          │
│                      │         │   /mcp/gateway        │
│ • Server configs     │         └──────────┬───────────┘
│ • Encrypted headers              │ StreamableHTTP
│ • Transport settings             │
│ • Health status                  │
└───────────────────────────────────┼──────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │   Docker     │ │   Remote     │ │  Component   │
           │ Containers   │ │   HTTP MCPs  │ │    Tools     │
           │              │ │              │ │              │
           │ ┌──────────┐ │ │              │ │              │
           │ │ Stdio    │ │ │              │ │              │
           │ │ Proxy    │ │ │              │ │              │
           │ └──────────┘ │ │              │ │              │
           └──────────────┘ └──────────────┘ └──────────────┘

                              │
                              │ Via Gateway
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Worker / AI Agent                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  AI Agent Component                                    │    │
│  │                                                        │    │
│  │  1. Get gateway token from Internal MCP API           │    │
│  │  2. Create MCP client:                                │    │
│  │     createMCPClient({ gatewayUrl, token })            │    │
│  │  3. Discover tools (scoped by connectedNodeIds)       │    │
│  │  4. Execute tools via gateway                         │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

DATA FLOW:

1. CONFIGURATION (User Action)
   User → MCP Library UI → /mcp-servers API → PostgreSQL
   Result: Server configuration stored

2. WORKFLOW DESIGN (User Action)
   User → Workflow Canvas → Add MCP Server Node
   Result: Node references server ID from library

3. RUNTIME INITIALIZATION (Temporal Workflow)
   Workflow → Internal MCP API → /internal/mcp/register-local-mcp
   Steps:
   a. Read server config from PostgreSQL
   b. If stdio: Spawn Docker container with HTTP proxy
   c. Get proxy endpoint
   d. Register tool in Redis Tool Registry

4. TOOL DISCOVERY (AI Agent)
   Agent → MCP Gateway → /mcp/gateway (with JWT token)
   Steps:
   a. Validate token (runId, organizationId, allowedNodeIds)
   b. Query Tool Registry for allowed tools
   c. Return tool list to agent

5. TOOL EXECUTION (AI Agent)
   Agent → MCP Gateway → Tool Target
   Routes:
   • Component tool → Temporal workflow signal
   • Local MCP (stdio) → HTTP proxy in Docker
   • Remote MCP (HTTP) → External HTTP call

6. HEALTH MONITORING
   MCP Library UI → Poll /mcp-servers/health
   Updates PostgreSQL health status

KEY BENEFITS:
✓ Persistent server configuration (from PR #209)
✓ Centralized gateway with monitoring (from PR #243)
✓ Docker isolation for stdio servers (from PR #243)
✓ Tool scoping via graph connections (from PR #243)
✓ Management UI (from PR #209)
✓ Runtime registration and discovery (from PR #243)
✓ Unified architecture using best of both PRs
```

---

## Section 8: Testing Checklist

### 8.1 Unit Tests

**Backend:**

- [ ] MCP Servers Service tests
  - [ ] `createServer()` - Creates server with encrypted headers
  - [ ] `updateServer()` - Updates server configuration
  - [ ] `toggleServer()` - Enables/disables server
  - [ ] `testServerConnection()` - Tests server connectivity
  - [ ] `getAllTools()` - Aggregates tools from all enabled servers
  - [ ] `getHealthStatuses()` - Returns health of all servers

- [ ] MCP Servers Encryption tests
  - [ ] Header encryption/decryption
  - [ ] Key rotation (if implemented)
  - [ ] Invalid ciphertext handling

- [ ] MCP Gateway Service tests
  - [ ] `getServerForRun()` - Creates/retrieves MCP server instance
  - [ ] `registerTools()` - Registers component and MCP tools
  - [ ] `callComponentTool()` - Executes component via Temporal
  - [ ] `proxyCallToExternal()` - Proxies to external MCP
  - [ ] Tool scoping with `allowedNodeIds`
  - [ ] Refresh servers on new tool registration

- [ ] Tool Registry tests
  - [ ] `registerComponentTool()` - Registers component tool
  - [ ] `registerLocalMcp()` - Registers stdio MCP
  - [ ] `registerRemoteMcp()` - Registers HTTP MCP
  - [ ] `getToolsForRun()` - Retrieves tools with scoping
  - [ ] Redis TTL expiration

**Worker:**

- [ ] AI Agent tests
  - [ ] Gateway-based tool discovery
  - [ ] Tool execution via gateway
  - [ ] Tool scoping with `connectedToolNodeIds`
  - [ ] Error handling for gateway failures
  - [ ] Conversation state management

- [ ] MCP Client Service tests (health check only)
  - [ ] `healthCheck()` - Tests server connectivity
  - [ ] Connection pooling and cleanup

### 8.2 Integration Tests

**Backend:**

- [ ] MCP Servers API integration
  - [ ] Create server via POST /mcp-servers
  - [ ] List servers via GET /mcp-servers
  - [ ] Update server via PATCH /mcp-servers/:id
  - [ ] Delete server via DELETE /mcp-servers/:id
  - [ ] Toggle server via POST /mcp-servers/:id/toggle
  - [ ] Test connection via POST /mcp-servers/:id/test
  - [ ] Get tools via GET /mcp-servers/:id/tools
  - [ ] Get health via GET /mcp-servers/health

- [ ] MCP Gateway integration
  - [ ] Session token generation via /internal/mcp/generate-token
  - [ ] Tool registration via /internal/mcp/register-\*
  - [ ] Tool discovery via /mcp/gateway
  - [ ] Tool execution via /mcp/gateway
  - [ ] Multi-agent tool scoping

**Worker → Backend:**

- [ ] MCP Library server discovery
- [ ] Docker container spawning for stdio servers
- [ ] HTTP proxy creation for stdio servers
- [ ] Tool registration with gateway
- [ ] Tool execution via gateway
- [ ] Container cleanup on completion

### 8.3 E2E Tests

**Full Workflow:**

- [ ] Create MCP server in Library UI
- [ ] Configure workflow with tool-mode node
- [ ] Run workflow with agent
- [ ] Verify agent discovers tools from gateway
- [ ] Verify agent executes tools successfully
- [ ] Verify tool execution is logged
- [ ] Verify container cleanup

**Multi-Agent Scenarios:**

- [ ] Two agents with different tool scopes
- [ ] Verify agents only see allowed tools
- [ ] Verify tool isolation between agents

**Error Scenarios:**

- [ ] MCP server unavailable (health check fails)
- [ ] Docker container fails to start
- [ ] Gateway token expires
- [ ] Tool execution timeout
- [ ] Invalid tool parameters

### 8.4 Performance Tests

**Concurrent Access:**

- [ ] Multiple workflows using same MCP server
- [ ] Multiple agents with different scopes
- [ ] Health check polling under load

**Resource Management:**

- [ ] Docker container cleanup
- [ ] Redis memory usage (tool registry)
- [ ] Connection pool limits

### 8.5 Security Tests

**Authentication:**

- [ ] Invalid session token rejected
- [ ] Expired session token rejected
- [ ] Cross-run access prevented

**Authorization:**

- [ ] Organization isolation enforced
- [ ] Tool scoping enforced via `allowedNodeIds`

**Data Protection:**

- [ ] Encrypted headers cannot be decrypted without key
- [ ] Credentials not logged
- [ ] Tool execution results not leaked

### 8.6 Migration Tests

**Database Migration:**

- [ ] Migration runs successfully
- [ ] Schema created correctly
- [ ] No data loss

**Backward Compatibility:**

- [ ] Existing workflows still work
- [ ] Tool mode nodes function correctly

---

## Appendix A: File Inventory

### PR #209 Files to Integrate

```
backend/src/mcp-servers/
├── mcp-servers.controller.ts
├── mcp-servers.dto.ts
├── mcp-servers.encryption.ts
├── mcp-servers.module.ts
├── mcp-servers.repository.ts
├── mcp-servers.service.ts
└── index.ts

backend/src/database/schema/
└── mcp-servers.ts

frontend/src/pages/
└── McpLibraryPage.tsx

frontend/src/store/
└── mcpServerStore.ts

frontend/src/hooks/
└── useMcpHealthPolling.ts

worker/src/services/
└── mcp-client.service.ts (health check only, mark deprecated)

worker/src/temporal/activities/
└── mcp-library.activity.ts (rename to mcp-library-config.activity.ts)

packages/shared/src/
└── mcp.ts
```

### PR #243 Files (Already on main)

```
backend/src/mcp/
├── mcp-gateway.controller.ts
├── mcp-gateway.service.ts
├── mcp-auth.guard.ts
├── mcp-auth.service.ts
├── mcp.module.ts
├── tool-registry.service.ts
├── internal-mcp.controller.ts
├── dto/
│   ├── mcp.dto.ts
│   └── mcp-gateway.dto.ts
└── index.ts

worker/src/components/ai/
└── ai-agent.ts (gateway implementation)

worker/src/components/core/
└── mcp-runtime.ts
```

---

## Appendix B: Command Reference

### Merge Commands

```bash
# Start from main
git checkout main
git pull origin main

# Create merge branch
git checkout -b merge/mcp-library-tool-mode

# Merge PR #209
git merge origin/mcp-library --no-commit

# Resolve conflicts (see Section 4)
# ... edit files ...

# Check status
git status

# Add resolved files
git add <resolved-files>

# Complete merge
git commit -m "feat: merge MCP Library with Tool Mode"

# Push to remote (optional)
git push origin merge/mcp-library-tool-mode
```

### Database Migration Commands

```bash
cd backend

# Generate migration (if needed)
bun run migrate:generate --name=add_mcp_servers_table

# Run migrations
bun run migrate:run

# Revert migration (if needed)
bun run migrate:revert
```

### Testing Commands

```bash
# Backend tests
cd backend
bun run test

# Worker tests
cd worker
bun run test

# E2E tests
cd e2e-tests
bun run test

# Linting
bun run lint

# Type checking
bun run typecheck
```

---

## Appendix C: Contact and Resources

**Document Maintainer:** Technical Documentation Team
**Last Updated:** 2026-02-02
**Version:** 1.0

**Related Resources:**

- PR #209: https://github.com/ShipSecAI/studio/pull/209
- PR #243: https://github.com/ShipSecAI/studio/pull/243
- MCP Specification: https://modelcontextprotocol.io/

**Change Log:**

| Version | Date       | Changes                   |
| ------- | ---------- | ------------------------- |
| 1.0     | 2026-02-02 | Initial document creation |

---

**END OF DOCUMENT**
