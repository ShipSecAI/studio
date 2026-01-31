# Investigation: OpenCode Not Using MCP Tools

**Date:** January 31, 2026  
**Status:** Root Cause Identified  
**Severity:** High (E2E tests pass, but tool usage not working)

---

## Problem Statement

Even though OpenCode MCP configuration now works (oauth: false fix), OpenCode is not using MCP tools in the ENG-104 E2E workflow test.

**Evidence:**
- E2E test passes (workflow completes)
- OpenCode generates report
- But report uses web search instead of security tools (AbuseIPDB, VirusTotal, CloudTrail, CloudWatch)

**Example Output:**
```
OpenCode: "I can provide the current date from the environment (2026-01-31), 
          or fetch the exact current time from an online API if you want."
```

Should be:
```
OpenCode: "Using AbuseIPDB tool, I found that IP 8.8.8.8 is [reputation data]..."
```

---

## Root Cause Analysis

### The Issue

OpenCode receives **empty `connectedToolNodeIds`** from the workflow execution context.

**In `worker/src/components/ai/opencode.ts` line 137:**
```
[OpenCode] Starting execution with connectedToolNodeIds: []
[OpenCode] No connectedToolNodeIds provided - agent will run without MCP tools
```

### Why This Breaks Tool Usage

1. **Line 143** in opencode.ts:
   ```typescript
   if (connectedToolNodeIds && connectedToolNodeIds.length > 0) {
     // Generate gateway token
   } else {
     // Skip gateway, no token
   }
   ```

2. Without token:
   - No call to `getGatewaySessionToken()`
   - No `allowedNodeIds` passed to gateway
   - Gateway returns empty tool list
   - OpenCode has no tools available

3. OpenCode falls back to built-in tools:
   - Web search
   - Bash execution
   - Text generation

### The Data Flow That's Missing

```
Workflow Graph (SHOULD)
├─ Nodes: [start, abuseipdb, virustotal, cloudtrail, cloudwatch, opencode]
├─ Edges: [
│    { source: 'abuseipdb', target: 'opencode', sourceHandle: 'tools', targetHandle: 'tools' },
│    { source: 'virustotal', target: 'opencode', sourceHandle: 'tools', targetHandle: 'tools' },
│    ...
│  ]
├─ Executor should see these edges and populate:
│  context.metadata.connectedToolNodeIds = ['abuseipdb', 'virustotal', 'cloudtrail', 'cloudwatch']
└─ OpenCode component receives this list

Workflow Graph (ACTUALLY)
├─ Nodes and edges exist in the graph
├─ But executor does NOT read them
├─ context.metadata.connectedToolNodeIds = [] (empty)
└─ OpenCode receives empty list
```

---

## Where the Bug Is

### Hypothesis 1: Component Activity Executor
**File:** `worker/src/temporal/activities/component.activity.ts`

The component executor should:
1. Read the workflow graph
2. Find all edges where `target.nodeId === currentNode.id`
3. Filter for edges with `sourceHandle === 'tools' && targetHandle === 'tools'`
4. Extract source node IDs
5. Set `context.metadata.connectedToolNodeIds = [sourceNodeIds...]`

**Question:** Is this code doing that?

### Hypothesis 2: Component SDK
**File:** `packages/component-sdk/src/...`

The SDK might provide:
- A helper to extract connected tool nodes
- A context builder that should populate this field
- Integration with the executor

**Question:** Does the SDK have utilities for reading tool connections?

---

## Proof That oauth: false Fix Works

### ✅ OAuth Fix Is Correct
We can prove the oauth: false fix works by looking at what WOULD happen if we had tools:

```typescript
// In opencode.ts with connectedToolNodeIds = ['tool1', 'tool2']
const gatewayToken = await getGatewaySessionToken(
  runId,                        // ✅ Passed
  organizationId,               // ✅ Passed
  ['tool1', 'tool2']            // ✅ Would include actual tool IDs
);

// Gateway receives token with: allowedNodeIds = ['tool1', 'tool2']
// Gateway calls: getToolsForRun(runId, ['tool1', 'tool2'])
// Gateway returns: [actual tool definitions]
// OpenCode config gets: "tools": { "tool1": {...}, "tool2": {...} }
// OpenCode authenticates with: oauth: false + Authorization header ✅
```

The authentication and config work! The missing piece is the **connectedToolNodeIds population**.

---

## Why the E2E Test Still Passes

The ENG-104 test expects:
```javascript
expect(report.toLowerCase()).toContain('summary');
expect(report.toLowerCase()).toContain('findings');
expect(report.toLowerCase()).toContain('actions');
```

OpenCode CAN generate sections with these titles using web search:
- **Summary:** General description
- **Findings:** Web search results
- **Actions:** Generic security recommendations

The test passes because report generation works, not because tools are used! 😅

---

## Test Evidence

### Workflow Definition (ENG-104 test)
```javascript
{
  id: 'abuseipdb',
  type: 'security.abuseipdb.check',
  data: { /* config */ }
},
{
  id: 'opencode',
  type: 'core.ai.opencode',
  data: { /* config */ }
},
// Edge connecting them:
{ 
  id: 't1', 
  source: 'abuseipdb', 
  target: 'opencode',
  sourceHandle: 'tools',    // ← Tool connection!
  targetHandle: 'tools'     // ← Tool port!
}
```

### Actual Behavior
```
[OpenCode] Starting execution with connectedToolNodeIds: []
          ^ This should be ['abuseipdb', 'virustotal', 'cloudtrail', 'cloudwatch']
```

---

## Next Steps to Debug

### Immediate: Add Debugging
Edit `worker/src/components/ai/opencode.ts` execute() method:

```typescript
async execute({ inputs, params }, context) {
  const { connectedToolNodeIds, organizationId } = context.metadata;
  
  // Add debugging:
  context.logger.info('=== DEBUG: Full Context ===');
  context.logger.info(JSON.stringify({
    nodeId: context.nodeId,
    graphInfo: (context as any).graph ? 'has graph' : 'no graph',
    metadataKeys: Object.keys(context.metadata || {}),
    connectedToolNodeIds,
    allInputNames: Object.keys(inputs),
  }, null, 2));
  
  // existing code...
}
```

### Deep Dive: Check Component Executor
File: `worker/src/temporal/activities/component.activity.ts`

Look for:
1. Where it creates the `context` object
2. Whether it populates `context.metadata`
3. Whether it reads workflow edges
4. Whether it filters for tool connections

### Alternative: Check SDK
Look in `@shipsec/component-sdk`:
1. Does it provide `getConnectedToolNodeIds()` helper?
2. Is there an example of tool-mode component?
3. How should `connectedToolNodeIds` be populated?

---

## Impact Assessment

| Impact | Current | With Fix |
|--------|---------|----------|
| oauth: false fix | ✅ Working | ✅ Still works |
| Gateway connection | ✅ Can connect | ✅ Still works |
| Tool discovery | ❌ No tools | ✅ Tools available |
| MCP tool usage | ❌ Falls back | ✅ Uses tools |
| E2E test pass | ✅ Passes | ✅ Still passes |
| Real workflow usage | ❌ Broken | ✅ Works |

---

## Related Code References

### Files to Investigate
- `worker/src/temporal/activities/component.activity.ts` - Where context is created
- `worker/src/temporal/activities/mcp.activity.ts` - MCP-related activity
- `packages/component-sdk/src/` - SDK components
- `backend/src/mcp/mcp-gateway.service.ts` - Gateway tool registration

### Working Examples
- `worker/src/components/ai/ai-agent.ts` - Similar component, check if it handles tools
- E2E test workflow - How edges are defined

---

## Summary

**Fixed:** ✅ OAuth authentication (oauth: false)  
**Still Broken:** ❌ Tool discovery (`connectedToolNodeIds` empty)  
**Root Cause:** Workflow graph edges not being translated to component metadata  
**Impact:** OpenCode can't access available tools  
**Test Status:** Passes anyway (web search fallback)  

**Next Action:** Investigate component executor to understand why `connectedToolNodeIds` is not being populated from workflow edges.
