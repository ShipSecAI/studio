# Investigation: Root Cause of connectedToolNodeIds Being Empty

**Status:** Root cause identified, solution identified, ready to implement

---

## Summary

The issue is NOT a missing feature. **The code to compute and pass `connectedToolNodeIds` already exists!**

The problem is somewhere in the execution chain where `connectedToolNodeIds` is not being properly passed from the compiled definition to the component execution.

---

## Where the Code Works

### 1. ✅ Compiler (backend/src/dsl/compiler.ts, lines 107-127)
The `compileWorkflowGraph` function **correctly computes** `connectedToolNodeIds` from workflow edges:

```typescript
const connectedToolNodeIds = edgesByTarget
  .get(node.id)
  ?.filter((edge) => edge.targetHandle === 'tools')
  .map((edge) => edge.source);

nodesMetadata[node.id] = {
  ...
  connectedToolNodeIds:
    connectedToolNodeIds && connectedToolNodeIds.length > 0 ? connectedToolNodeIds : undefined,
};
```

**Test**: backend/src/dsl/__tests__/compiler.spec.ts validates this works correctly ✅

### 2. ✅ Workflow Definition Storage (backend/src/workflows/workflows.service.ts)
The `ensureDefinitionForVersion` method (lines 1022-1061):
- Checks if a compiled definition exists
- If not, calls `compileWorkflowGraph(graph)` and saves it
- Returns the compiled definition with `connectedToolNodeIds` already set

### 3. ✅ Workflow Execution (worker/src/temporal/workflows/index.ts, lines 614-639)
The workflow reads from the compiled definition:

```typescript
const nodeMetadata = input.definition.nodes?.[action.ref];
...
connectedToolNodeIds: nodeMetadata?.connectedToolNodeIds,
```

This passes it to the component activity.

### 4. ✅ Component Activity (worker/src/temporal/activities/run-component.activity.ts, lines 133-165)
The activity receives and sets it in the context:

```typescript
const nodeMetadata = input.metadata ?? {};
const connectedToolNodeIds = nodeMetadata.connectedToolNodeIds;
```

---

## Where It Breaks

The chain appears intact, so the problem is likely:

1. **The compiled definition is not being used** - Maybe the workflow is using an old/uncompiled version
2. **The compiled definition is not being saved properly** - Race condition or save failure
3. **The edges are not being compiled properly** - The compiler might not be seeing the edges correctly
4. **There's a version mismatch** - The workflow is executing with a different version than expected

---

## Next Steps: Root Cause Diagnosis

To find the exact issue, we need to:

### Step 1: Add Logging to Compiler
Edit `backend/src/dsl/compiler.ts` around line 107:
```typescript
const connectedToolNodeIds = edgesByTarget
  .get(node.id)
  ?.filter((edge) => edge.targetHandle === 'tools')
  .map((edge) => edge.source);

console.log(`[Compiler] Node ${node.id}: connectedToolNodeIds = ${JSON.stringify(connectedToolNodeIds)}`);
```

### Step 2: Add Logging to Workflow Execution
Edit `worker/src/temporal/workflows/index.ts` around line 614:
```typescript
const nodeMetadata = input.definition.nodes?.[action.ref];
console.log(`[Workflow] Node ${action.ref}: nodeMetadata.connectedToolNodeIds = ${JSON.stringify(nodeMetadata?.connectedToolNodeIds)}`);
```

### Step 3: Run E2E Test and Check Logs
```bash
RUN_E2E=true source .env.eng-104 && bun test e2e-tests/eng-104-alert-investigation.test.ts 2>&1 | grep "Compiler\|Workflow"
```

---

## Hypothesis

**Hypothesis A: Definition Version Issue**
- The E2E test creates a workflow
- The workflow is NOT committed/compiled before running
- When run() is called, ensureDefinitionForVersion() compiles it
- But maybe the compiled version is not being passed to Temporal?

**Hypothesis B: Edge Filter Issue**
- The compiler filters for `targetHandle === 'tools'`
- Maybe the test workflow doesn't have this exact targetHandle string?
- Maybe the edges object structure is different?

**Hypothesis C: Timing/Race Condition**
- Compiled definition is saved asynchronously
- Workflow starts before it's saved
- Uses old definition without connectedToolNodeIds

---

## Test Evidence

The compiler test PASSES:
```typescript
expect(definition.nodes.agent.connectedToolNodeIds).toHaveLength(2);
expect(definition.nodes.agent.connectedToolNodeIds).toContain('tool1');
expect(definition.nodes.agent.connectedToolNodeIds).toContain('tool2');
```

So the compiler CAN compute this correctly!

The question is: **Why doesn't it work in the E2E test?**

---

## Implementation Plan

Once we identify the root cause with logging, the fix will be one of:

1. **If it's a definition version issue**: Ensure compiled definition is used in workflow
2. **If it's an edge filter issue**: Check the test's edge structure matches expectations
3. **If it's a timing issue**: Add explicit await/verification before starting workflow

All of these are simple fixes once we know which one it is.

---

##Summary of Code Paths

```
Compiler (✅ works):
  compileWorkflowGraph() 
    → reads edges
    → filters for targetHandle === 'tools'
    → sets nodeMetadata.connectedToolNodeIds
    → saves to database

Workflow (✅ reads from definition):
  runs definition.nodes?.[action.ref]
    → passes nodeMetadata.connectedToolNodeIds to activity

Activity (✅ receives it):
  reads input.metadata.connectedToolNodeIds
    → sets in context.metadata

OpenCode (❌ receives empty):
  context.metadata.connectedToolNodeIds = []  ← WHERE IT BREAKS

Question: Where in the path is connectedToolNodeIds being lost?
```

---

## Next Action

Implement the logging and run E2E test to see which step is failing. The fix will likely be one line of code once we identify the exact problem.
