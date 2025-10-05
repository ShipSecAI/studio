# Component System Design Document

**Date:** October 4, 2025  
**Version:** 1.0  
**Status:** Ready for Implementation  
**Prerequisites:** Phase 1-3 Complete (Project initialization, Layout, Canvas)

---

## 📋 Document Purpose

This document specifies the **Component System Architecture** for the Security Workflow Builder. It defines how workflow components (Subfinder, Amass, File Loader, etc.) are structured, configured, connected, and executed.

**Audience:** LLM Coding Agent  
**Assumption:** You have completed Phase 1-3 from `project.md` (project setup, layout, React Flow canvas integration)

---

## 🎯 What We're Building

A **component-based workflow system** where:

1. **Components** are reusable security tools and building blocks (Subfinder, Merge, File Loader)
2. **Workflows** are visual graphs connecting these components
3. **Frontend** provides the UI to build workflows and generates workflow JSON
4. **Backend** executes the actual tools and returns results
5. **Real-time feedback** shows execution status and logs in the UI

---

## 🏗️ Architecture Overview

### System Responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                            │
├─────────────────────────────────────────────────────────────┤
│ • Visual workflow builder (drag & drop)                     │
│ • Component metadata display (name, version, badges)        │
│ • Configuration UI (parameters, inputs)                     │
│ • Workflow JSON generation                                  │
│ • Execution triggering (send workflow ID to backend)        │
│ • Real-time status updates (node states, logs)              │
└─────────────────────────────────────────────────────────────┘
                              ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
├─────────────────────────────────────────────────────────────┤
│ • Workflow storage (database)                               │
│ • Component implementations (Subfinder, Amass executables)  │
│ • Execution engine (parse workflow, run components)         │
│ • Data flow management (pass outputs to inputs)             │
│ • Execution state tracking                                  │
│ • Log streaming                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Principle: Frontend Sends JSON, Backend Executes

**Frontend generates this:**
```json
{
  "id": "workflow-123",
  "name": "Subdomain Discovery",
  "nodes": [
    { "id": "node-1", "type": "file-loader", "data": {...} },
    { "id": "node-2", "type": "subfinder", "data": {...} }
  ],
  "edges": [
    { "source": "node-1", "target": "node-2", ... }
  ]
}
```

**Backend receives workflow ID and executes:**
```
POST /workflows/workflow-123/execute
→ Backend fetches workflow JSON from database
→ Backend parses nodes and edges
→ Backend executes components in correct order
→ Backend streams results back to frontend
```

**Frontend does NOT:**
- Store workflow execution data (backend does this)
- Execute security tools (backend does this)
- Calculate execution order (backend does this)

**Frontend DOES:**
- Build the workflow visually
- Generate and validate workflow JSON
- Trigger execution via API
- Display real-time status and logs

---

## 📦 Component Metadata Schema

Every component is defined by a JSON specification that describes its inputs, outputs, and parameters.

### Component Metadata Structure

Create `src/schemas/component.ts`:

```typescript
import { z } from 'zod'

/**
 * Defines input ports for a component
 */
export const InputPortSchema = z.object({
  id: z.string(),                          // "domain"
  label: z.string(),                       // "Target Domain"
  type: z.enum(['string', 'array', 'object', 'file', 'any']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  
  // Type-specific constraints
  accepts: z.array(z.string()).optional(), // ["text/plain", "application/json"]
  maxItems: z.number().optional(),         // For arrays
})

/**
 * Defines output ports for a component
 */
export const OutputPortSchema = z.object({
  id: z.string(),                          // "subdomains"
  label: z.string(),                       // "Discovered Subdomains"
  type: z.enum(['string', 'array', 'object', 'file', 'any']),
  description: z.string().optional(),
  format: z.string().optional(),           // "application/json"
})

/**
 * Defines configurable parameters for a component
 */
export const ParameterSchema = z.object({
  id: z.string(),                          // "timeout"
  label: z.string(),                       // "Timeout (seconds)"
  type: z.enum(['text', 'number', 'boolean', 'select', 'multi-select', 'file']),
  
  required: z.boolean().default(false),
  default: z.any().optional(),
  
  // For select/multi-select
  options: z.array(z.object({
    label: z.string(),
    value: z.any(),
  })).optional(),
  
  // For number type
  min: z.number().optional(),
  max: z.number().optional(),
  
  placeholder: z.string().optional(),
  description: z.string().optional(),
  helpText: z.string().optional(),         // Tooltip text
})

/**
 * Complete component metadata definition
 */
export const ComponentMetadataSchema = z.object({
  // Identification
  id: z.string().uuid(),
  name: z.string().min(1),                 // "Subfinder"
  slug: z.string().regex(/^[a-z0-9-]+$/),  // "subfinder"
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // "1.0.0"
  
  // Categorization
  category: z.enum(['security-tool', 'building-block', 'input-output']),
  type: z.enum(['input', 'scan', 'process', 'output']),
  
  // Authorship
  author: z.object({
    name: z.string(),
    type: z.enum(['shipsecai', 'community']),
    url: z.string().url().optional(),
  }),
  
  // Documentation
  description: z.string().max(200),
  documentation: z.string().optional(),
  icon: z.string(),                        // Lucide icon name
  
  // Status
  isLatest: z.boolean(),
  deprecated: z.boolean().default(false),
  
  // Component contract
  inputs: z.array(InputPortSchema),
  outputs: z.array(OutputPortSchema),
  parameters: z.array(ParameterSchema),
  
  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>
export type InputPort = z.infer<typeof InputPortSchema>
export type OutputPort = z.infer<typeof OutputPortSchema>
export type Parameter = z.infer<typeof ParameterSchema>
```

---

## 📝 Example Component Specifications

### Example 1: Subfinder Component

Create `src/components/workflow/nodes/security-tools/Subfinder/Subfinder.spec.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Subfinder",
  "slug": "subfinder",
  "version": "1.0.0",
  "category": "security-tool",
  "type": "scan",
  
  "author": {
    "name": "ShipSecAI",
    "type": "shipsecai"
  },
  
  "description": "Fast subdomain enumeration tool using passive sources",
  "documentation": "Subfinder is a subdomain discovery tool that discovers valid subdomains using passive online sources.",
  "icon": "Network",
  
  "isLatest": true,
  "deprecated": false,
  
  "inputs": [
    {
      "id": "domain",
      "label": "Target Domain",
      "type": "string",
      "required": true,
      "description": "The root domain to enumerate (e.g., example.com)"
    }
  ],
  
  "outputs": [
    {
      "id": "subdomains",
      "label": "Discovered Subdomains",
      "type": "array",
      "description": "List of discovered subdomains",
      "format": "application/json"
    }
  ],
  
  "parameters": [
    {
      "id": "sources",
      "label": "Data Sources",
      "type": "multi-select",
      "required": false,
      "default": ["all"],
      "options": [
        { "label": "All Sources", "value": "all" },
        { "label": "CertSpotter", "value": "certspotter" },
        { "label": "VirusTotal", "value": "virustotal" },
        { "label": "Shodan", "value": "shodan" }
      ],
      "description": "Which passive sources to query"
    },
    {
      "id": "timeout",
      "label": "Timeout (seconds)",
      "type": "number",
      "required": false,
      "default": 30,
      "min": 5,
      "max": 300,
      "description": "Maximum execution time"
    },
    {
      "id": "recursive",
      "label": "Recursive Enumeration",
      "type": "boolean",
      "default": false,
      "description": "Recursively enumerate discovered subdomains"
    }
  ],
  
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

### Example 2: File Loader Component

Create `src/components/workflow/nodes/input-output/FileLoader/FileLoader.spec.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "File Loader",
  "slug": "file-loader",
  "version": "1.0.0",
  "category": "input-output",
  "type": "input",
  
  "author": {
    "name": "ShipSecAI",
    "type": "shipsecai"
  },
  
  "description": "Load data from a file (TXT, JSON, CSV)",
  "icon": "FileUp",
  
  "isLatest": true,
  "deprecated": false,
  
  "inputs": [],
  
  "outputs": [
    {
      "id": "data",
      "label": "File Contents",
      "type": "any",
      "description": "Parsed file contents",
      "format": "application/json"
    }
  ],
  
  "parameters": [
    {
      "id": "file",
      "label": "File Upload",
      "type": "file",
      "required": true,
      "accepts": ["text/plain", "application/json", "text/csv"],
      "description": "Upload file to load"
    },
    {
      "id": "parseAs",
      "label": "Parse As",
      "type": "select",
      "required": true,
      "default": "auto",
      "options": [
        { "label": "Auto-detect", "value": "auto" },
        { "label": "Plain Text (lines)", "value": "text" },
        { "label": "JSON", "value": "json" },
        { "label": "CSV", "value": "csv" }
      ]
    }
  ],
  
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

### Example 3: Merge Component

Create `src/components/workflow/nodes/building-blocks/Merge/Merge.spec.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "name": "Merge",
  "slug": "merge",
  "version": "1.0.0",
  "category": "building-block",
  "type": "process",
  
  "author": {
    "name": "ShipSecAI",
    "type": "shipsecai"
  },
  
  "description": "Combine multiple inputs into a single output",
  "icon": "Merge",
  
  "isLatest": true,
  "deprecated": false,
  
  "inputs": [
    {
      "id": "input1",
      "label": "Input 1",
      "type": "array",
      "required": true
    },
    {
      "id": "input2",
      "label": "Input 2",
      "type": "array",
      "required": false
    },
    {
      "id": "input3",
      "label": "Input 3",
      "type": "array",
      "required": false
    }
  ],
  
  "outputs": [
    {
      "id": "merged",
      "label": "Merged Output",
      "type": "array",
      "description": "Combined array from all inputs"
    }
  ],
  
  "parameters": [
    {
      "id": "deduplicateBy",
      "label": "Deduplicate By",
      "type": "select",
      "default": "none",
      "options": [
        { "label": "No deduplication", "value": "none" },
        { "label": "Remove exact duplicates", "value": "exact" },
        { "label": "By field (JSON objects)", "value": "field" }
      ]
    },
    {
      "id": "fieldName",
      "label": "Field Name",
      "type": "text",
      "required": false,
      "description": "Field to deduplicate by (when 'By field' is selected)",
      "placeholder": "e.g., 'id' or 'domain'"
    }
  ],
  
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

---

## 🗂️ Workflow JSON Structure

This is the **contract** between frontend and backend. Frontend generates this JSON when a workflow is saved.

### Workflow Schema

Update `src/schemas/workflow.ts`:

```typescript
import { z } from 'zod'

/**
 * Node data contains component configuration
 */
export const NodeDataSchema = z.object({
  componentSlug: z.string(),               // "subfinder"
  componentVersion: z.string(),            // "1.0.0"
  
  // User-configured parameters
  parameters: z.record(z.any()),           // { timeout: 30, recursive: false }
  
  // Input mappings (which output connects to which input)
  inputs: z.record(z.object({
    source: z.string(),                    // "node-1"
    output: z.string(),                    // "data"
  })).optional(),
})

/**
 * Node in the workflow graph
 */
export const NodeSchema = z.object({
  id: z.string(),                          // "node-1"
  type: z.string(),                        // "file-loader"
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: NodeDataSchema,
})

/**
 * Edge connects nodes
 */
export const EdgeSchema = z.object({
  id: z.string(),                          // "edge-1"
  source: z.string(),                      // "node-1"
  sourceHandle: z.string(),                // "data"
  target: z.string(),                      // "node-2"
  targetHandle: z.string(),                // "domain"
})

/**
 * Complete workflow definition
 */
export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Workflow = z.infer<typeof WorkflowSchema>
export type Node = z.infer<typeof NodeSchema>
export type Edge = z.infer<typeof EdgeSchema>
export type NodeData = z.infer<typeof NodeDataSchema>
```

### Example Complete Workflow JSON

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440100",
  "name": "Subdomain Discovery Pipeline",
  "description": "Load domains from file and enumerate subdomains",
  "version": "1.0.0",
  
  "nodes": [
    {
      "id": "node-1",
      "type": "file-loader",
      "position": { "x": 100, "y": 100 },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "parameters": {
          "file": "domains.txt",
          "parseAs": "text"
        }
      }
    },
    {
      "id": "node-2",
      "type": "subfinder",
      "position": { "x": 400, "y": 100 },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": {
          "sources": ["all"],
          "timeout": 30,
          "recursive": false
        },
        "inputs": {
          "domain": {
            "source": "node-1",
            "output": "data"
          }
        }
      }
    },
    {
      "id": "node-3",
      "type": "merge",
      "position": { "x": 700, "y": 100 },
      "data": {
        "componentSlug": "merge",
        "componentVersion": "1.0.0",
        "parameters": {
          "deduplicateBy": "exact"
        },
        "inputs": {
          "input1": {
            "source": "node-2",
            "output": "subdomains"
          }
        }
      }
    }
  ],
  
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "sourceHandle": "data",
      "target": "node-2",
      "targetHandle": "domain"
    },
    {
      "id": "edge-2",
      "source": "node-2",
      "sourceHandle": "subdomains",
      "target": "node-3",
      "targetHandle": "input1"
    }
  ],
  
  "createdAt": "2025-10-04T10:00:00Z",
  "updatedAt": "2025-10-04T10:30:00Z"
}
```

---

## 🔄 Execution Flow

### 1. User Clicks "Run Workflow"

```typescript
// Frontend
async function handleRunWorkflow(workflowId: string) {
  try {
    // Send execution request
    const response = await api.executions.start(workflowId)
    const { executionId } = response.data
    
    // Start polling for status
    startPolling(executionId)
    
  } catch (error) {
    showToast('Failed to start execution')
  }
}
```

### 2. Backend Receives Request

```
POST /workflows/{workflowId}/execute

Backend:
1. Fetch workflow JSON from database
2. Validate workflow (all components exist, inputs connected)
3. Create execution record
4. Start execution engine (async)
5. Return executionId immediately
```

### 3. Backend Executes Workflow

```
Execution Engine (Backend):
1. Parse workflow JSON
2. Build execution graph (topological sort)
3. Determine execution order: node-1 → node-2 → node-3
4. Execute each node:
   - Load component implementation
   - Resolve input values from previous nodes
   - Run component with parameters
   - Store output in execution context
5. Update execution status
6. Stream logs via WebSocket/polling
```

### 4. Frontend Polls for Status

```typescript
// Frontend polling
function startPolling(executionId: string) {
  const interval = setInterval(async () => {
    const status = await api.executions.getStatus(executionId)
    
    // Update node states in canvas
    Object.entries(status.nodeResults).forEach(([nodeId, result]) => {
      updateNodeState(nodeId, result.status)
    })
    
    // Append new logs
    appendLogs(status.logs)
    
    // Stop polling if execution completed
    if (status.status === 'completed' || status.status === 'failed') {
      clearInterval(interval)
      showToast(`Execution ${status.status}`)
    }
  }, 2000) // Poll every 2 seconds
}
```

### 5. Execution Status Response

```json
{
  "executionId": "exec-789",
  "workflowId": "workflow-123",
  "status": "running",
  "startedAt": "2025-10-04T10:00:00Z",
  "completedAt": null,
  
  "nodeResults": {
    "node-1": {
      "status": "success",
      "startedAt": "2025-10-04T10:00:01Z",
      "completedAt": "2025-10-04T10:00:03Z",
      "outputs": {
        "data": ["example.com", "test.com"]
      }
    },
    "node-2": {
      "status": "running",
      "startedAt": "2025-10-04T10:00:03Z",
      "outputs": null
    },
    "node-3": {
      "status": "pending",
      "outputs": null
    }
  },
  
  "logs": [
    {
      "timestamp": "2025-10-04T10:00:01Z",
      "level": "info",
      "nodeId": "node-1",
      "message": "Loading file: domains.txt"
    },
    {
      "timestamp": "2025-10-04T10:00:03Z",
      "level": "info",
      "nodeId": "node-1",
      "message": "Loaded 2 domains"
    },
    {
      "timestamp": "2025-10-04T10:00:03Z",
      "level": "info",
      "nodeId": "node-2",
      "message": "Starting Subfinder scan for example.com"
    }
  ]
}
```

---

## 🔌 API Contract

### Component Registry Endpoints

```typescript
// Get all available components (for sidebar palette)
GET /components
Response: ComponentMetadata[]

// Get specific component metadata
GET /components/{slug}
Response: ComponentMetadata
```

### Workflow Endpoints (Already Defined in project.md)

```typescript
GET    /workflows              // List all workflows
GET    /workflows/:id          // Get specific workflow
POST   /workflows              // Create new workflow
PUT    /workflows/:id          // Update workflow
DELETE /workflows/:id          // Delete workflow
```

### Execution Endpoints

```typescript
// Start workflow execution
POST /workflows/{id}/execute
Request: { parameters?: Record<string, any> } // Optional runtime overrides
Response: { executionId: string }

// Get execution status
GET /executions/{id}
Response: ExecutionStatus (see schema above)

// Get execution logs
GET /executions/{id}/logs
Response: Log[]

// Cancel running execution
POST /executions/{id}/cancel
Response: { success: boolean }
```

### Update API Service Layer

Update `src/services/api.ts`:

```typescript
export const api = {
  // ... existing workflow endpoints ...
  
  components: {
    /**
     * Get all available components from backend
     */
    list: async () => {
      const response = await apiClient.get('/components')
      return z.array(ComponentMetadataSchema).parse(response.data)
    },
    
    /**
     * Get specific component metadata
     */
    get: async (slug: string) => {
      const response = await apiClient.get(`/components/${slug}`)
      return ComponentMetadataSchema.parse(response.data)
    },
  },
  
  executions: {
    /**
     * Start workflow execution
     */
    start: async (workflowId: string, parameters?: Record<string, any>) => {
      const response = await apiClient.post(`/workflows/${workflowId}/execute`, { parameters })
      return response.data // { executionId: string }
    },
    
    /**
     * Get execution status
     */
    getStatus: async (executionId: string) => {
      const response = await apiClient.get(`/executions/${executionId}`)
      return ExecutionStatusSchema.parse(response.data)
    },
    
    /**
     * Get execution logs
     */
    getLogs: async (executionId: string) => {
      const response = await apiClient.get(`/executions/${executionId}/logs`)
      return z.array(LogSchema).parse(response.data)
    },
    
    /**
     * Cancel execution
     */
    cancel: async (executionId: string) => {
      const response = await apiClient.post(`/executions/${executionId}/cancel`)
      return response.data
    },
  },
}
```

---

## 🎨 Component Visual Design

### Node UI Layout

```
┌──────────────────────────────────────────────┐
│ [Icon] Subfinder              [ShipSecAI]   │ ← Header
├──────────────────────────────────────────────┤
│                                              │
│ ● domain                                     │ ← Input ports (left)
│                                              │
│              [Status Icon]                   │ ← Center (execution state)
│                                              │
│                         subdomains ●         │ ← Output ports (right)
│                                              │
├──────────────────────────────────────────────┤
│ v1.0.0 | Latest                              │ ← Footer
└──────────────────────────────────────────────┘
```

### Component Badge System

Create `src/components/workflow/ComponentBadge.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Users, AlertCircle, AlertTriangle } from 'lucide-react'

type BadgeType = 'official' | 'community' | 'latest' | 'outdated' | 'deprecated'

interface ComponentBadgeProps {
  type: BadgeType
  version?: string
}

export function ComponentBadge({ type, version }: ComponentBadgeProps) {
  const badges = {
    official: {
      label: 'ShipSecAI',
      variant: 'default' as const,
      icon: CheckCircle,
    },
    community: {
      label: 'Community',
      variant: 'secondary' as const,
      icon: Users,
    },
    latest: {
      label: 'Latest',
      variant: 'success' as const,
      icon: CheckCircle,
    },
    outdated: {
      label: version ? `v${version} available` : 'Update available',
      variant: 'warning' as const,
      icon: AlertCircle,
    },
    deprecated: {
      label: 'Deprecated',
      variant: 'destructive' as const,
      icon: AlertTriangle,
    },
  }
  
  const badge = badges[type]
  const Icon = badge.icon
  
  return (
    <Badge variant={badge.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {badge.label}
    </Badge>
  )
}
```

### Node State Styling

```typescript
// src/components/workflow/nodeStyles.ts
export type NodeState = 'idle' | 'running' | 'success' | 'error' | 'warning'

export const getNodeStyle = (state: NodeState) => {
  const styles = {
    idle: {
      border: 'border-border',
      bg: 'bg-bg-primary',
      icon: null,
    },
    running: {
      border: 'border-warning',
      bg: 'bg-warning/10',
      icon: 'Loader2', // spinning
    },
    success: {
      border: 'border-success',
      bg: 'bg-success/10',
      icon: 'CheckCircle',
    },
    error: {
      border: 'border-error',
      bg: 'bg-error/10',
      icon: 'XCircle',
    },
    warning: {
      border: 'border-warning',
      bg: 'bg-warning/10',
      icon: 'AlertTriangle',
    },
  }
  
  return styles[state]
}
```

---

## 📁 Directory Structure

```
src/
├── components/
│   └── workflow/
│       ├── nodes/                    # NEW
│       │   ├── README.md
│       │   ├── registry.ts           # Component registry
│       │   ├── types.ts              # Shared types
│       │   │
│       │   ├── security-tools/
│       │   │   ├── Subfinder/
│       │   │   │   ├── Subfinder.tsx
│       │   │   │   ├── Subfinder.spec.json
│       │   │   │   └── README.md
│       │   │   └── ... (other tools)
│       │   │
│       │   ├── building-blocks/
│       │   │   ├── Merge/
│       │   │   │   ├── Merge.tsx
│       │   │   │   ├── Merge.spec.json
│       │   │   │   └── README.md
│       │   │   └── ... (Split, Filter, etc.)
│       │   │
│       │   └── input-output/
│       │       ├── FileLoader/
│       │       │   ├── FileLoader.tsx
│       │       │   ├── FileLoader.spec.json
│       │       │   └── README.md
│       │       └── ... (other I/O components)
│       │
│       ├── ComponentBadge.tsx        # NEW
│       ├── ConfigPanel.tsx           # NEW
│       ├── WorkflowNode.tsx          # UPDATED
│       └── Canvas.tsx                # UPDATED (from Phase 3)
│
├── schemas/
│   ├── component.ts                  # NEW
│   ├── execution.ts                  # NEW
│   └── workflow.ts                   # UPDATED
│
├── services/
│   └── api.ts                        # UPDATED (add executions, components)
│
└── store/
    ├── workflowStore.ts              # UPDATED
    ├── executionStore.ts             # NEW
    └── componentStore.ts             # NEW
```

---

## 🗄️ State Management

### Component Store

Create `src/store/componentStore.ts`:

```typescript
import { create } from 'zustand'
import { ComponentMetadata } from '@/schemas/component'
import { api } from '@/services/api'

interface ComponentStore {
  // State
  components: Record<string, ComponentMetadata>
  loading: boolean
  error: string | null
  
  // Actions
  fetchComponents: () => Promise<void>
  getComponent: (slug: string) => ComponentMetadata | null
  getComponentsByType: (type: string) => ComponentMetadata[]
}

export const useComponentStore = create<ComponentStore>((set, get) => ({
  components: {},
  loading: false,
  error: null,
  
  fetchComponents: async () => {
    set({ loading: true, error: null })
    try {
      const components = await api.components.list()
      const componentsMap = Object.fromEntries(
        components.map(comp => [comp.slug, comp])
      )
      set({ components: componentsMap, loading: false })
    } catch (error) {
      set({ 
        error: 'Failed to fetch components',
        loading: false 
      })
    }
  },
  
  getComponent: (slug: string) => {
    return get().components[slug] || null
  },
  
  getComponentsByType: (type: string) => {
    return Object.values(get().components).filter(
      comp => comp.type === type
    )
  },
}))
```

### Execution Store

Create `src/store/executionStore.ts`:

```typescript
import { create } from 'zustand'
import { api } from '@/services/api'

interface ExecutionStore {
  // Current execution
  currentExecutionId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed'
  nodeStates: Record<string, 'idle' | 'pending' | 'running' | 'success' | 'error'>
  logs: Array<{
    timestamp: string
    level: string
    nodeId: string
    message: string
  }>
  
  // Actions
  startExecution: (workflowId: string) => Promise<void>
  pollStatus: (executionId: string) => Promise<void>
  updateNodeState: (nodeId: string, state: string) => void
  appendLogs: (logs: any[]) => void
  reset: () => void
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  currentExecutionId: null,
  status: 'idle',
  nodeStates: {},
  logs: [],
  
  startExecution: async (workflowId: string) => {
    try {
      const response = await api.executions.start(workflowId)
      const { executionId } = response
      
      set({ 
        currentExecutionId: executionId,
        status: 'running',
        nodeStates: {},
        logs: []
      })
      
      // Start polling
      get().pollStatus(executionId)
      
    } catch (error) {
      set({ status: 'failed' })
    }
  },
  
  pollStatus: async (executionId: string) => {
    const poll = async () => {
      try {
        const status = await api.executions.getStatus(executionId)
        
        // Update node states
        const nodeStates: Record<string, any> = {}
        Object.entries(status.nodeResults).forEach(([nodeId, result]: [string, any]) => {
          nodeStates[nodeId] = result.status
        })
        
        set({ 
          status: status.status,
          nodeStates,
          logs: status.logs 
        })
        
        // Continue polling if still running
        if (status.status === 'running') {
          setTimeout(poll, 2000)
        }
        
      } catch (error) {
        console.error('Failed to poll execution status', error)
      }
    }
    
    poll()
  },
  
  updateNodeState: (nodeId: string, state: string) => {
    set(state => ({
      nodeStates: {
        ...state.nodeStates,
        [nodeId]: state
      }
    }))
  },
  
  appendLogs: (newLogs: any[]) => {
    set(state => ({
      logs: [...state.logs, ...newLogs]
    }))
  },
  
  reset: () => {
    set({
      currentExecutionId: null,
      status: 'idle',
      nodeStates: {},
      logs: []
    })
  },
}))
```

### Update Workflow Store

Update `src/store/workflowStore.ts` to include component data in nodes:

```typescript
import { create } from 'zustand'
import { Workflow, Node, Edge } from '@/schemas/workflow'
import { api } from '@/services/api'

interface WorkflowStore {
  workflows: Workflow[]
  currentWorkflow: Workflow | null
  
  // Canvas state
  nodes: Node[]
  edges: Edge[]
  
  // Actions
  fetchWorkflows: () => Promise<void>
  setCurrentWorkflow: (workflow: Workflow) => void
  addNode: (node: Node) => void
  updateNode: (nodeId: string, data: Partial<Node['data']>) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: Edge) => void
  removeEdge: (edgeId: string) => void
  saveWorkflow: () => Promise<void>
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  nodes: [],
  edges: [],
  
  fetchWorkflows: async () => {
    const workflows = await api.workflows.list()
    set({ workflows })
  },
  
  setCurrentWorkflow: (workflow: Workflow) => {
    set({ 
      currentWorkflow: workflow,
      nodes: workflow.nodes,
      edges: workflow.edges
    })
  },
  
  addNode: (node: Node) => {
    set(state => ({
      nodes: [...state.nodes, node]
    }))
  },
  
  updateNode: (nodeId: string, data: Partial<Node['data']>) => {
    set(state => ({
      nodes: state.nodes.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      )
    }))
  },
  
  removeNode: (nodeId: string) => {
    set(state => ({
      nodes: state.nodes.filter(n => n.id !== nodeId),
      edges: state.edges.filter(e => 
        e.source !== nodeId && e.target !== nodeId
      )
    }))
  },
  
  addEdge: (edge: Edge) => {
    set(state => ({
      edges: [...state.edges, edge]
    }))
  },
  
  removeEdge: (edgeId: string) => {
    set(state => ({
      edges: state.edges.filter(e => e.id !== edgeId)
    }))
  },
  
  saveWorkflow: async () => {
    const { currentWorkflow, nodes, edges } = get()
    
    if (!currentWorkflow) return
    
    const updatedWorkflow = {
      ...currentWorkflow,
      nodes,
      edges,
      updatedAt: new Date().toISOString()
    }
    
    await api.workflows.update(currentWorkflow.id, updatedWorkflow)
    set({ currentWorkflow: updatedWorkflow })
  },
}))
```

---

## 🚀 Implementation Phases

### Phase 3A: Component Infrastructure (Start Here)

**Prerequisites:** Phase 1-3 completed (project setup, layout, React Flow canvas)

---

#### **Checkpoint 3A.1: Component Schemas**

**Goal:** Define component metadata schema and workflow schema updates

**Tasks:**
1. Create `src/schemas/component.ts` with all schemas:
   - `InputPortSchema`
   - `OutputPortSchema`
   - `ParameterSchema`
   - `ComponentMetadataSchema`
2. Update `src/schemas/workflow.ts`:
   - Update `NodeDataSchema` to include `componentSlug`, `componentVersion`, `parameters`, `inputs`
3. Create `src/schemas/execution.ts`:
   - `ExecutionStatusSchema`
   - `LogSchema`

**Test:**
- TypeScript compiles without errors
- Can import schemas in other files

**Commit:** `feat(schemas): add component metadata and execution schemas`

---

#### **Checkpoint 3A.2: Component Specifications**

**Goal:** Create JSON spec files for 3 example components

**Tasks:**
1. Create directory structure:
   ```
   src/components/workflow/nodes/
   ├── security-tools/Subfinder/
   ├── building-blocks/Merge/
   └── input-output/FileLoader/
   ```
2. Create `Subfinder.spec.json` (use example from this doc)
3. Create `FileLoader.spec.json` (use example from this doc)
4. Create `Merge.spec.json` (use example from this doc)

**Test:**
- JSON files are valid (no syntax errors)
- Can import JSON files in TypeScript

**Commit:** `feat(components): add spec files for Subfinder, FileLoader, Merge`

---

#### **Checkpoint 3A.3: Component Registry**

**Goal:** Create registry to load and query components

**Tasks:**
1. Create `src/components/workflow/nodes/registry.ts`:
   - Import all spec JSON files
   - Export `COMPONENT_REGISTRY` object
   - Create helper functions: `getComponent()`, `getComponentsByType()`
2. Add README to `src/components/workflow/nodes/README.md` explaining how to add new components

**Test:**
- Can import registry
- `getComponent('subfinder')` returns ComponentMetadata
- `getComponentsByType('scan')` returns array with Subfinder

**Commit:** `feat(components): create component registry system`

---

#### **Checkpoint 3A.4: Component Store**

**Goal:** Create Zustand store for components

**Tasks:**
1. Create `src/store/componentStore.ts`
2. Implement `fetchComponents()` (for now, use local registry, later call backend)
3. Implement `getComponent()` and `getComponentsByType()`

**Test:**
- Can call `useComponentStore().fetchComponents()`
- Components populate in store
- Can retrieve components by slug and type

**Commit:** `feat(store): add component store with registry integration`

---

### Phase 3B: Component UI Components

---

#### **Checkpoint 3B.1: Component Badge**

**Goal:** Create badge component for component metadata

**Tasks:**
1. Create `src/components/workflow/ComponentBadge.tsx`
2. Support badge types: official, community, latest, outdated, deprecated
3. Use Lucide icons and shadcn Badge component

**Test:**
- Render each badge type
- Correct colors and icons display

**Commit:** `feat(ui): add component badge component`

---

#### **Checkpoint 3B.2: Enhanced Workflow Node**

**Goal:** Update WorkflowNode to display component metadata

**Tasks:**
1. Update `src/components/workflow/WorkflowNode.tsx`:
   - Fetch component metadata from store using `node.data.componentSlug`
   - Display component icon, name, badges
   - Render input ports (left side)
   - Render output ports (right side)
   - Add footer with version info
2. Create `src/components/workflow/nodeStyles.ts` for state styling

**Test:**
- Drag node onto canvas
- See component icon, name, official badge
- See input/output ports
- See version in footer

**Commit:** `feat(workflow): enhance node UI with component metadata`

---

#### **Checkpoint 3B.3: Updated Sidebar Palette**

**Goal:** Update sidebar to show components from registry

**Tasks:**
1. Update `src/components/layout/Sidebar.tsx`:
   - Fetch components from store on mount
   - Group components by type (input, scan, process, output)
   - Make components draggable onto canvas
   - Show component icon, name, description

**Test:**
- Sidebar shows all components
- Grouped by type
- Can drag onto canvas
- Node appears with correct metadata

**Commit:** `feat(sidebar): populate component palette from registry`

---

### Phase 3C: Configuration Panel

---

#### **Checkpoint 3C.1: Config Panel Layout**

**Goal:** Create configuration panel for selected node

**Tasks:**
1. Create `src/components/workflow/ConfigPanel.tsx`:
   - Show when a node is selected
   - Display component name and description
   - Sections: Inputs, Parameters
2. Update layout to show ConfigPanel on right side (or as overlay)

**Test:**
- Click node → config panel appears
- Shows component name and description
- Empty sections for now

**Commit:** `feat(workflow): add configuration panel layout`

---

#### **Checkpoint 3C.2: Input Configuration**

**Goal:** Show input ports and connection status

**Tasks:**
1. In ConfigPanel, add "Inputs" section:
   - List all input ports from component spec
   - Show connection status (connected or not)
   - If connected, show: "Connected from [SourceNode] → [output]"
   - If not connected and not required, show manual input field
   - If not connected and required, show warning

**Test:**
- Connect two nodes
- Click target node
- Config panel shows "Connected from FileLoader → data"

**Commit:** `feat(config): add input configuration section`

---

#### **Checkpoint 3C.3: Parameter Configuration**

**Goal:** Render parameter fields based on component spec

**Tasks:**
1. In ConfigPanel, add "Parameters" section:
   - Render fields based on parameter type:
     - `text` → Input field
     - `number` → Number input with min/max
     - `boolean` → Checkbox
     - `select` → Dropdown
     - `multi-select` → Multi-select dropdown
   - Show default values
   - Show help text / tooltips
2. Save parameter values to node data on change

**Test:**
- Click Subfinder node
- See timeout field (number), recursive checkbox (boolean), sources multi-select
- Change values
- Values persist in node data

**Commit:** `feat(config): add parameter configuration with dynamic fields`

---

#### **Checkpoint 3C.4: Connection Validation**

**Goal:** Prevent invalid connections

**Tasks:**
1. Create `src/utils/connectionValidation.ts`:
   - `canConnect(sourcePort, targetPort)` function
   - Check type compatibility
   - Check format compatibility
2. Update Canvas to use validation on connection attempt:
   - Show error toast if invalid
   - Don't create edge if invalid

**Test:**
- Try to connect string output to array input → blocked with error
- Try to connect array to array → succeeds

**Commit:** `feat(workflow): add connection type validation`

---

### Phase 3D: Execution Integration

---

#### **Checkpoint 3D.1: Execution Store**

**Goal:** Create store to manage execution state

**Tasks:**
1. Create `src/store/executionStore.ts`
2. Implement:
   - `startExecution(workflowId)`
   - `pollStatus(executionId)`
   - `updateNodeState(nodeId, state)`
   - `appendLogs(logs)`

**Test:**
- Call `startExecution()` (will fail if backend not ready, that's okay)
- Store structure is correct

**Commit:** `feat(store): add execution store with polling logic`

---

#### **Checkpoint 3D.2: Run Button Integration**

**Goal:** Connect Run button to execution system

**Tasks:**
1. Update TopBar Run button:
   - Call `executionStore.startExecution(workflowId)`
   - Show loading state
   - Disable during execution
2. Update Canvas to reflect node states from execution store:
   - Subscribe to `executionStore.nodeStates`
   - Apply state styling to nodes

**Test:**
- Click Run button
- If backend ready: nodes change states
- If backend not ready: error handling works

**Commit:** `feat(execution): connect run button to execution system`

---

#### **Checkpoint 3D.3: Logs Panel Integration**

**Goal:** Display execution logs in BottomPanel

**Tasks:**
1. Update BottomPanel:
   - Subscribe to `executionStore.logs`
   - Display logs with timestamp, level, message
   - Color-code by level (info, warning, error)
   - Auto-scroll to bottom

**Test:**
- Run workflow
- Logs appear in bottom panel
- Color-coded correctly
- Auto-scrolls

**Commit:** `feat(execution): integrate logs display in bottom panel`

---

#### **Checkpoint 3D.4: API Service Updates**

**Goal:** Add execution and component endpoints

**Tasks:**
1. Update `src/services/api.ts`:
   - Add `api.components.list()` and `api.components.get(slug)`
   - Add `api.executions.start()`, `getStatus()`, `getLogs()`, `cancel()`
2. Update componentStore to call `api.components.list()` instead of using local registry

**Test:**
- Mock backend endpoints with JSON server if needed
- API calls work
- Data parsed with Zod schemas

**Commit:** `feat(api): add component and execution endpoints`

---

## ✅ Success Criteria

### Phase 3A Complete When:
- [ ] Component schemas defined and TypeScript types generated
- [ ] 3 component spec files created (Subfinder, FileLoader, Merge)
- [ ] Component registry working
- [ ] Component store fetches and provides components

### Phase 3B Complete When:
- [ ] Component badges display correctly
- [ ] Workflow nodes show component metadata (icon, name, version, badges)
- [ ] Input/output ports visible on nodes
- [ ] Sidebar palette populated from registry
- [ ] Can drag components onto canvas

### Phase 3C Complete When:
- [ ] Config panel appears when node selected
- [ ] Input section shows connection status
- [ ] Parameter section renders fields dynamically
- [ ] Parameter values saved to node data
- [ ] Connection validation prevents type mismatches

### Phase 3D Complete When:
- [ ] Execution store manages execution state
- [ ] Run button triggers execution
- [ ] Node states update during execution (idle → running → success/error)
- [ ] Logs display in bottom panel
- [ ] API service layer complete

---

## 🎯 Testing Checklist

After completing all phases:

### Component System:
- [ ] Components load from registry
- [ ] Component badges display (official, latest, etc.)
- [ ] Component icons render
- [ ] Input/output ports visible

### Workflow Building:
- [ ] Can drag components onto canvas
- [ ] Can connect compatible ports
- [ ] Cannot connect incompatible ports (type validation)
- [ ] Can delete nodes and edges
- [ ] Can configure parameters in config panel
- [ ] Parameter values persist

### Execution:
- [ ] Can save workflow
- [ ] Can run workflow
- [ ] Node states change during execution
- [ ] Logs appear in real-time
- [ ] Execution completes successfully
- [ ] Error states handled

### Data Persistence:
- [ ] Workflows save to backend
- [ ] Workflows load from backend
- [ ] Component configurations persist
- [ ] Execution history viewable

---

## âš ï¸ Critical Reminders

1. **Frontend ONLY generates workflow JSON**
   - Don't implement component execution logic in frontend
   - Backend executes the actual tools

2. **Component specs are JSON files**
   - Easy to add new components
   - No code changes needed for new components (just add spec file)

3. **Use Zod for ALL data validation**
   - API responses
   - Workflow JSON
   - Component specs

4. **Follow incremental development**
   - One checkpoint at a time
   - Test after each checkpoint
   - Commit after each checkpoint

5. **Ask before deviating**
   - Architecture is defined
   - Don't add features not in spec
   - Don't change data structures without approval

---

## 📚 Reference Files

When implementing, refer to:

1. **project.md** - Main project spec, tech stack, development rules
2. **This document** - Component system architecture
3. **Existing code** - Phase 1-3 implementation
4. **shadcn/ui docs** - For UI components
5. **React Flow docs** - For canvas interactions
6. **Zustand docs** - For state management

---

## 🚦 Ready to Start?

**Your next action:**
1. Confirm you understand the architecture
2. Review Phase 1-3 completed code
3. Start Phase 3A, Checkpoint 3A.1: Component Schemas
4. Follow the checkpoint structure
5. Test after each checkpoint
6. Commit with clear messages
7. Report progress after each checkpoint

**Questions before starting?**
- Unclear about any architecture decision?
- Need clarification on data flow?
- Unsure about component structure?