# MCP Group Registration & Tool Discovery Pipeline

## Overview

This document explains the complete flow of how MCP (Model Context Protocol) tool groups (like AWS MCPs) are registered and made available to AI agents like OpenCode.

## Complete Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Workflow Compilation                                   │
└─────────────────────────────────────────────────────────────────┘

User creates workflow with:
  - Nodes: abuseipdb, virustotal, aws-mcp-group, agent (OpenCode)
  - Edges: connect tools to agent with targetHandle='tools'

Compiler extracts:
  - connectedToolNodeIds = ['abuseipdb', 'virustotal', 'aws-mcp-group']
  
Passes to workflow execution as node metadata.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Component Tools Registration (runs early)              │
└─────────────────────────────────────────────────────────────────┘

Worker activity runs component nodes (abuseipdb, virustotal):
  1. Calls activity for each component
  2. Component registers itself via:
     POST /api/v1/internal/mcp/register-component
     Body: { runId, nodeId: 'abuseipdb', toolName: 'abuseipdb', ... }
  
Backend stores in Redis: mcp:run:{runId}:tools
  Key: 'abuseipdb' → RegisteredTool { nodeId: 'abuseipdb', toolName: 'abuseipdb', type: 'component' }

Gateway gets cache refresh signal → updates in-memory server.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: MCP Group Execution (runs sequentially)                │
└─────────────────────────────────────────────────────────────────┘

Worker executes aws-mcp-group node:
  
  For each enabled server (aws-cloudtrail, aws-iam, aws-cloudwatch, ...):
    1. startMcpDockerServer()
       - Creates container with MCP server image
       - Exposes on: http://localhost:{PORT}/mcp
       - Returns endpoint URL + containerId
    
    2. registerServerWithBackend()
       - Generates MCP session token (allowedNodeIds includes group + server)
       - POST /api/v1/internal/mcp/register-local
       Body: {
         runId: 'shipsec-run-xxx',
         nodeId: 'aws-mcp-group-aws-cloudtrail',  ← unique per server!
         toolName: 'aws-cloudtrail',
         endpoint: 'http://localhost:9001/mcp',
         serverId: 'aws-cloudtrail',
         description: 'MCP tools from aws-cloudtrail'
       }
       
Backend stores in Redis:
  Key: 'aws-mcp-group-aws-cloudtrail' → RegisteredTool {
    nodeId: 'aws-mcp-group-aws-cloudtrail',
    toolName: 'aws-cloudtrail',
    type: 'local-mcp',
    endpoint: 'http://localhost:9001/mcp',
    serverId: 'aws-cloudtrail'
  }

Gateway refresh clears in-memory cache.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Agent Token Generation                                 │
└─────────────────────────────────────────────────────────────────┘

Agent (OpenCode) component needs tools:
  1. Calls getGatewaySessionToken()
  2. Sends: POST /api/v1/internal/mcp/generate-token
     Body: {
       runId: 'shipsec-run-xxx',
       allowedNodeIds: ['abuseipdb', 'aws-mcp-group', 'virustotal']
     }
  
Backend creates MCP auth record with allowedNodeIds.
Returns: MCP session token (JWT-like format).

Agent writes token to config and connects to gateway.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 5: Agent Connects to MCP Gateway                          │
└─────────────────────────────────────────────────────────────────┘

Agent makes HTTP request:
  POST /api/v1/mcp/gateway
  Authorization: Bearer {token}
  Body: { jsonrpc: '2.0', method: 'tools/list', params: {} }

McpAuthGuard validates token → extracts allowedNodeIds.
McpGatewayController initializes new server for this run.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 6: Tool Discovery & Registration in Gateway               │
└─────────────────────────────────────────────────────────────────┘

Gateway.registerTools() is called:

1. Fetch all tools from Redis for this run:
   SELECT * FROM mcp:run:{runId}:tools
   
   Returns:
   ✓ { nodeId: 'abuseipdb', toolName: 'abuseipdb', type: 'component', ... }
   ✓ { nodeId: 'virustotal', toolName: 'virustotal', type: 'component', ... }
   ✓ { nodeId: 'aws-mcp-group-aws-cloudtrail', endpoint: 'http://...', type: 'local-mcp', ... }
   ✓ { nodeId: 'aws-mcp-group-aws-iam', endpoint: 'http://...', type: 'local-mcp', ... }
   ✓ { nodeId: 'aws-mcp-group-aws-cloudwatch', endpoint: 'http://...', type: 'local-mcp', ... }

2. Filter by allowedNodeIds with PREFIX MATCHING:
   allowedNodeIds = ['abuseipdb', 'aws-mcp-group', 'virustotal']
   
   Direct match: 'abuseipdb' ∈ allowedNodeIds ✓ → include
   Direct match: 'virustotal' ∈ allowedNodeIds ✓ → include
   Prefix match: 'aws-mcp-group-aws-cloudtrail' starts with 'aws-mcp-group-' ✓ → include
   Prefix match: 'aws-mcp-group-aws-iam' starts with 'aws-mcp-group-' ✓ → include
   Prefix match: 'aws-mcp-group-aws-cloudwatch' starts with 'aws-mcp-group-' ✓ → include

3. For each tool, register in MCP server:
   
   a) Component tools (abuseipdb, virustotal):
      server.registerTool(
        'abuseipdb',
        { description: '...', inputSchema: {...} },
        async (args) => { call component via Temporal signal }
      )
      
   b) External/MCP tools (aws-cloudtrail, aws-iam, ...):
      
      For local-mcp type:
        i.   Call discoverToolsFromEndpoint('http://localhost:9001/mcp')
        ii.  Send: POST /mcp { jsonrpc: '2.0', method: 'tools/list', params: {} }
        iii. Parse response: { result: { tools: [ {name, description, inputSchema}, ... ] } }
        iv.  For each discovered tool:
             server.registerTool(
               'aws-cloudtrail__list_events',  ← proxied name with prefix
               { description: 'List CloudTrail events', inputSchema: {...} },
               async (args) => { proxyCallToExternal(source, 'list_events', args) }
             )

┌─────────────────────────────────────────────────────────────────┐
│ Phase 7: Agent Discovers Tools                                  │
└─────────────────────────────────────────────────────────────────┘

Agent runs: opencode mcp list

OpenCode queries the MCP gateway:
  POST /api/v1/mcp/gateway
  Body: { jsonrpc: '2.0', method: 'tools/list', params: {} }

Gateway responds with all registered tools:
  {
    result: {
      tools: [
        { name: 'abuseipdb', description: '...', inputSchema: {...} },
        { name: 'virustotal', description: '...', inputSchema: {...} },
        { name: 'aws-cloudtrail__list_events', description: '...', inputSchema: {...} },
        { name: 'aws-cloudtrail__get_trail_status', description: '...', ... },
        { name: 'aws-iam__list_users', description: '...', ... },
        ... (all discovered AWS tools)
      ]
    }
  }

Agent sees the tools and can call them.

┌─────────────────────────────────────────────────────────────────┐
│ Phase 8: Agent Calls Tools                                      │
└─────────────────────────────────────────────────────────────────┘

Agent calls: aws-cloudtrail__list_events({ ... })

Gateway.proxyCallToExternal():
  1. Creates HTTP client to endpoint: http://localhost:9001/mcp
  2. Sends: POST { jsonrpc: '2.0', method: 'tools/call', params: {...} }
  3. Gets result from MCP server
  4. Returns to agent

Result flows back to agent → agent processes it → generates report.
```

## Key Points

### 1. **Unique Node IDs for MCP Servers**
- MCP group component registers each server with a **unique nodeId**
- Format: `{groupNodeId}-{serverId}`
- Example: `aws-mcp-group-aws-cloudtrail`
- This prevents overwriting when multiple servers come from the same group

### 2. **Prefix Matching in Tool Filtering**
- Agent connects with `allowedNodeIds = ['aws-mcp-group', ...]`
- Gateway filters using **prefix matching**:
  ```
  if (source.nodeId.startsWith(`${allowedId}-`)) {
    // Include this source
  }
  ```
- This allows a single node reference to include all servers in a group

### 3. **Tool Proxying Names**
- External MCP tools get a **proxied name** with prefix
- Original tool from MCP: `list_events`
- Proxied name exposed to agent: `aws-cloudtrail__list_events`
- Prefix = source.toolName = the MCP source registration name

### 4. **Endpoint Discovery Timing**
**CRITICAL**: Tools are discovered from endpoints **when the agent first connects**, not when they're registered.

- MCP group registers: stores endpoint URL in Redis ✓
- Agent token generated: gateway not yet created
- **Agent connects**: gateway calls `discoverToolsFromEndpoint()` for the first time
- If endpoint is down/slow at this moment → NO TOOLS discovered

### 5. **Redis-Based Registry**
- Key: `mcp:run:{runId}:tools`
- Value: Hash of `{nodeId} → JSON(RegisteredTool)`
- TTL: 1 hour
- Single source of truth for all tools in a run

## Debugging

To check if tools were registered:

```bash
# In Redis
HGETALL mcp:run:shipsec-run-{id}:tools

# Expected:
# "abuseipdb" → { nodeId: 'abuseipdb', toolName: 'abuseipdb', type: 'component', ... }
# "aws-mcp-group-aws-cloudtrail" → { nodeId: 'aws-mcp-group-aws-cloudtrail', endpoint: 'http://...', ... }
```

To check if gateway discovered tools:

```bash
# Look for logs: "[Gateway] Discovering tools from local MCP endpoint"
pm2 logs shipsec-backend-0 | grep "Endpoint Discovery\|Discovered.*tools"
```

To check if agent sees tools:

```bash
# Agent runs: opencode mcp list
# Check terminal output for list of discovered tools
```

## Common Issues

### Issue: Agent doesn't see AWS tools
**Symptom**: Agent only sees `abuseipdb` and `virustotal`, no AWS tools

**Causes**:
1. **MCP endpoints not accessible** from gateway
   - localhost binding in container doesn't reach backend
   - Solution: Ensure containers and backend share network
   
2. **Tool discovery happens before endpoints ready**
   - MCP container still starting when gateway tries to discover
   - Solution: Add delay or retry logic in discoverToolsFromEndpoint()
   
3. **Redis registry missing tools**
   - registerServerWithBackend() failed silently
   - Solution: Check logs for registration failures

### Issue: Old tools still available after re-running
**Cause**: Redis TTL (1 hour) keeps old tools cached

**Solution**: Manually clear Redis or restart backend

## Files

- **Compilation**: [backend/src/dsl/compiler.ts](../backend/src/dsl/compiler.ts#L111-L114)
- **MCP Group Execution**: [worker/src/components/core/mcp-group-runtime.ts](../worker/src/components/core/mcp-group-runtime.ts#L129-L246)
- **Tool Registry**: [backend/src/mcp/tool-registry.service.ts](../backend/src/mcp/tool-registry.service.ts)
- **Gateway Service**: [backend/src/mcp/mcp-gateway.service.ts](../backend/src/mcp/mcp-gateway.service.ts#L159-L365)
- **Internal MCP Controller**: [backend/src/mcp/internal-mcp.controller.ts](../backend/src/mcp/internal-mcp.controller.ts)
- **OpenCode Component**: [worker/src/components/ai/opencode.ts](../worker/src/components/ai/opencode.ts#L130-L210)

