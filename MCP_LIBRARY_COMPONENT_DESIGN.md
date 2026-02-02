# MCP Library Component Design

## Goal

Make MCP Library work like any other tool provider - using the same **"tools" port pattern** as tool-mode nodes and current MCP server components.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WORKFLOW CANVAS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐                                                      │
│  │ MCP Library      │  ┌──────────────┐                                   │
│  │ Component        │──│ tools port   │──┐                               │
│  │                  │  │ (contract)    │  │                               │
│  │ - Server config  │  └──────────────┘  │                               │
│  │ - Auth handling  │                    │                               │
│  │ - Multi-select   │                    ▼                               │
│  └──────────────────┘           ┌──────────────────┐                    │
│                              │  AI Agent        │                    │
│                              │                  │                    │
│                              │  tools port ◀────┘                    │
│                              │                  │                    │
│                              │  Discovers all    │                    │
│                              │  tools via       │                    │
│                              │  MCP Gateway      │                    │
│                              └──────────────────┘                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Definition

### `core.mcp.library`

```typescript
// worker/src/components/core/mcp-library.ts

import { defineComponent, outputs, port } from '@shipsec/component-sdk';

export const mcpLibraryComponent = defineComponent({
  id: 'core.mcp.library',
  category: 'mcp',
  title: 'MCP Library',
  description: 'Select and enable MCP servers from the MCP Library',

  // Input parameters (config)
  parameters: {
    enabledServers: param(z.array(z.string()).default([]), {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select MCP servers to enable tools from',
      // Options fetched from backend /api/v1/mcp-servers
      loadOptionsFrom: '/api/v1/mcp-servers',
    }),
  },

  // Output: tools port (same as tool-mode nodes)
  outputs: {
    tools: port(z.unknown().optional(), {
      label: 'Tools',
      description: 'MCP tools from selected servers',
      // This is the key - uses the same contract as tool-mode
      connectionType: { kind: 'contract', name: 'mcp.tool' },
    }),
  },

  // Tool mode metadata
  agentTool: {
    enabled: true,
    toolName: 'mcp_library',
    toolDescription: 'Expose MCP Library tools from configured servers.',
  },

  async execute(params, context) {
    const { enabledServers } = params;

    // 1. Fetch server details from backend
    const servers = await fetchEnabledServers(enabledServers, context);

    // 2. Register tools in Tool Registry
    for (const server of servers) {
      await registerMcpServerTools(server, context);
    }

    // 3. Return empty (tools are registered, not returned as data)
    return {};
  },
});
```

## Key Design Points

### 1. Same "tools" Port Pattern

```typescript
// This is exactly the same as tool-mode nodes and current MCP server components
outputs: {
  tools: port(z.unknown().optional(), {
    connectionType: { kind: 'contract', name: 'mcp.tool' },
  });
}
```

### 2. Multi-Select UI

The component parameter editor should:

- Fetch available servers from `/api/v1/mcp-servers`
- Show server name, description, health status
- Allow multi-selection
- Persist selection in workflow definition

### 3. Auth Handling

AWS MCP servers need special auth. Options:

**Option A: Contract-level auth (recommended)**

```typescript
// In the workflow, connect a Secret Loader to the MCP Library component
inputs: {
  awsCredentials: port(
    z.object({
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
      region: z.string().default('us-east-1'),
    }),
    {
      label: 'AWS Credentials',
      connectionType: { kind: 'contract', name: 'core.aws.credentials' },
    }
  ),
},
```

**Option B: Server-level auth**

- Each MCP server in the library has its own credential field
- MCP Library component passes credentials when registering tools
- Requires backend to support per-server credential injection

### 4. Tool Registration Flow

```typescript
// During workflow execution (in Temporal)

async function execute(params, context) {
  const { enabledServers, awsCredentials } = params;

  for (const serverId of enabledServers) {
    const server = await getServerDetails(serverId);

    // Build tool registration payload
    const tools = await discoverServerTools(server, {
      credentials: server.type === 'aws' ? awsCredentials : server.headers,
    });

    // Register in Tool Registry (same as tool-mode)
    await toolRegistry.registerLocalMcp({
      runId: context.runId,
      nodeId: context.nodeId,
      serverId: server.id,
      endpoint: server.endpoint,
      tools: tools,
    });
  }

  return {};
}
```

## Frontend UI

### Component Node in Canvas

```tsx
// Visual representation:
┌─────────────────────┐
│  📚 MCP Library     │
├─────────────────────┤
│ [Server Selector]   │
│ ☑ aws-cloudtrail    │
│ ☑ aws-cloudwatch    │
│ ☐ filesystem        │
│                     │
│ tools ◀─────────────┼─── To AI Agent
└─────────────────────┘
```

### Parameter Editor

```tsx
// When editing MCP Library node:
<McpLibraryServerSelector
  value={params.enabledServers}
  onChange={(servers) => setParams({ enabledServers: servers })}
  // Shows list with health status indicators:
  // 🟢 aws-cloudtrail (healthy, 15 tools)
  // 🟢 aws-cloudwatch (healthy, 8 tools)
  // 🔴 filesystem (unhealthy)
/>
```

## Comparison with Current MCP Server Components

| Aspect           | Current MCP Server             | MCP Library (proposed)       |
| ---------------- | ------------------------------ | ---------------------------- |
| **Config**       | Single server (Docker image)   | Multi-select from library    |
| **Auth**         | Env variables / volume mounts  | Backend-managed or contract  |
| **Tools**        | Auto-discovered from container | Fetched from backend API     |
| **Port**         | `tools` (contract: mcp.tool)   | `tools` (contract: mcp.tool) |
| **Registration** | `registerLocalMcp()`           | `registerLocalMcp()` (same)  |

## Migration Path for AWS MCP Servers

Current:

```
AWS CloudTrail Component → Docker container → tools port → AI Agent
AWS CloudWatch Component → Docker container → tools port → AI Agent
```

Proposed:

```
MCP Library Component → Select "aws-cloudtrail" + "aws-cloudwatch" → tools port → AI Agent
```

Benefits:

- Single component instead of N AWS components
- Credentials managed at workflow level (via contract)
- Easier to add new AWS services (just add to library)

## Implementation Checklist

### Backend

- [ ] Add MCP server filtering/selection API
- [ ] Support credential injection for specific server types
- [ ] Ensure Tool Registry supports library sources

### Worker

- [ ] Create `core.mcp.library` component
- [ ] Implement `execute()` with tool registration
- [ ] Handle credential resolution
- [ ] Add error handling for unavailable servers

### Frontend

- [ ] Add MCP Library node type to workflow palette
- [ ] Create `<McpLibraryServerSelector>` component
- [ ] Show server health status in selector
- [ ] Support contract-based credentials input

### Documentation

- [ ] Update workflow building guide
- [ ] Document credential pattern for AWS services
- [ ] Example workflows using MCP Library

## Minimal Design Summary

**The MCP Library component is just another tool provider:**

1. **One input parameter**: `enabledServers` (array of server IDs)
2. **One output port**: `tools` (contract: `mcp.tool`)
3. **Optional inputs**: Credentials for specific server types (via contracts)
4. **Execution**: Fetch selected servers → Register tools → Return empty

**This means:**

- AI Agent doesn't change at all (already supports tools port)
- Tool Registry doesn't change (already supports registration)
- MCP Gateway doesn't change (already serves registered tools)
- **Only new thing**: The component itself

**The beauty**: Same pattern, just a different way to select tools.
