# MCP Library Component - Implementation Plan

**Document Version:** 1.0
**Date:** 2026-02-02
**Status:** READY FOR IMPLEMENTATION
**Based On:** MCP_ARCHITECTURE_MERGE_PLAN.md + MCP_LIBRARY_COMPONENT_DESIGN.md

---

## Executive Summary

This plan implements the **MCP Library Component** as a tool provider that:
1. Multi-selects MCP servers from backend (via `/api/v1/mcp-servers`)
2. Exposes a `tools` output port (contract: `mcp.tool`)
3. Registers selected servers' tools in Tool Registry
4. Works seamlessly with existing AI Agent (no changes needed)

**Key Design Principle:** The MCP Library is just another tool-mode node - same pattern, different selection method.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      WORKFLOW CANVAS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐                                          │
│  │  MCP Library     │  ┌──────────────┐                       │
│  │  Component       │──│ tools port   │──┐                    │
│  │                  │  │ (contract)    │  │                    │
│  │ enabledServers:  │  │ mcp.tool     │  │                    │
│  │ [               │  └──────────────┘  │                    │
│  │   "aws-ct",     │                    │                    │
│  │   "aws-cw"      │                    ▼                    │
│  │ ]               │           ┌──────────────────┐           │
│  └──────────────────┘           │  AI Agent        │           │
│                                │                  │           │
│                                │  tools port ◀────┘           │
│                                │                               │
│                                │  Discovers all tools           │
│                                │  via MCP Gateway               │
│                                └──────────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Data Flow:
1. User selects servers in MCP Library node (e.g., "aws-cloudtrail", "aws-cloudwatch")
2. Workflow executes → MCP Library component runs
3. Component fetches server details from backend API
4. Component calls /internal/mcp/register-local for each server
5. Backend registers tools in Tool Registry (Redis)
6. AI Agent discovers tools via MCP Gateway (same as any tool-mode node)
```

---

## Phase Breakdown

### **PHASE 0: Pre-Implementation Setup**

**Objective:** Ensure environment is ready and verify existing infrastructure

**Dependencies:** None

**Files to Check/Verify:**
- `backend/src/mcp/tool-registry.service.ts` - Verify `registerLocalMcp()` exists
- `backend/src/mcp/internal-mcp.controller.ts` - Verify `/internal/mcp/register-local` endpoint
- `worker/src/components/core/mcp-runtime.ts` - Reference for Docker container spawning
- `worker/src/components/ai/ai-agent.ts` - Verify tools port works with contract

**Validation Criteria:**
- [ ] Tool Registry service has `registerLocalMcp()` method
- [ ] Internal MCP controller has `register-local` endpoint
- [ ] MCP Gateway is operational
- [ ] Docker is available for stdio server containers
- [ ] Redis is running for Tool Registry

**Testing Approach:**
```bash
# Verify backend MCP module loads
cd backend && bun run test:unit -- test=mcp

# Verify tool registry endpoints
curl -X POST http://localhost:3000/internal/mcp/generate-token \
  -H "Content-Type: application/json" \
  -d '{"runId":"test"}'

# Verify Redis is accessible
redis-cli ping
```

**Commit Message Template:**
```
chore: verify MCP infrastructure readiness

- Confirm Tool Registry has registerLocalMcp method
- Verify Internal MCP API endpoints operational
- Test MCP Gateway connectivity
- Validate Redis and Docker availability

This is a verification commit - no code changes.
```

---

### **PHASE 1: Backend - MCP Servers API**

**Objective:** Add API endpoints for MCP Library to fetch available servers

**Dependencies:** Phase 0 complete

**Files to Create:**
- `backend/src/mcp-servers/dto/mcp-library.dto.ts` - DTOs for library API
- `backend/src/mcp-servers/mcp-servers.controller.ts` - REST controller
- `backend/src/mcp-servers/mcp-servers.service.ts` - Business logic
- `backend/src/mcp-servers/mcp-servers.module.ts` - NestJS module
- `backend/src/mcp-servers/index.ts` - Barrel export

**Files to Modify:**
- `backend/src/app.module.ts` - Import McpServersModule
- `backend/src/database/schema/index.ts` - Export mcp-servers schema (if exists)

**Implementation Details:**

#### 1.1 Create DTOs

```typescript
// backend/src/mcp-servers/dto/mcp-library.dto.ts
import { z } from 'zod';

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['stdio', 'http', 'sse', 'websocket']),
  transport: z.object({
    // For stdio servers
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    // For HTTP servers
    endpoint: z.string().optional(),
  }),
  enabled: z.boolean(),
  healthStatus: z.enum(['healthy', 'unhealthy', 'unknown']),
  toolCount: z.number().optional(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSchema),
});

export type ListMcpServersResponse = z.infer<typeof ListMcpServersResponseSchema>;
```

#### 1.2 Create Controller

```typescript
// backend/src/mcp-servers/mcp-servers.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { McpServersService } from './mcp-servers.service';

@Controller('v1/mcp-servers')
export class McpServersController {
  constructor(private readonly service: McpServersService) {}

  @Get()
  async listServers() {
    return this.service.listServers();
  }

  @Get(':id')
  async getServer(@Query('id') id: string) {
    return this.service.getServer(id);
  }
}
```

#### 1.3 Create Service (Stub Implementation)

```typescript
// backend/src/mcp-servers/mcp-servers.service.ts
import { Injectable } from '@nestjs/common';
import type { McpServer, ListMcpServersResponse } from './dto/mcp-library.dto';

@Injectable()
export class McpServersService {
  // TODO: In future PR, this will read from PostgreSQL database
  // For now, return hardcoded AWS MCP servers
  async listServers(): Promise<ListMcpServersResponse> {
    const servers: McpServer[] = [
      {
        id: 'aws-cloudtrail',
        name: 'AWS CloudTrail',
        description: 'Query AWS CloudTrail logs for API activity',
        type: 'stdio',
        transport: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
        },
        enabled: true,
        healthStatus: 'healthy',
        toolCount: 15,
      },
      {
        id: 'aws-cloudwatch',
        name: 'AWS CloudWatch',
        description: 'Query AWS CloudWatch metrics and logs',
        type: 'stdio',
        transport: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-aws-cloudwatch'],
        },
        enabled: true,
        healthStatus: 'healthy',
        toolCount: 8,
      },
      {
        id: 'filesystem',
        name: 'Filesystem',
        description: 'Read and write local files',
        type: 'stdio',
        transport: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp'],
        },
        enabled: true,
        healthStatus: 'healthy',
        toolCount: 6,
      },
    ];

    return { servers };
  }

  async getServer(id: string): Promise<McpServer | null> {
    const { servers } = await this.listServers();
    return servers.find(s => s.id === id) || null;
  }
}
```

#### 1.4 Create Module

```typescript
// backend/src/mcp-servers/mcp-servers.module.ts
import { Module } from '@nestjs/common';
import { McpServersController } from './mcp-servers.controller';
import { McpServersService } from './mcp-servers.service';

@Module({
  controllers: [McpServersController],
  providers: [McpServersService],
  exports: [McpServersService],
})
export class McpServersModule {}
```

#### 1.5 Update App Module

```typescript
// backend/src/app.module.ts
import { McpServersModule } from './mcp-servers/mcp-servers.module';

@Module({
  imports: [
    // ... existing imports
    McpServersModule,
  ],
})
export class AppModule {}
```

**Validation Criteria:**
- [ ] `GET /api/v1/mcp-servers` returns list of servers
- [ ] Response includes AWS CloudTrail, CloudWatch, Filesystem servers
- [ ] Each server has id, name, type, transport fields
- [ ] TypeScript compiles without errors
- [ ] API is accessible via curl or Postman

**Testing Approach:**
```bash
# Unit tests
cd backend
bun run test:unit -- test=mcp-servers

# Integration test
curl http://localhost:3000/api/v1/mcp-servers | jq .
```

**Commit Message Template:**
```
feat: add MCP servers API endpoint

- Add GET /api/v1/mcp-servers to list available MCP servers
- Add GET /api/v1/mcp-servers/:id to get server details
- Include AWS CloudTrail, CloudWatch, Filesystem servers
- Returns server metadata (id, name, type, transport config)
- Stub implementation with hardcoded servers (database in future PR)

This enables MCP Library component to fetch available servers.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### **PHASE 2: Worker - MCP Library Component**

**Objective:** Create the `core.mcp.library` component

**Dependencies:** Phase 1 complete (API endpoint available)

**Files to Create:**
- `worker/src/components/core/mcp-library.ts` - Main component definition
- `worker/src/components/core/mcp-library-utils.ts` - Helper functions

**Files to Modify:**
- None (new component)

**Implementation Details:**

#### 2.1 Create Component

```typescript
// worker/src/components/core/mcp-library.ts
import { z } from 'zod';
import {
  defineComponent,
  outputs,
  parameters,
  param,
  port,
} from '@shipsec/component-sdk';
import {
  fetchEnabledServers,
  registerServerTools,
} from './mcp-library-utils';

const parameterSchema = parameters({
  enabledServers: param(
    z.array(z.string()).default([]).describe('Array of MCP server IDs to enable'),
    {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select MCP servers to enable tools from',
      loadOptionsFrom: '/api/v1/mcp-servers',
    },
  ),
});

const outputSchema = outputs({
  tools: port(
    z.unknown().optional().describe('MCP tools from selected servers'),
    {
      label: 'Tools',
      description: 'MCP tools from selected servers',
      connectionType: { kind: 'contract', name: 'mcp.tool' },
    },
  ),
});

const definition = defineComponent({
  id: 'core.mcp.library',
  label: 'MCP Library',
  category: 'mcp',
  inputs: {},
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Select and enable MCP servers from the MCP Library. All tools from selected servers will be available to connected AI agents.',
  ui: {
    slug: 'mcp-library',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description: 'Select multiple MCP servers from a library to expose their tools to AI agents.',
    icon: 'Library',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    agentTool: {
      enabled: true,
      toolName: 'mcp_library',
      toolDescription: 'Expose MCP Library tools from configured servers.',
    },
    isLatest: true,
  },
  async execute({ params }, context) {
    const { enabledServers } = params;

    // 1. Fetch server details from backend
    const servers = await fetchEnabledServers(enabledServers, context);

    // 2. Register each server's tools with Tool Registry
    for (const server of servers) {
      await registerServerTools(server, context);
    }

    // 3. Return empty (tools are registered, not returned as data)
    return {};
  },
});

export default definition;
```

#### 2.2 Create Utils

```typescript
// worker/src/components/core/mcp-library-utils.ts
import { z } from 'zod';
import type { ComponentContext } from '@shipsec/component-sdk';
import { startMcpDockerServer } from './mcp-runtime';

// Schema matching backend API response
const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['stdio', 'http', 'sse', 'websocket']),
  transport: z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    endpoint: z.string().optional(),
  }),
  enabled: z.boolean(),
  healthStatus: z.enum(['healthy', 'unhealthy', 'unknown']),
  toolCount: z.number().optional(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSchema),
});

/**
 * Fetch server details from backend API
 */
export async function fetchEnabledServers(
  serverIds: string[],
  context: ComponentContext,
): Promise<McpServer[]> {
  if (serverIds.length === 0) {
    return [];
  }

  const backendUrl = context.secrets.backendUrl || process.env.BACKEND_URL || 'http://localhost:3000';

  // Fetch all servers
  const response = await fetch(`${backendUrl}/api/v1/mcp-servers`);
  if (!response.ok) {
    throw new Error(`Failed to fetch MCP servers: ${response.statusText}`);
  }

  const data = await response.json();
  const parsed = ListMcpServersResponseSchema.parse(data);

  // Filter to only enabled servers
  return parsed.servers.filter(s => serverIds.includes(s.id) && s.enabled);
}

/**
 * Register a single server's tools with Tool Registry
 */
export async function registerServerTools(
  server: McpServer,
  context: ComponentContext,
): Promise<void> {
  const backendUrl = context.secrets.backendUrl || process.env.BACKEND_URL || 'http://localhost:3000';

  // For stdio servers, we need to spawn a Docker container
  if (server.type === 'stdio') {
    const { endpoint, containerId } = await startMcpDockerServer({
      image: 'shipsec/mcp-stdio-proxy:latest',
      command: [],
      env: {
        MCP_COMMAND: server.transport.command || '',
        MCP_ARGS: JSON.stringify(server.transport.args || []),
      },
      port: 0, // Auto-assign port
      params: {},
      context,
    });

    // Register the stdio server with the endpoint
    await registerWithBackend(server.id, endpoint, containerId, context);
  }
  // For HTTP servers, register directly
  else if (server.type === 'http' && server.transport.endpoint) {
    await registerWithBackend(server.id, server.transport.endpoint, undefined, context);
  } else {
    throw new Error(`Unsupported server type: ${server.type}`);
  }
}

/**
 * Register server with backend Tool Registry
 */
async function registerWithBackend(
  serverId: string,
  endpoint: string,
  containerId: string | undefined,
  context: ComponentContext,
): Promise<void> {
  const backendUrl = context.secrets.backendUrl || process.env.BACKEND_URL || 'http://localhost:3000';
  const internalApiUrl = `${backendUrl}/internal/mcp`;

  const response = await fetch(`${internalApiUrl}/register-local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: context.executionId,
      nodeId: context.nodeId,
      serverId,
      endpoint,
      containerId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to register server ${serverId}: ${response.statusText}`);
  }
}
```

**Validation Criteria:**
- [ ] Component compiles without TypeScript errors
- [ ] Component appears in workflow palette under "mcp" category
- [ ] Parameter editor shows multi-select for servers
- [ ] Tools output port has contract `mcp.tool`
- [ ] Component can be added to workflow canvas
- [ ] Unit tests pass

**Testing Approach:**
```bash
# Unit tests
cd worker
bun run test:unit -- test=mcp-library

# Type check
bun run typecheck

# Verify component registration
grep -r "core.mcp.library" dist/
```

**Commit Message Template:**
```
feat: add MCP Library component

- Add core.mcp.library component with multi-select server parameter
- Fetch available servers from /api/v1/mcp-servers
- Spawn Docker containers for stdio servers
- Register servers with Tool Registry via /internal/mcp/register-local
- Expose tools output port (contract: mcp.tool)
- Works seamlessly with existing AI Agent component

The MCP Library provides a centralized way to select and enable
multiple MCP servers without needing individual server nodes.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### **PHASE 3: Frontend - UI Integration**

**Objective:** Add MCP Library to workflow canvas and create parameter editor

**Dependencies:** Phase 2 complete (component exists)

**Files to Create:**
- `frontend/src/components/workflow/McpLibraryNode.tsx` - Node UI component
- `frontend/src/components/workflow/McpLibraryConfigPanel.tsx` - Parameter editor

**Files to Modify:**
- `frontend/src/components/workflow/nodes.ts` - Register node type
- `frontend/src/store/mcpServerStore.ts` - Already exists from PR #209

**Implementation Details:**

#### 3.1 Create Node UI

```tsx
// frontend/src/components/workflow/McpLibraryNode.tsx
import React from 'react';
import { Library } from 'lucide-react';

interface McpLibraryNodeProps {
  data: {
    label: string;
    enabledServers: string[];
  };
}

export const McpLibraryNode: React.FC<McpLibraryNodeProps> = ({ data }) => {
  return (
    <div className="mcp-library-node">
      <div className="node-header">
        <Library className="node-icon" />
        <span className="node-title">{data.label || 'MCP Library'}</span>
      </div>
      <div className="node-body">
        <div className="server-count">
          {data.enabledServers?.length || 0} servers enabled
        </div>
      </div>
      {/* Tools output port */}
      <div className="node-port tools-port">tools</div>
    </div>
  );
};
```

#### 3.2 Create Config Panel

```tsx
// frontend/src/components/workflow/McpLibraryConfigPanel.tsx
import React, { useEffect, useState } from 'react';
import { useStore } from '@/store/mcpServerStore';
import type { McpServer } from '@/types/mcp';

interface McpLibraryConfigPanelProps {
  value: string[];
  onChange: (servers: string[]) => void;
}

export const McpLibraryConfigPanel: React.FC<McpLibraryConfigPanelProps> = ({
  value,
  onChange,
}) => {
  const { servers, loading, error, fetchServers } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set(value));

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    onChange(Array.from(selected));
  }, [selected, onChange]);

  const toggleServer = (serverId: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(serverId)) {
      newSelected.delete(serverId);
    } else {
      newSelected.add(serverId);
    }
    setSelected(newSelected);
  };

  if (loading) {
    return <div>Loading MCP servers...</div>;
  }

  if (error) {
    return <div>Error loading servers: {error}</div>;
  }

  return (
    <div className="mcp-library-selector">
      <h3>Select MCP Servers</h3>
      <div className="server-list">
        {servers.map((server: McpServer) => (
          <div
            key={server.id}
            className={`server-item ${selected.has(server.id) ? 'selected' : ''}`}
            onClick={() => toggleServer(server.id)}
          >
            <input
              type="checkbox"
              checked={selected.has(server.id)}
              onChange={() => toggleServer(server.id)}
            />
            <div className="server-info">
              <div className="server-name">{server.name}</div>
              <div className="server-description">{server.description}</div>
              <div className="server-meta">
                <span className={`status ${server.healthStatus}`}>
                  {server.healthStatus}
                </span>
                <span className="tool-count">{server.toolCount} tools</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

#### 3.3 Register Node Type

```typescript
// frontend/src/components/workflow/nodes.ts
import { McpLibraryNode } from './McpLibraryNode';

export const nodeTypes = {
  // ... existing nodes
  'core.mcp.library': McpLibraryNode,
};
```

**Validation Criteria:**
- [ ] MCP Library appears in workflow node palette
- [ ] Dragging node to canvas creates node instance
- [ ] Config panel shows server list with checkboxes
- [ ] Selecting servers updates node parameters
- [ ] Tools port is visible and connectable
- [ ] Can connect to AI Agent tools input

**Testing Approach:**
```bash
# Frontend dev server
cd frontend
bun run dev

# Manual testing:
# 1. Open workflow editor
# 2. Add MCP Library node
# 3. Configure servers
# 4. Connect to AI Agent
# 5. Save workflow
```

**Commit Message Template:**
```
feat: add MCP Library UI components

- Add McpLibraryNode component for canvas rendering
- Add McpLibraryConfigPanel for server selection
- Display server health status and tool count
- Support multi-select with checkboxes
- Register node type in workflow editor

Users can now visually select MCP servers from the library
and connect them to AI agents via the tools port.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### **PHASE 4: Integration Testing**

**Objective:** End-to-end test of MCP Library workflow

**Dependencies:** Phases 1-3 complete

**Files to Create:**
- `e2e-tests/tests/mcp-library.e2e.test.ts` - E2E test suite

**Files to Modify:**
- None (new tests)

**Test Scenarios:**

#### 4.1 E2E Test

```typescript
// e2e-tests/tests/mcp-library.e2e.test.ts
import { test, expect } from '@playwright/test';

test.describe('MCP Library E2E', () => {
  test('should select servers and register tools', async ({ page }) => {
    // 1. Login and navigate to workflow editor
    await page.goto('/workflows/new');
    await page.waitForSelector('[data-testid="workflow-canvas"]');

    // 2. Add MCP Library node
    await page.dragAndDrop(
      '[data-node-type="core.mcp.library"]',
      '[data-testid="workflow-canvas"]',
    );

    // 3. Configure MCP Library
    await page.click('[data-testid="mcp-library-node"]');
    await page.click('[data-testid="configure-servers"]');

    // 4. Select AWS CloudTrail server
    await page.check('[data-server-id="aws-cloudtrail"]');

    // 5. Add AI Agent node
    await page.dragAndDrop(
      '[data-node-type="ai.agent"]',
      '[data-testid="workflow-canvas"]',
    );

    // 6. Connect MCP Library tools to AI Agent tools
    await page.dragAndDrop(
      '[data-port="mcp-library-tools"]',
      '[data-port="ai-agent-tools"]',
    );

    // 7. Save workflow
    await page.click('[data-testid="save-workflow"]');
    await page.waitForSelector('[data-testid="save-success"]');

    // 8. Run workflow
    await page.click('[data-testid="run-workflow"]');
    await page.waitForSelector('[data-testid="run-complete"]', {
      timeout: 30000,
    });

    // 9. Verify tools were registered
    const logs = await page.evaluate(() =>
      // @ts-ignore
      window.getExecutionLogs(),
    );

    expect(logs).toContain('Registered tools from server: aws-cloudtrail');
  });

  test('should handle multiple servers', async ({ page }) => {
    // Test multi-select behavior
    await page.goto('/workflows/new');
    await page.dragAndDrop(
      '[data-node-type="core.mcp.library"]',
      '[data-testid="workflow-canvas"]',
    );

    await page.click('[data-testid="configure-servers"]');
    await page.check('[data-server-id="aws-cloudtrail"]');
    await page.check('[data-server-id="aws-cloudwatch"]');

    const selectedCount = await page.textContent(
      '[data-testid="selected-count"]',
    );
    expect(selectedCount).toBe('2 servers enabled');
  });
});
```

**Validation Criteria:**
- [ ] E2E test for single server selection passes
- [ ] E2E test for multiple server selection passes
- [ ] Tools are registered in Tool Registry
- [ ] AI Agent can discover and call tools
- [ ] Docker containers are spawned for stdio servers
- [ ] Containers are cleaned up after run

**Testing Approach:**
```bash
# Run E2E tests
cd e2e-tests
bun run test mcp-library

# Or run with UI for debugging
bun run test:debug mcp-library
```

**Commit Message Template:**
```
test: add MCP Library E2E tests

- Test single server selection and tool registration
- Test multiple server selection
- Verify tools are discoverable by AI Agent
- Verify Docker container lifecycle
- Verify container cleanup

These tests ensure the MCP Library component works
end-to-end with the existing MCP Gateway infrastructure.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### **PHASE 5: Documentation**

**Objective:** Document usage and architecture

**Dependencies:** Phases 1-4 complete

**Files to Create:**
- `docs/workflows/mcp-library.md` - User documentation
- `docs/architecture/mcp-library.md` - Architecture documentation

**Files to Modify:**
- `README.md` - Add MCP Library section

**Documentation Content:**

#### 5.1 User Documentation

```markdown
# MCP Library Component

## Overview

The MCP Library component provides a centralized way to select and enable multiple MCP servers without needing individual server nodes in your workflow.

## Usage

1. **Add MCP Library Node**
   - Drag "MCP Library" from the "MCP" category to your canvas

2. **Configure Servers**
   - Click the node to open configuration
   - Select servers from the list (e.g., AWS CloudTrail, CloudWatch)
   - Each server shows health status and tool count

3. **Connect to AI Agent**
   - Connect the "tools" output port to AI Agent's "tools" input
   - All tools from selected servers are now available to the agent

## Example Workflow

```
MCP Library (aws-cloudtrail + aws-cloudwatch)
    ↓ tools
AI Agent → Chat with user
    ↓
Response
```

## Available Servers

- **AWS CloudTrail** - Query API activity logs (15 tools)
- **AWS CloudWatch** - Query metrics and logs (8 tools)
- **Filesystem** - Read/write local files (6 tools)

## Architecture

The MCP Library:
1. Fetches available servers from backend API
2. Spawns Docker containers for stdio servers
3. Registers tools with Tool Registry
4. AI Agent discovers tools via MCP Gateway
```

#### 5.2 Architecture Documentation

```markdown
# MCP Library Architecture

## Component ID: `core.mcp.library`

## Ports

**Outputs:**
- `tools` (contract: `mcp.tool`) - Anchor port for tool registration

## Parameters

- `enabledServers` (string[], default: []) - Array of server IDs to enable

## Execution Flow

1. **Fetch Servers** - GET /api/v1/mcp-servers
2. **Filter** - Only enabled servers in `enabledServers`
3. **Spawn Containers** - For each stdio server:
   - Start Docker container with MCP stdio proxy
   - Get HTTP endpoint (e.g., http://localhost:12345/mcp)
4. **Register Tools** - POST /internal/mcp/register-local for each server
5. **Discovery** - AI Agent discovers via MCP Gateway

## Integration Points

- **Backend API** - /api/v1/mcp-servers (server list)
- **Internal API** - /internal/mcp/register-local (tool registration)
- **Tool Registry** - Redis (tool metadata storage)
- **MCP Gateway** - /mcp/gateway (tool discovery/execution)

## Future Enhancements

- [ ] Database-backed server configuration (PostgreSQL)
- [ ] Custom server registration
- [ ] Per-server credential management
- [ ] Health check polling
- [ ] Tool exclusion filters
```

**Validation Criteria:**
- [ ] User documentation is clear and complete
- [ ] Architecture diagram is accurate
- [ ] Example workflows are provided
- [ ] README is updated with MCP Library section
- [ ] Documentation builds without errors

**Testing Approach:**
```bash
# If using docs framework (e.g., Docusaurus)
cd docs
bun run build

# Or verify markdown files
find docs -name "*.md" -exec grep -l "MCP Library" {} \;
```

**Commit Message Template:**
```
docs: add MCP Library documentation

- Add user guide for MCP Library component
- Document architecture and integration points
- Provide example workflows
- Update README with MCP Library section
- Include troubleshooting guide

This documentation helps users understand when and how to
use the MCP Library component in their workflows.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Execution Order

### Phase Sequence

```
Phase 0: Pre-Implementation Setup
    ↓
Phase 1: Backend API (mcp-servers module)
    ↓
Phase 2: Worker Component (core.mcp.library)
    ↓
Phase 3: Frontend UI (nodes + config panel)
    ↓
Phase 4: Integration Testing (E2E)
    ↓
Phase 5: Documentation
```

### Git Branch Strategy

```bash
# Create feature branch
git checkout -b feature/mcp-library-component

# Phase 1 commit
git add backend/
git commit -m "feat: add MCP servers API endpoint"

# Phase 2 commit
git add worker/
git commit -m "feat: add MCP Library component"

# Phase 3 commit
git add frontend/
git commit -m "feat: add MCP Library UI"

# Phase 4 commit
git add e2e-tests/
git commit -m "test: add MCP Library E2E tests"

# Phase 5 commit
git add docs/
git commit -m "docs: add MCP Library documentation"

# Push and create PR
git push origin feature/mcp-library-component
```

---

## Validation Criteria Summary

### Per Phase Validation

| Phase | Key Deliverables | Validation Method |
|-------|-----------------|-------------------|
| **0** | Infrastructure verified | Manual smoke tests |
| **1** | API endpoint returns servers | `curl /api/v1/mcp-servers` |
| **2** | Component compiles and registers | `bun run typecheck` |
| **3** | UI renders and saves config | Manual browser test |
| **4** | E2E tests pass | `bun run test:e2e` |
| **5** | Documentation is complete | Documentation build |

### Overall Validation

- [ ] All phases complete and committed
- [ ] All tests pass (unit, integration, E2E)
- [ ] Documentation is complete
- [ ] Code review approved
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] Performance benchmarks met

---

## Risk Mitigation

### Known Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Docker container leaks** | High | Add cleanup in finally block, monitor containers |
| **Tool registration race conditions** | Medium | Use `tools-ready` endpoint before agent starts |
| **Backend API latency** | Low | Add caching in frontend store |
| **Stdio server crashes** | Medium | Health check before registration |
| **Port conflicts** | Low | Auto-assign ports, retry logic |

### Rollback Plan

If implementation fails:
1. Revert commits in reverse order (Phase 5 → Phase 1)
2. Delete feature branch
3. Document lessons learned
4. Adjust approach based on failure point

---

## Success Metrics

### Technical Metrics

- **Component Load Time** < 100ms
- **Server List API Response** < 200ms
- **Tool Registration** < 500ms per server
- **E2E Test Pass Rate** = 100%
- **Type Coverage** = 100%

### User Experience Metrics

- **Time to Add MCP Library** < 30 seconds
- **Time to Select Servers** < 1 minute
- **Workflow Save Success Rate** = 100%
- **Tool Discovery Rate** = 100%

---

## Next Steps After Implementation

### Future Enhancements (Out of Scope for This Plan)

1. **Database Persistence** - Store MCP server configs in PostgreSQL
2. **Custom Server Registration** - Allow users to add custom MCP servers
3. **Credential Management** - Per-server credential configuration
4. **Health Check Polling** - Real-time server health monitoring
5. **Tool Exclusion** - Exclude specific tools from servers
6. **Server Groups** - Group servers by environment/team
7. **Usage Analytics** - Track which servers are most used

### Follow-up PRs

- **PR #XXX**: Database-backed MCP server configurations
- **PR #XXX**: Custom MCP server registration UI
- **PR #XXX**: Per-server credential management
- **PR #XXX**: Health check polling and alerts

---

## Appendix: File Tree

```
shipsec-studio/
├── backend/
│   └── src/
│       ├── mcp-servers/
│       │   ├── dto/
│       │   │   └── mcp-library.dto.ts          [NEW]
│       │   ├── mcp-servers.controller.ts       [NEW]
│       │   ├── mcp-servers.service.ts          [NEW]
│       │   ├── mcp-servers.module.ts           [NEW]
│       │   └── index.ts                        [NEW]
│       └── app.module.ts                       [MODIFY]
├── worker/
│   └── src/
│       └── components/
│           └── core/
│               ├── mcp-library.ts               [NEW]
│               └── mcp-library-utils.ts         [NEW]
├── frontend/
│   └── src/
│       ├── components/
│       │   └── workflow/
│       │       ├── McpLibraryNode.tsx          [NEW]
│       │       ├── McpLibraryConfigPanel.tsx   [NEW]
│       │       └── nodes.ts                    [MODIFY]
│       └── store/
│           └── mcpServerStore.ts               [EXISTS from PR #209]
├── e2e-tests/
│   └── tests/
│       └── mcp-library.e2e.test.ts             [NEW]
├── docs/
│   ├── workflows/
│   │   └── mcp-library.md                      [NEW]
│   └── architecture/
│       └── mcp-library.md                      [NEW]
└── README.md                                   [MODIFY]
```

---

**END OF IMPLEMENTATION PLAN**
