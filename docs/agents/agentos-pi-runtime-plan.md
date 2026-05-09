# ShipSec AgentOS/Pi Runtime Plan

## Decision

ShipSec should keep Temporal as the product workflow engine and add agentOS/Pi as the default lightweight runtime for the internal AI agent node.

```text
Temporal = durable ShipSec workflow lifecycle
agentOS = isolated agent computer
Pi = agent brain/session
ShipSec = tools, credentials, approvals, evidence, findings, UI
```

This avoids replacing the workflow system we already built, while making `core.ai.agent` much more capable than a thin AI SDK wrapper.

## Why This Fits

The current product already has the primitives this needs:

- `core.ai.agent` emits `agentRunId` and streams agent trace parts.
- Workflow execution already detects `{ pending: true }` outputs and pauses on human input.
- Human input requests already support approval/review/form/selection/acknowledge.
- The run inspector already has an Agent tab backed by `/api/v1/agents/{agentRunId}/parts`.
- Tool-mode MCP nodes already bridge tools into agent nodes via Hotplug.
- Temporal workers already run component activities and own retries, timeouts, schedules, and run history.

agentOS/Pi should slot behind the existing AI node first, then graduate into first-class Agent Runs later.

## Product Model

```text
Agent Template
  bundled instructions, runtime, allowed tools, MCP requirements, skills, output schema

Agent Run
  isolated observable execution instance

Workflow
  durable automation glue that binds scope, credentials, schedule, approvals, and post-actions

Engagement
  long-lived memory scope for pentest/recon/cloud investigations
```

For now, the workflow builder still exposes an AI Agent node. Internally it can choose:

```text
runtime = ai-sdk | agentos-pi | external-sandbox
```

## Runtime Split

### `ai-sdk`

Current default.

Use for:

- simple model calls
- direct MCP tool loops
- short workflow nodes
- compatibility with existing tests and workflows

### `agentos-pi`

New default target after validation.

Use for:

- internal AI agent node
- graph/cloud/app/code reasoning
- lightweight scripts
- persistent scratch files
- agent transcript replay
- permission-aware tool use
- hillclimb loops where memory matters

### `external-sandbox`

Keep for heavy or risky agent runs.

Use for:

- browser automation at scale
- full repo builds
- Docker/container work
- tools requiring apt/full Linux
- untrusted customer code execution
- long CPU-heavy scanners
- OpenCode/Claude Code style external coding agents

## Current AI Node Evolution

`core.ai.agent` should become a runtime facade:

```text
core.ai.agent
  inputs:
    userInput
    conversationState
    chatModel / modelApiKey
    tools

  params:
    runtime: ai-sdk | agentos-pi
    systemPrompt
    memorySize
    stepLimit
    maxTokens
    temperature
    permissionPolicy
    filesystemPolicy

  outputs:
    responseText
    conversationState
    agentRunId
    artifacts?
    evidence?
    pendingApproval?
```

The first implementation should keep `ai-sdk` as the default and add `agentos-pi` behind an explicit parameter or feature flag.

## agentOS/Pi Execution Shape

For one workflow node execution:

```text
Temporal activity: runComponentActivity
  -> core.ai.agent execute()
    -> create/get agentOS VM
    -> mount ShipSec runtime files
    -> create Pi session
    -> attach environment and MCP/host tools
    -> stream session events into AgentTracePublisher
    -> translate permissionRequest into ShipSec approval if needed
    -> send prompt
    -> read result/artifacts
    -> close Pi session
    -> return node outputs
```

Suggested VM filesystem:

```text
/home/user/shipsec/input.json
/home/user/shipsec/system.md
/home/user/shipsec/context.md
/home/user/shipsec/memory.md
/home/user/shipsec/tools.md
/home/user/shipsec/output.json
/home/user/shipsec/artifacts/
/home/user/shipsec/evidence/
```

Pi should be instructed to write structured output to `/home/user/shipsec/output.json`, then the component reads it back. If the file is missing, fall back to the final text response.

## HITL Composition

There should be one product-level approval primitive: `HumanInputRequest`.

agentOS emits a low-level permission event:

```text
permissionRequest
  sessionId
  permissionId
  toolName
  input
  risk/context
```

ShipSec should translate that into:

```text
HumanInputRequest
  inputType: approval
  runId
  workflowId
  nodeRef
  title: "Agent requests permission"
  context:
    agentRunId
    sessionId
    permissionId
    toolName
    input
```

Then:

```text
approved  -> agent.respondPermission(sessionId, permissionId, "once")
rejected  -> agent.respondPermission(sessionId, permissionId, "reject")
always    -> only later, after policy support
```

In the current workflow engine, component-level HITL works by returning `{ pending: true }`. For agentOS permission requests, the cleaner long-term model is not to return pending from the component immediately. Instead, the activity should create the approval request and wait for a backend/Temporal signal, while continuing the agent session after resolution.

Short-term MVP:

1. Run Pi with a conservative server-side `onPermissionRequest`.
2. Auto-approve harmless reads.
3. Reject dangerous writes/network actions until explicit product approval wiring exists.
4. Emit trace events that show what would have required approval.

Production target:

1. Add an activity-level bridge that creates `HumanInputRequest`.
2. Parent Temporal workflow waits on `resolveHumanInputSignal`.
3. The activity/agent runtime receives approval through a callback or polling bridge.
4. Pi continues the blocked action.

## Long-Running Agents

For short workflow nodes, Pi can run inside a single component activity.

For first-class long-running agents, use a Temporal child workflow:

```text
Parent Workflow
  -> executeChild(AgentRunWorkflow)

AgentRunWorkflow
  loop:
    run one Pi turn/activity
    persist memory/evidence
    wait on approval signal if needed
    stop on budget, timeout, or objective completion
```

The long-running pentest model should be:

```text
PentestEngagement
  persistent scope + memory

PentestAgentRunWorkflow
  repeated hillclimb passes

Pi/agentOS
  per-turn runtime computer
```

This preserves the hillclimb result: agents compound because memory survives between passes.

## Product Surfaces

Add product concepts gradually:

1. **Workflow AI Agent Node**
   - runtime selector
   - Pi/agentOS experimental mode
   - trace streaming works in existing Agent tab

2. **Agent Runs**
   - standalone run records
   - direct "Ask an agent" and "Run pentest" entry points
   - reused by workflows

3. **Engagements**
   - long-lived memory for pentests/recon/cloud investigations
   - repeated scheduled runs append to the same engagement

4. **Agent Templates**
   - Pentest Agent
   - Recon Agent
   - Cloud Agent
   - AppSec Agent
   - Kubernetes Agent
   - Secrets Agent
   - Remediation Agent

## First Slice

Implement the smallest useful version:

1. Add `runtime` parameter to `core.ai.agent`.
2. Keep `ai-sdk` default.
3. Add `agentos-pi` runtime module behind dynamic imports.
4. Require package availability and clear config errors if missing.
5. Create Pi session with `ANTHROPIC_API_KEY`.
6. Write prompt/context files into agentOS filesystem.
7. Stream Pi session events into `AgentStreamRecorder`.
8. Read `/home/user/shipsec/output.json` if present.
9. Return `responseText`, `conversationState`, `agentRunId`.
10. Add tests for runtime selection and missing agentOS dependency behavior.

## Open Questions

- Should the agentOS VM be per node execution, per workflow run, or per engagement?
- Should Pi session state be retained between workflow node invocations, or should durable memory live only in files/ShipSec DB?
- Which permission classes can be auto-approved for security workflows?
- How should Hotplug MCP tools appear inside Pi: native MCP server, host tool CLI, or both?
- Do we want `agentos-pi` to be available in hosted multi-tenant workers before stronger process isolation review?

## Recommendation

Ship `agentos-pi` as an experimental runtime for `core.ai.agent` first. Do not replace Temporal. Once it proves stable, build first-class Agent Runs as Temporal child workflows that use agentOS/Pi for each agent turn.
