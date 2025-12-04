# ShipSec Studio – AI Agent Roadmap

This roadmap tracks how we evolve the `core.ai.agent` component from a model-only assistant into a fully instrumented, tool-using operator inside ShipSec Studio. Phases are ordered to maximise visible UX improvements before tackling heavier runtime plumbing.

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ⚪ Planned | Agentic reasoning & trace UI (no tools) |
| Phase 2 | ⚪ Planned | MCP tool bridge + streaming UX |
| Phase 3 | ⚪ Planned | ShipSec components exposed as tools |

---

## Phase 1 – Agentic Reasoning & Trace UI (No Tools)

**Goal:** Ship a compelling agent experience without any tool integrations so designers can see immediate progress.

- [ ] Use the existing `reasoningTrace`/`toolInvocations` outputs from `core.ai.agent` to render a new “Agent Trace” tab inside `ExecutionInspector`.
- [ ] Update run history persistence so the backend can fetch agent outputs for completed runs (either via `outputSummary` on `NODE_COMPLETED` events or a light `/runs/:runId/nodes/:nodeId/output` endpoint).
- [ ] Build a React timeline component that shows per-step “Thought / Action / Observation” cards with timestamps, finish reasons, and any tool data (even if empty).
- [ ] Instrument PostHog (`ai_agent_trace_viewed`, `ai_agent_trace_expand_tool`) once the panel lands so Product can see adoption.
- [ ] Optional stretch: add skeleton loaders and animated state transitions so selecting a run visibly changes the panel even before data loads.

**Deliverables**
- [ ] UX spec in Figma (or equivalent) documenting the Agent Trace panel layout.
- [ ] PR landing the new panel + run output wiring.
- [ ] PostHog dashboard tile tracking trace tab usage.

**Success criteria**
- [ ] When a workflow containing `core.ai.agent` completes, operators can open the Agent Trace tab and read the full thought process even if no tools were used.
- [ ] Zero backend or worker changes required beyond exposing existing outputs.

---

## Phase 2 – MCP Tool Bridge & Live Streaming

**Goal:** Allow the agent to call external tools via MCP and stream those calls to the UI in real time, still without touching ShipSec components.

### Backend/Worker
- [ ] Expand agent node config to accept MCP endpoint + credentials in the builder (`WorkflowBuilder` node sidebar).
- [ ] Ensure `core.ai.agent` registers a `call_mcp_tool` tool per the Vercel AI SDK contract and surfaces every invocation in `toolInvocations`.
- [ ] Emit per-step events (`AGENT_STEP`, `AGENT_TOOL_CALL`, `AGENT_TOOL_RESULT`) via the existing trace pipeline or a dedicated Redis stream so the backend can serve them incrementally.
- [ ] Build an SSE endpoint (`/api/v1/agents/:runId/stream`) that wraps those events with `toUIMessageStreamResponse`, enabling AI SDK UI clients.

### Frontend
- [ ] Introduce a `useAgentStream` hook built on `@ai-sdk/react` (`useChat` + `onData`) to subscribe to the SSE endpoint.
- [ ] Upgrade the Agent Trace tab to show live updates: “Thinking…” placeholders, tool cards animating from pending → completed, transient status toasts (e.g., MCP latency, errors).
- [ ] Provide controls in the inspector (“Follow live agent”, “Pause”) akin to the existing log viewer.

### Telemetry & Testing
- [ ] Add PostHog events for MCP enablement and tool counts.
- [ ] Unit tests: worker MCP bridge mock, backend SSE serialization, frontend hook reconnection.
- [ ] Manual validation: run a workflow with an MCP tool; confirm trace panel updates as steps stream in even before the run completes.

**Success criteria**
- [ ] Users can configure MCP once, start a run, and watch tool calls materialise live in the Agent Trace tab.
- [ ] The streaming endpoint is AI SDK–compatible so future UI components (chatbot, debug console) can reuse it.

---

## Phase 3 – ShipSec Components as Agent Tools

**Goal:** Let the agent invoke specific ShipSec components (Docker or inline) as “tools”, with full observability parity (terminal logs, artifacts, traces).

### Scheduler & Worker Runtime
- [ ] Extend the workflow DSL to flag nodes as `exposeAsTool` (with optional friendly name + description). Enforce schema requirements (inputs must be serialisable; outputs must be JSON-friendly).
- [ ] At runtime, build a tool catalogue for the agent node (using the flagged nodes) and register each as a Vercel AI SDK tool (`tool({ inputSchema, description, execute })`).
- [ ] Inside each tool `execute`, call the standard component runtime (the same stack the scheduler uses) so trace/log/artifact adapters continue working.
- [ ] Propagate tool execution metadata (`childNodeRef`, `runId`, `attempt`) into `toolInvocations`, `reasoningTrace`, and the new Agent event stream.
- [ ] Guardrails: enforce concurrency limits, reject non-idempotent components, and require explicit approvals for high-impact nodes.

### Backend & UI
- [ ] Update run metadata + APIs to associate each tool call with the underlying component execution (e.g., tool card links to terminal logs).
- [ ] Enhance the Agent Trace tab to show nested detail drawers: clicking a tool reveals command/args, stdout snippets, artifacts, and re-run controls.
- [ ] Add timeline markers on the Execution Timeline so agent tool calls appear alongside regular nodes for holistic replay.

### MCP integration (optional at this stage)
- [ ] When both MCP and ShipSec tools are configured, merge them into a single tool map so the agent chooses the best capability at runtime.

### Validation
- [ ] Integration tests covering a workflow where the agent calls an inline tool and a Docker tool, asserting traces/logs/artifacts exist.
- [ ] UX walkthrough demonstrating cross-linking between Agent Trace and Terminal panel.

**Success criteria**
- [ ] Operators can declare “run httpx as a tool” in the builder; during execution the agent can invoke it, stream progress, and the logs/artifacts are accessible from both the Agent Trace and existing inspector panels.
- [ ] Strong guardrails prevent accidental exposure of unsafe components.

---

## Long-Tail Enhancements

- [ ] **Agent analytics:** PostHog metrics for tool latency, success rate, and per-step errors.
- [ ] **Replay controls:** Jump to a specific agent step from the timeline scrubber.
- [ ] **Audit trails:** Persist full agent transcripts (thoughts + tool IO) for compliance with redaction options.
- [ ] **Safety harness:** Add policy checks (allowed tool list, token budgets) before each tool call.

Document owners should update this file whenever a phase status or deliverable changes. Refer back to `.ai/implementation-plan.md` for shared observability context and `.ai/visual-execution-notes.md` for daily findings.
