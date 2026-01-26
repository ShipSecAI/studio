# ENG-101: Frontend: Tool Mode & Agent Node UI Implementation Plan

## Overview
This plan details the frontend implementation for supporting Agentic workflows, including a Tool Mode toggle for nodes, an MCP Server node type, and enhancements to the Run Timeline to visualize agent execution and reasoning.

## User Review Required
> [!IMPORTANT]
> - Confirm if `core.mcp.server` component definition exists in the backend or if it needs to be mocked/created in frontend for now.
> - Clarify if "MCP Server node type in palette" implies a specific UI for browsing a catalog (e.g., distinct from normal list). We will implement it as a distinct category in the existing Sidebar for now.

## Proposed Changes

### 1. Tool Mode Toggle
**Goal**: Allow users to toggle nodes into "Tool Mode", changing their visual representation and port exposure.

#### [MODIFY] [WorkflowNode.tsx](file:///Users/betterclever/shipsec/shipsec-studio/frontend/src/components/workflow/WorkflowNode.tsx)
- Add a "Tool Mode" toggle button to the node header (visible for agent-callable nodes).
- **State**: Track `isToolMode` state (likely in `node.data.config.isToolMode` or similar).
- **Rendering**:
    - When `isToolMode` is active:
        - Show "Exposed" inputs/outputs (the ones the Agent sees).
        - Hide internal wiring ports not relevant to the Agent? Or show them differently?
        - Apply a distinct visual style (e.g., "Tool" badge, different border color).
    - **Visual Distinction**: "Visual distinction for tool calls vs normal nodes".
        - Add a "Tool" icon/badge.
        - Change border style (e.g., dashed vs solid, or a specific color like purple/indigo for tools).

### 2. MCP Server Node & Palette
**Goal**: Add MCP Server nodes to the palette with catalog selection.

#### [MODIFY] [Sidebar.tsx](file:///Users/betterclever/shipsec/shipsec-studio/frontend/src/components/layout/Sidebar.tsx)
- Add `mcp_server` to `categoryOrder` and `categoryColors`.
- Ensure MCP Server components are correctly categorized and displayed.
- **Catalog Selection**:
    - If a specific Catalog UI is needed, we might need a "Add from Catalog" button in the `mcp_server` section or a separate view.
    - *Plan*: Integrate into the existing accordion list for now, ensuring `mcp_server` category is prominent.

#### [NEW] [MCPServerNode.tsx] (Optional)
- If MCP Server nodes require special rendering (e.g., connection status to external server), create a custom node type.
- *Default*: Use `WorkflowNode` but with "MCP" styling.

### 3. Agent Node & Tools Port
**Goal**: Enhance the Agent Node UI to support multi-connection tools port.

#### [MODIFY] [WorkflowNode.tsx](file:///Users/betterclever/shipsec/shipsec-studio/frontend/src/components/workflow/WorkflowNode.tsx)
- **Tools Port**:
    - Ensure the `tools` input port (anchor) handles multiple connections visually.
    - ReactFlow `Handle` supports `isConnectable={true}` (default).
    - **Visual**: Style the "Tools" port distinctly (e.g., different shape or color) to indicate it's a "Tool Collection" port.

### 4. Run Timeline Enhancements
**Goal**: Visualize agent execution, reasoning, and tool calls.

#### [MODIFY] [ExecutionTimeline.tsx](file:///Users/betterclever/shipsec/shipsec-studio/frontend/src/components/timeline/ExecutionTimeline.tsx)
- **Expandable Tool Calls**:
    - Show Agent events (steps) on the timeline track.
    - Allow clicking an Agent event to expand/focus it.
    - `agentMarkers` seem implemented. Ensure they are fully wired up to show sub-steps.

#### [MODIFY] [AgentTracePanel.tsx](file:///Users/betterclever/shipsec/shipsec-studio/frontend/src/components/timeline/AgentTracePanel.tsx)
- **Thinking/Reasoning**:
    - Ensure `step.thought` is displayed prominently (it is currently `ExpandableText`).
    - **Tool Calls**:
        - `AgentStepCard` shows tool calls. Improve visual distinction.
        - Add "Thinking" section (e.g., "Agent is thinking..." animation or collapsible "Reasoning" block).

## Verification Plan

### Manual Verification
1.  **Tool Mode**:
    - Drag a component (e.g., "Recursive Web Scraper") to canvas.
    - Toggle "Tool Mode". Verify visual change (border/badge) and port changes.
    - Connect it to an Agent node's "Tools" port.
2.  **MCP Server**:
    - Check Palette for "MCP Servers" category.
    - Drag an MCP Server node to canvas.
3.  **Run Timeline**:
    - Run a workflow with an Agent.
    - Open "Execution" view.
    - Check Timeline for Agent markers.
    - Click Agent node -> Check "Agent Trace" panel.
    - Verify "Thinking" and "Tool Calls" are shown clearly.
