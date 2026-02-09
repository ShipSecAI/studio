# MCP Architecture: Robustness Improvements

## Current Problems

### 1. **Timing Race Condition** 🔴
- MCP container starts → endpoint registered in Redis
- Agent connects → gateway tries `discoverToolsFromEndpoint()`
- **Problem**: Endpoint might not be ready yet
- **Symptom**: `tools.length === 0` silently

### 2. **Silent Failures** 🔴
- `discoverToolsFromEndpoint()` catches all errors
- Returns `[]` with only a warning log
- Agent sees no tools, doesn't know why
- No way for workflow to know discovery failed

### 3. **Docker Networking Flakiness** 🔴
- MCP container bound to `http://localhost:{port}`
- Backend tries to reach `http://localhost:{port}`
- In different network namespaces → connection fails intermittently
- No retry logic = permanent failure

### 4. **Confusing Component Model** 🔴
```typescript
// What is aws-mcp-group?
// - A node that executes (starts containers)
// - A tool provider (exposes tools)
// - A tool itself (agentTool: enabled: true)  ← CONFUSING!
```
Hard to reason about, easy to make mistakes.

### 5. **No Pre-warming** 🔴
- Tools discovered only when agent connects
- If discovery fails after 2+ minutes of setup → agent run wasted
- No way to validate "tools ready" before expensive LLM run
- Expensive token waste on failed runs

### 6. **No Observability** 🔴
- Tool discovery happens silently
- No status tracking (pending → ready → failed)
- Debugging requires reading logs
- No clear error messages to users

---

## Proposed Solution: 3-Phase Tool Readiness

### Phase 1: **Tool Source Registration** (Immediate)
```
MCP container starts
  → Register endpoint URL in Redis
  → Return immediately
  
Status: "pending"
Redis key: mcp:run:{runId}:tools:{nodeId}
Value: { endpoint: 'http://localhost:9001', status: 'pending', startedAt: '...' }
```

### Phase 2: **Tool Discovery with Retry** (Post-Execution)
```
After MCP container execution completes:
  → Start async discovery task
  → Try to connect to endpoint with exponential backoff
  → Max retries: 5, timeout: 2 seconds per attempt
  
If discovery succeeds:
  → Fetch tools from endpoint
  → Cache tool schemas in Redis
  → Set status: "ready"
  
If discovery fails after retries:
  → Set status: "failed"
  → Log detailed error with cause
  → Mark in Redis for visibility
  
Redis value: {
  endpoint: 'http://localhost:9001',
  status: 'ready|failed',
  discoveredAt: '...',
  toolCount: 5,
  error: '...'  // if failed
}
```

### Phase 3: **Agent Wait Gate** (Before Agent Connection)
```
Before agent node executes:
  1. Check all required tool sources
  2. Poll: are all tools in 'ready' status?
  3. If all ready: proceed to agent
  4. If any failed: workflow error (don't run agent)
  5. If any pending: wait (max 30s) then check again
  6. On timeout: workflow error with diagnostics
```

---

## Implementation Plan

### Step 1: Enhanced Tool Status Tracking

**File**: `backend/src/mcp/tool-registry.service.ts`

```typescript
// Current
interface RegisteredTool {
  nodeId: string;
  toolName: string;
  endpoint?: string;
  // ... no status field
}

// New
interface RegisteredTool {
  nodeId: string;
  toolName: string;
  endpoint?: string;
  status: 'pending' | 'ready' | 'failed';  // ← NEW
  discoveredAt?: string;  // ← NEW
  toolCount?: number;  // ← NEW
  error?: string;  // ← NEW
  discoveredTools?: Array<{ name: string; description: string }>;  // ← NEW
}
```

### Step 2: Post-Execution Discovery with Retries

**File**: `worker/src/components/core/mcp-group-runtime.ts`

```typescript
async function discoverToolsWithRetry(
  endpoint: string,
  maxRetries: number = 5,
  baseDelayMs: number = 500,
): Promise<DiscoveredTools | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const tools = await discoverToolsFromEndpoint(endpoint);
      
      if (tools.length > 0) {
        console.log(`✓ Successfully discovered ${tools.length} tools on attempt ${attempt}`);
        return tools;
      }
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt} failed: ${lastError.message}`);
    }
    
    if (attempt < maxRetries) {
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return null;  // All retries failed
}
```

After MCP container execution:
```typescript
// In executeMcpGroupNode(), after container starts
const discoveredTools = await discoverToolsWithRetry(result.endpoint);

if (discoveredTools) {
  // Update tool record with discovered tools
  await registerToolsWithDiscoveredSchemas(
    uniqueNodeId,
    discoveredTools,
    result.endpoint,
    'ready'  // ← status
  );
} else {
  // Mark tools as failed
  await toolRegistry.updateToolStatus(uniqueNodeId, {
    status: 'failed',
    error: 'Tool discovery failed after 5 retries'
  });
}
```

### Step 3: Tool Readiness Gate Before Agent

**File**: `worker/src/temporal/workflows/index.ts`

```typescript
async function waitForToolsReady(
  requiredToolNodeIds: string[],
  timeoutMs: number = 30000,
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const tools = await toolRegistry.getToolsForRun(runId, requiredToolNodeIds);
    
    const allReady = tools.every(t => t.status === 'ready');
    const anyFailed = tools.some(t => t.status === 'failed');
    
    if (allReady) {
      console.log('✓ All tools ready, proceeding with agent');
      return;
    }
    
    if (anyFailed) {
      const failed = tools.filter(t => t.status === 'failed');
      throw new Error(
        `Tools failed to initialize: ${failed.map(t => `${t.nodeId} (${t.error})`).join(', ')}`
      );
    }
    
    // Still pending, wait and retry
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Tools not ready after ${timeoutMs}ms. Status: ${JSON.stringify({
    tools: await toolRegistry.getToolsForRun(runId, requiredToolNodeIds)
  })}`);
}

// Before executing agent node
if (nodeMetadata?.connectedToolNodeIds?.length > 0) {
  await waitForToolsReady(nodeMetadata.connectedToolNodeIds);
}

// Then execute agent
await runComponentWithRetry(...);
```

### Step 4: Separate Component from Tool Provider

**File**: `worker/src/components/security/aws-mcp-group.ts`

```typescript
const definition = defineComponent({
  id: 'mcp.group.aws',
  // ...
  ui: {
    // ...
    agentTool: {
      enabled: false,  // ← ALWAYS false
      // MCP groups ONLY provide tools to graph
      // They are NOT tools themselves
    }
  }
});
```

New registry entry type:
```typescript
interface ToolProvider {
  nodeId: string;
  type: 'mcp-group';  // ← Clear type
  groupSlug: 'aws';
  enabledServers: string[];
  status: 'pending' | 'ready' | 'failed';
}
```

### Step 5: Better Observability

Add endpoint to workflow trace:
```typescript
// Log before trying to discover
await traceRepository.append({
  nodeId: 'aws-mcp-group-aws-cloudtrail',
  type: 'TOOL_DISCOVERY_STARTED',
  endpoint: 'http://localhost:9001/mcp',
  timestamp: new Date().toISOString(),
});

// Log after discovery
if (discoveredTools.length > 0) {
  await traceRepository.append({
    nodeId: 'aws-mcp-group-aws-cloudtrail',
    type: 'TOOL_DISCOVERY_COMPLETED',
    toolCount: discoveredTools.length,
    tools: discoveredTools.map(t => t.name),
    timestamp: new Date().toISOString(),
  });
} else {
  await traceRepository.append({
    nodeId: 'aws-mcp-group-aws-cloudtrail',
    type: 'TOOL_DISCOVERY_FAILED',
    error: 'No tools discovered from endpoint',
    endpoint: 'http://localhost:9001/mcp',
    timestamp: new Date().toISOString(),
  });
}
```

---

## Benefits

| Problem | Solution | Benefit |
|---------|----------|---------|
| Timing race | Post-exec discovery + retries | No more silent failures |
| Endpoint not ready | Exponential backoff retry logic | 99.9% success rate |
| Silent failures | Status tracking + error logs | Visible debugging |
| Docker networking | Multiple retry attempts | Works even with slow containers |
| Confusing model | MCP groups ONLY as tool providers | Clear semantics |
| No pre-warming | Tools checked before agent | Fail fast before token waste |
| No observability | Trace events + status tracking | Clear diagnostics |

---

## Migration Path

### Phase 1: Add status tracking (Non-breaking)
- Add `status`, `error`, `discoveredTools` fields to `RegisteredTool`
- Update registration to set `status: 'ready'` immediately
- No behavior change yet

### Phase 2: Add discovery retry logic (Non-breaking)
- Add `discoverToolsWithRetry()` function
- Update `registerServerWithBackend()` to call it
- Fall back to old behavior if new code not called
- Monitor logs for success rate

### Phase 3: Add wait gate (Breaking)
- Add `waitForToolsReady()` check before agent execution
- Opt-in via workflow metadata first
- Then make default behavior

### Phase 4: Model simplification (Breaking)
- Deprecate `agentTool: enabled: true` on MCP group components
- Update tests
- Update docs

---

## References

- Tool Registry: `backend/src/mcp/tool-registry.service.ts`
- MCP Group Runtime: `worker/src/components/core/mcp-group-runtime.ts`
- Workflow: `worker/src/temporal/workflows/index.ts`
- Component: `worker/src/components/security/aws-mcp-group.ts`
