# ShipSecAI Frontend - Maintaining Documentation

This document provides a comprehensive overview of the ShipSecAI frontend architecture, features, and implementation details to assist with maintenance and future development.

## Overview

The ShipSecAI frontend is a React-based workflow builder application that allows users to create, manage, and execute security automation workflows using a visual canvas. It's built with Vite, TypeScript, Tailwind CSS, and uses React Flow for the workflow visualization.

## Core Features

### 1. Workflow Builder Canvas
- **Visualization**: Uses React Flow to create a drag-and-drop workflow canvas
- **Node Management**: 
  - Add nodes by dragging components from the sidebar
  - Delete nodes/edges using Delete/Backspace keys
  - Select nodes to configure their properties
- **Connection Handling**:
  - Connect nodes using input/output ports
  - Automatic connection validation based on port types
  - Smoothstep edge styling

### 2. Component System
- **Component Registry**: Centralized registry system (src/components/workflow/nodes/registry.ts) that manages all available workflow components
- **Component Categories**:
  - Security Tools (e.g., Subfinder)
  - Building Blocks (e.g., Merge)
  - Input/Output (e.g., File Loader)
- **Component Types**:
  - Input: Data sources
  - Scan: Security scanning tools
  - Process: Data processing components
  - Output: Result handlers
- **JSON Specification**: Each component is defined by a JSON specification file that includes:
  - Metadata (id, name, description, version)
  - Input/output port definitions
  - Configurable parameters
  - Author information

### 3. UI Components

#### Layout Components
- Sidebar (src/components/layout/Sidebar.tsx): Component palette for dragging onto canvas
- TopBar (src/components/layout/TopBar.tsx): Navigation and workflow controls (save, run)
- BottomPanel (src/components/layout/BottomPanel.tsx): Execution logs and output display

#### Workflow Components
- WorkflowNode (src/components/workflow/WorkflowNode.tsx): Visual representation of a workflow component with:
  - Lucide icon rendering
  - Status indicators (running, success, error)
  - Input/output port handles
  - Execution time/error display
- ConfigPanel (src/components/workflow/ConfigPanel.tsx): Configuration interface for selected nodes showing:
  - Component information
  - Input port status
  - Parameter editing fields
- ParameterField (src/components/workflow/ParameterField.tsx): Dynamic form field rendering based on parameter type:
  - Text inputs
  - Text areas
  - Number inputs with min/max constraints
  - Boolean checkboxes
  - Single and multi-select dropdowns
  - File upload fields

### 4. State Management
- **Zustand Stores**:
  - ComponentStore (src/store/componentStore.ts): Manages component metadata
  - ExecutionStore (src/store/executionStore.ts): Handles workflow execution state and logs
- **Schema Validation**:
  - Uses Zod for validating component specifications, workflow structures, and execution data
  - Strong typing throughout the application with TypeScript inference from Zod schemas

### 5. API Integration
- **apiClient** (src/services/api.ts): Centralized Axios instance for backend communication
- **Endpoints**:
  - Workflow CRUD operations
  - Component metadata retrieval
  - Execution start/cancel/status
  - Execution log retrieval
- **Error Handling**: Global interceptor for API error handling

## Project Structure

```
src/
├── components/
│   ├── layout/          # TopBar, Sidebar, BottomPanel
│   └── workflow/       # Canvas, WorkflowNode, ConfigPanel, ParameterField
│       └── nodes/      # Component registry and specifications
│           ├── building-blocks/
│           ├── input-output/
│           └── security-tools/
├── pages/
│   ├── WorkflowBuilder.tsx
│   └── WorkflowList.tsx
├── schemas/           # Zod schemas for validation
├── services/          # API client
├── store/             # Zustand stores
└── utils/             # Utility functions
```

## Key Implementation Details

### Component Registry
- Components are imported as JSON specifications and registered in COMPONENT_REGISTRY
- Functions to retrieve components by slug, type, category, or search query
- Version management is planned for future implementation

### Workflow Execution
- Currently mocked in the frontend using Zustand store
- Implementation follows a three-phase approach:
  1. Individual node mocking
  2. Workflow execution mocking
  3. API integration
- Visual status feedback on nodes during execution

### Styling
- Tailwind CSS for styling with custom theme configuration
- Dynamic node styling based on execution status and component type
- Responsive design for different panel layouts

## Development Approach

The project follows an outside-in development approach:
1. Project documentation defines the overall vision and architecture
2. API contract specifies backend interface requirements
3. Roadmap outlines development phases and priorities
4. Component design documentation details individual features
5. Implementation focuses on one feature at a time with comprehensive testing

## Testing

Testing is handled in phases:
1. Unit tests for individual components
2. Integration tests for component interactions
3. End-to-end tests for complete workflow execution
4. Manual testing guides for UI features

## Recent Changes and Fixes

### Component Parameter State Management Fix (2025-01)
**Issue**: Parameter inputs (checkboxes, dropdowns, etc.) in ConfigPanel were not updating their visual state when changed.

**Root Cause**: ConfigPanel was using a stale `selectedNode` reference that wasn't synchronized with the updated node data in the Canvas state.

**Solution**: Added a `useEffect` hook in `Canvas.tsx` that syncs `selectedNode` with the latest node data from the nodes array whenever nodes are updated:
```typescript
// Sync selectedNode with the latest node data from nodes array
useEffect(() => {
  if (selectedNode) {
    const updatedNode = nodes.find(n => n.id === selectedNode.id)
    if (updatedNode && updatedNode !== selectedNode) {
      setSelectedNode(updatedNode as Node<NodeData>)
    }
  }
}, [nodes, selectedNode])
```

**Files Modified**: `src/components/workflow/Canvas.tsx`

### Documentation Links Feature (2025-01)
**Feature**: Added support for external documentation links in component specifications.

**Implementation**:
- Added optional `documentationUrl` field to `ComponentMetadataSchema` with URL validation
- Enhanced ConfigPanel to display "View docs" link with external link icon when URL is provided
- Opens in new tab with security attributes (`noopener noreferrer`)

**Schema Changes**:
```typescript
documentationUrl: z.string().url().optional()
```

**UI Enhancement**: Added subtle link with hover states that appears next to Documentation heading.

**Files Modified**: 
- `src/schemas/component.ts`
- `src/components/workflow/ConfigPanel.tsx`
- `src/components/workflow/nodes/security-tools/Subfinder/Subfinder.spec.json`

### Component Logo Support (2025-01)
**Feature**: Added support for component logos alongside existing Lucide icons.

**Key Design Decision**: Chose co-located asset approach over public folder for better component encapsulation and contributor experience.

**Implementation Strategy**:
1. **Schema Enhancement**: Modified logo field from `z.string().url()` to `z.string()` to support both URLs and local paths
2. **Asset Co-location**: Logos stored in component folders (e.g., `Subfinder/subfinder.png`)
3. **Registry Import System**: Logo assets imported via Vite's asset handling and URLs overridden at registration time
4. **Graceful Fallback**: If logo fails to load, automatically falls back to Lucide icon

**Technical Details**:
```typescript
// Registry imports and overrides
import subfinderLogo from './security-tools/Subfinder/subfinder.png'

function registerComponent(spec: unknown, logoOverride?: string): void {
  const component = ComponentMetadataSchema.parse(spec)
  if (logoOverride) {
    component.logo = logoOverride
  }
  COMPONENT_REGISTRY[component.slug] = component
}
```

**Sizing Strategy**: Used `object-contain` with fixed dimensions (h-5 w-5 for nodes, h-6 w-6 for ConfigPanel) to ensure consistent UI regardless of original image dimensions.

**Files Modified**:
- `src/schemas/component.ts` - Schema relaxation
- `src/components/workflow/nodes/registry.ts` - Import and override logic
- `src/components/workflow/WorkflowNode.tsx` - Logo display with fallback
- `src/components/workflow/ConfigPanel.tsx` - Logo in component info
- `src/components/layout/Sidebar.tsx` - Logo in draggable items
- Component specs updated to use local filenames

**Benefits Achieved**:
- Self-contained components for easier contributions
- Vite-optimized assets with proper caching
- Type-safe imports with build-time validation
- Backwards compatibility with external URLs

### Data Flow Implementation (2025-01)
**Feature**: Complete data flow system enabling component output → input connections with visual feedback and smart required field detection.

**Key Challenge**: Bridging the gap between React Flow's edge connections and application state management while maintaining type safety and user experience.

**Architecture Decision**: Hybrid input/parameter approach rather than forcing pure separation. This allows treating connected inputs as satisfying "required" conditions while maintaining backwards compatibility.

**Implementation Strategy**:
1. **Dual State Management**: Enhanced Canvas to maintain both React Flow edges AND node input mappings
2. **Type Hierarchy System**: Implemented flexible type compatibility beyond exact matches
3. **Visual State Unification**: Combined required parameters and inputs in unified display system

**Technical Implementation**:

**Connection Data Management** (`src/components/workflow/Canvas.tsx`):
```typescript
// Enhanced onConnect to populate node.data.inputs
const onConnect: OnConnect = useCallback((params) => {
  // ... validation
  setEdges(eds => addEdge(params, eds))
  
  // Update target node's input mapping
  setNodes(nds => nds.map(node => 
    node.id === params.target 
      ? { ...node, data: { ...node.data, inputs: { 
          ...node.data.inputs, 
          [params.targetHandle]: { source: params.source, output: params.sourceHandle }
        }}}
      : node
  ))
})

// Enhanced onEdgesChange to cleanup input mappings on removal
const onEdgesChange = useCallback((changes) => {
  const removedEdges = changes.filter(c => c.type === 'remove')
  // Clean up node.data.inputs when edges are removed
})
```

**Type Compatibility Matrix** (`src/utils/connectionValidation.ts`):
```typescript
const TYPE_HIERARCHY: Record<string, string[]> = {
  'any': ['string', 'array', 'object', 'file'],
  'file': ['string', 'array', 'object', 'any'],
  'array': ['string', 'any'],
  'object': ['string', 'any'],
}
```

**Smart Required Detection** (`src/components/workflow/WorkflowNode.tsx`):
- **Parameters**: Check for user values, then defaults, then mark as required
- **Inputs**: Check for connections in `node.data.inputs` mapping
- **Visual Indicators**: Red borders/alerts only when genuinely missing data

**Connection Visual System**:
- **Connected Inputs**: Blue badges showing `← SourceNode` 
- **Parameter Values**: Gray badges for user values, italic for defaults
- **Connection Status**: Detailed source/output information in ConfigPanel

**Key Technical Challenges Solved**:

1. **State Synchronization Problem**
   - **Issue**: React Flow edges and node input mappings getting out of sync
   - **Solution**: Single source of truth with bidirectional sync in Canvas handlers

2. **Type System Flexibility**
   - **Issue**: Rigid exact-match type checking prevented useful connections
   - **Solution**: Hierarchical type system with compatibility matrix for common patterns

3. **Input vs Parameter Confusion**
   - **Issue**: Subfinder "Target Domain" defined as input port but used like parameter
   - **Solution**: Unified display treating connected inputs as satisfying required conditions

4. **Edge Removal Cleanup**
   - **Issue**: Disconnecting edges left stale input mapping data
   - **Solution**: Enhanced edge change handler with automatic cleanup

**User Experience Improvements**:
- **Before**: Static "*required" indicators regardless of connections
- **After**: Dynamic indicators showing connection status and source information
- **Visual Hierarchy**: Clear distinction between user values, defaults, and connections
- **Type Safety**: Prevents incompatible connections while allowing useful data flow patterns

**Testing Strategy**:
- FileLoader (`any` output) → Subfinder (`string` input) connection validation
- Edge removal and input mapping cleanup
- Visual feedback for all connection states
- TypeScript compilation verification

**Files Modified**:
- `src/components/workflow/Canvas.tsx` - Connection state management
- `src/utils/connectionValidation.ts` - Enhanced type compatibility
- `src/components/workflow/WorkflowNode.tsx` - Unified required field display
- `src/components/workflow/ConfigPanel.tsx` - Detailed connection status

**Performance Considerations**:
- Used React.useCallback for connection handlers to prevent unnecessary re-renders
- Optimized node updates to only modify affected nodes
- Maintained existing React Flow optimization patterns

**Future Extensibility**:
- Data propagation system can build on input mapping infrastructure
- Type system easily extensible for new component types
- Visual indicators can be enhanced with actual data values

### Duplicate Required Field Display Fix (2025-01)
**Issue**: Required input fields (like "Target Domain" in Subfinder) were being displayed twice on the node card - once in the input ports section and again in the required parameters/inputs section at the bottom.

**Root Cause**: The WorkflowNode component was displaying all required fields in two separate sections:
1. Lines 115-135: Input ports with connection handles and "*required" labels
2. Lines 195-219: Dedicated "Required Parameters and Inputs" section showing connection status for both parameters and inputs

**Problem**: This created visual redundancy where inputs like "Target Domain" appeared twice with "*required" indicators, causing user confusion.

**Solution**: Removed the required inputs display from the bottom section, keeping only required parameters there. The bottom section now exclusively shows required parameter values/status, while inputs are only shown once in their natural location with connection handles.

**Implementation**:
- Changed section title from "Required Parameters and Inputs Display" to "Required Parameters Display"
- Removed the entire "Required Inputs" mapping loop (lines 195-219)
- Kept only the "Required Parameters" display logic that shows parameter values and defaults
- Updated conditional rendering to check only `requiredParams.length > 0` instead of both params and inputs

**Visual Result**:
- **Input ports**: Shown once with connection handles and required indicators
- **Required parameters**: Shown in bottom section with current values (e.g., "Output Format: json")
- **No duplication**: Each required field appears exactly once on the node card

**Files Modified**:
- `src/components/workflow/WorkflowNode.tsx` (lines 157-196)

**Benefits**:
- Cleaner, less cluttered node card UI
- Eliminates user confusion about duplicate field displays
- Maintains all functionality while improving visual clarity
- Separates concerns: connection ports in one place, parameter values in another

### Connected Input Source Display (2025-01)
**Issue**: When a required input field was connected to an output from another node, it continued to display "*required" in red, which was misleading since the requirement was actually fulfilled by the connection.

**User Impact**: Users were confused because connected inputs still showed validation warnings, making it unclear whether the node was properly configured or not.

**Solution**: Enhanced the WorkflowNode component to dynamically detect connections and display the source information instead of "*required" when an input is connected.

**Implementation**:
1. **Connection Detection**: Added React Flow hooks (`useReactFlow`) to access edges data within the node component
2. **Source Information Lookup**: For each input, check if there's an incoming edge connection and retrieve the source node and output label
3. **Dynamic Display Logic**:
   - **Not Connected**: Show "*required" in red (existing behavior)
   - **Connected**: Show source output label (e.g., "File Contents") in green italic text with tooltip

**Technical Details** (`src/components/workflow/WorkflowNode.tsx`):
```typescript
// Import React Flow hooks
import { useReactFlow } from 'reactflow'

// Inside component
const { getNodes, getEdges } = useReactFlow()

// For each input, check for connection
const edges = getEdges()
const connection = edges.find(edge => edge.target === id && edge.targetHandle === input.id)

// Get source information
if (connection) {
  const sourceNode = getNodes().find(n => n.id === connection.source)
  const sourceComponent = getComponent(sourceNode.data.componentSlug)
  const sourceOutput = sourceComponent.outputs.find(o => o.id === connection.sourceHandle)
  sourceInfo = sourceOutput?.label || 'Connected'
}

// Display logic
{input.required && !sourceInfo && (
  <span className="text-red-500 text-[10px]">*required</span>
)}
{sourceInfo && (
  <span className="text-green-600 text-[10px] italic" title={`Connected to: ${sourceInfo}`}>
    {sourceInfo}
  </span>
)}
```

**Visual Result**:
- **Before**: Subfinder "Target Domain" shows "*required" even when connected to File Loader
- **After**: Shows "File Contents" in green when connected, clearly indicating the source of data

**Files Modified**:
- `src/components/workflow/WorkflowNode.tsx` (lines 1-2, 22-24, 115-160)

**Benefits**:
- Clear visual feedback that required inputs are fulfilled via connections
- Users can immediately see what data source is feeding each input
- Reduces confusion about node configuration status
- Improves overall workflow comprehension at a glance

### Save and Load Workflow API Integration (2025-01)
**Feature**: Complete save/load workflow functionality with backend API integration and state management.

**User Impact**: Users can now persist their workflow designs to the backend, reload them later, and track unsaved changes in real-time.

**Architecture Overview**:

**1. Workflow Store** (`src/store/workflowStore.ts`):
- Centralized Zustand store for workflow metadata (id, name, description)
- Tracks `isDirty` flag for unsaved changes indicator
- Actions: setWorkflowId, setWorkflowName, setWorkflowDescription, markDirty, markClean, resetWorkflow

**2. Workflow Serialization** (`src/utils/workflowSerializer.ts`):
- **Serialization**: Converts React Flow state (nodes, edges) to backend API format
- **Deserialization**: Converts API format back to React Flow state
- Strips runtime execution state before sending (status, error, executionTime)
- Validates payloads with Zod schemas (CreateWorkflowSchema, UpdateWorkflowSchema)

**Implementation Details**:

**API Payload Structure**:
```json
{
  "name": "Security Workflow",
  "description": "Subdomain enumeration",
  "nodes": [
    {
      "id": "subfinder-1234",
      "type": "scan",
      "position": { "x": 100, "y": 100 },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": { "outputFormat": "json" },
        "inputs": {
          "domain": {
            "source": "file-loader-5678",
            "output": "fileContents"
          }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-123",
      "source": "file-loader-5678",
      "target": "subfinder-1234",
      "sourceHandle": "fileContents",
      "targetHandle": "domain",
      "type": "smoothstep"
    }
  ]
}
```

**Key Technical Decisions**:

1. **Input Mappings Preserved**: The `data.inputs` object is serialized to preserve connection information, allowing the backend to understand data flow
2. **Component Type Inference**: Node type (input/scan/process/output) is inferred from componentSlug during serialization
3. **Clean State Separation**: Runtime state (execution status) is completely separated from persisted state
4. **Automatic Dirty Tracking**: Canvas operations automatically mark workflow as dirty:
   - Adding/removing nodes
   - Adding/removing edges
   - Updating node parameters
   - Changing connections

**Save Workflow Flow** (`src/pages/WorkflowBuilder.tsx`):
```typescript
// 1. Get current canvas state
const nodes = getNodes()
const edges = getEdges()

// 2. Determine create vs update
if (!workflowId || isNewWorkflow) {
  // Create new workflow
  const payload = serializeWorkflowForCreate(name, description, nodes, edges)
  const savedWorkflow = await api.workflows.create(payload)
  setWorkflowId(savedWorkflow.id)
  navigate(`/workflows/${savedWorkflow.id}`)
} else {
  // Update existing workflow
  const payload = serializeWorkflowForUpdate(workflowId, name, description, nodes, edges)
  await api.workflows.update(workflowId, payload)
}

// 3. Mark as clean
markClean()
```

**Load Workflow Flow**:
```typescript
// 1. Fetch from API
const workflow = await api.workflows.get(id)

// 2. Update store metadata
setMetadata({
  id: workflow.id,
  name: workflow.name,
  description: workflow.description
})

// 3. Deserialize and restore canvas
const nodes = deserializeNodes(workflow.nodes)
const edges = deserializeEdges(workflow.edges)
setNodes(nodes)
setEdges(edges)

// 4. Mark as clean
markClean()
```

**UI Enhancements**:

1. **TopBar** (`src/components/layout/TopBar.tsx`):
   - Workflow name input bound to workflowStore
   - "Unsaved changes" indicator when isDirty === true
   - Save button triggers create or update based on workflow.id

2. **Loading State**:
   - Spinner displayed while fetching workflow from API
   - Error handling redirects to home page on load failure

3. **Auto-navigation**:
   - After creating new workflow, URL updates from `/workflows/new` to `/workflows/{uuid}`
   - Browser history updated with `replace: true` to avoid back button confusion

**Dirty State Management** (`src/components/workflow/Canvas.tsx`):
- `onConnect`: Mark dirty when edges are created
- `onDrop`: Mark dirty when nodes are added
- `handleUpdateNode`: Mark dirty when parameters change
- `Delete/Backspace`: Mark dirty when nodes/edges are deleted

**Error Handling**:
- Validation errors caught with Zod during serialization
- API errors displayed with alert() (TODO: replace with toast notifications)
- Load errors redirect user to home page
- All errors logged to console for debugging

**Files Modified**:
- `src/store/workflowStore.ts` (new)
- `src/utils/workflowSerializer.ts` (new)
- `src/components/layout/TopBar.tsx`
- `src/components/workflow/Canvas.tsx`
- `src/pages/WorkflowBuilder.tsx`

**Benefits**:
- Complete workflow persistence with backend integration
- Real-time unsaved changes indicator improves UX
- Clean separation of execution state and persisted state
- Type-safe serialization/deserialization with Zod validation
- Seamless create/update flow with auto-navigation
- Connection data preserved in input mappings for backend execution

**Testing Notes**:
- Requires backend running at http://localhost:8080
- Create workflow: Navigate to /workflows/new, add nodes, click Save
- Update workflow: Load existing workflow, modify, click Save
- Dirty state: Make changes and verify "Unsaved changes" appears
- Load workflow: Refresh page or navigate to workflow URL directly

## Outstanding Tasks

1. Implement actual API integration for workflow execution
2. Add component version management
3. ~~Implement save workflow functionality with API persistence~~ ✅ COMPLETED
4. Add execution results/history tabs in BottomPanel
5. Add toast notifications for connection validation errors and save confirmations