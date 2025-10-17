# Backend API Sample Responses

This document provides sample JSON responses that the backend should return for workflow-related endpoints.

## GET /workflows

**Description**: List all workflows (metadata only, no nodes/edges)

**Response** (200 OK):
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Subdomain Enumeration Workflow",
    "description": "Automated subdomain discovery using Subfinder",
    "nodeCount": 2,
    "edgeCount": 1,
    "lastRun": "2025-01-15T14:20:00Z",
    "runCount": 5,
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T14:22:00Z"
  },
  {
    "id": "650e8400-e29b-41d4-a716-446655440001",
    "name": "Vulnerability Scanning Pipeline",
    "description": "Multi-stage security scanning workflow",
    "nodeCount": 0,
    "edgeCount": 0,
    "lastRun": null,
    "runCount": 0,
    "createdAt": "2025-01-14T08:15:00Z",
    "updatedAt": "2025-01-14T08:15:00Z"
  },
  {
    "id": "750e8400-e29b-41d4-a716-446655440002",
    "name": "Security Audit Workflow",
    "description": "Comprehensive security assessment pipeline",
    "nodeCount": 5,
    "edgeCount": 4,
    "lastRun": "2025-01-16T09:45:00Z",
    "runCount": 12,
    "createdAt": "2025-01-12T16:00:00Z",
    "updatedAt": "2025-01-16T10:30:00Z"
  }
]
```

**Fields Explanation**:
- `id` - Unique workflow identifier (UUID)
- `name` - Workflow name
- `description` - Optional workflow description
- `nodeCount` - Total number of nodes in the workflow
- `edgeCount` - Total number of connections/edges in the workflow
- `lastRun` - ISO datetime of the most recent execution (null if never run)
- `runCount` - Total number of times this workflow has been executed
- `createdAt` - ISO datetime when workflow was created
- `updatedAt` - ISO datetime of last modification

---

## GET /workflows/:id

**Description**: Get a specific workflow by ID

**Request**: `GET /workflows/550e8400-e29b-41d4-a716-446655440000`

**Response** (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Subdomain Enumeration Workflow",
  "description": "Automated subdomain discovery using Subfinder",
  "nodes": [
    {
      "id": "file-loader-1705317600000",
      "type": "input",
      "position": {
        "x": 100,
        "y": 200
      },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "label": "Load Target Domains",
        "parameters": {
          "parseAs": "auto"
        }
      }
    },
    {
      "id": "subfinder-1705317605000",
      "type": "scan",
      "position": {
        "x": 450,
        "y": 200
      },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": {
          "outputFormat": "json",
          "maxTime": 10,
          "threads": 10,
          "rateLimit": 8,
          "silent": true,
          "verbose": false
        },
        "inputs": {
          "domain": {
            "source": "file-loader-1705317600000",
            "output": "fileContents"
          }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "reactflow__edge-file-loader-1705317600000fileContents-subfinder-1705317605000domain",
      "source": "file-loader-1705317600000",
      "target": "subfinder-1705317605000",
      "sourceHandle": "fileContents",
      "targetHandle": "domain",
      "type": "smoothstep"
    }
  ],
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T14:22:00Z"
}
```

**Error Response** (404 Not Found):
```json
{
  "error": "Workflow not found",
  "message": "No workflow exists with id: 550e8400-e29b-41d4-a716-446655440000"
}
```

---

## POST /workflows

**Description**: Create a new workflow

**Request Body**:
```json
{
  "name": "My New Workflow",
  "description": "Testing workflow creation",
  "nodes": [
    {
      "id": "file-loader-1705320000000",
      "type": "input",
      "position": {
        "x": 100,
        "y": 150
      },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "parameters": {
          "parseAs": "auto"
        }
      }
    }
  ],
  "edges": []
}
```

**Response** (201 Created):
```json
{
  "id": "750e8400-e29b-41d4-a716-446655440002",
  "name": "My New Workflow",
  "description": "Testing workflow creation",
  "nodes": [
    {
      "id": "file-loader-1705320000000",
      "type": "input",
      "position": {
        "x": 100,
        "y": 150
      },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "parameters": {
          "parseAs": "auto"
        }
      }
    }
  ],
  "edges": [],
  "createdAt": "2025-01-15T15:30:00Z",
  "updatedAt": "2025-01-15T15:30:00Z"
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "Validation failed",
  "message": "Workflow name is required"
}
```

---

## PUT /workflows/:id

**Description**: Update an existing workflow

**Request**: `PUT /workflows/750e8400-e29b-41d4-a716-446655440002`

**Request Body**:
```json
{
  "id": "750e8400-e29b-41d4-a716-446655440002",
  "name": "Updated Workflow Name",
  "description": "Updated description",
  "nodes": [
    {
      "id": "file-loader-1705320000000",
      "type": "input",
      "position": {
        "x": 100,
        "y": 150
      },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "parameters": {
          "parseAs": "json"
        }
      }
    },
    {
      "id": "subfinder-1705320010000",
      "type": "scan",
      "position": {
        "x": 450,
        "y": 150
      },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": {
          "outputFormat": "json"
        },
        "inputs": {
          "domain": {
            "source": "file-loader-1705320000000",
            "output": "fileContents"
          }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "file-loader-1705320000000",
      "target": "subfinder-1705320010000",
      "sourceHandle": "fileContents",
      "targetHandle": "domain",
      "type": "smoothstep"
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "id": "750e8400-e29b-41d4-a716-446655440002",
  "name": "Updated Workflow Name",
  "description": "Updated description",
  "nodes": [
    {
      "id": "file-loader-1705320000000",
      "type": "input",
      "position": {
        "x": 100,
        "y": 150
      },
      "data": {
        "componentSlug": "file-loader",
        "componentVersion": "1.0.0",
        "parameters": {
          "parseAs": "json"
        }
      }
    },
    {
      "id": "subfinder-1705320010000",
      "type": "scan",
      "position": {
        "x": 450,
        "y": 150
      },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": {
          "outputFormat": "json"
        },
        "inputs": {
          "domain": {
            "source": "file-loader-1705320000000",
            "output": "fileContents"
          }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "file-loader-1705320000000",
      "target": "subfinder-1705320010000",
      "sourceHandle": "fileContents",
      "targetHandle": "domain",
      "type": "smoothstep"
    }
  ],
  "createdAt": "2025-01-15T15:30:00Z",
  "updatedAt": "2025-01-15T15:45:00Z"
}
```

---

## DELETE /workflows/:id

**Description**: Delete a workflow

**Request**: `DELETE /workflows/750e8400-e29b-41d4-a716-446655440002`

**Response** (204 No Content):
```
(empty response body)
```

---

## Important Notes for Backend Implementation

### 1. **Node Type Values**
The `type` field in nodes must be one of:
- `"input"` - Data input components (File Loader, etc.)
- `"scan"` - Security scanning tools (Subfinder, Nuclei, etc.)
- `"process"` - Data processing components (Merge, Filter, etc.)
- `"output"` - Output/export components

### 2. **Position Object**
```json
"position": {
  "x": 100,    // X coordinate (number)
  "y": 200     // Y coordinate (number)
}
```

### 3. **Node Data Structure**
```json
"data": {
  "componentSlug": "subfinder",           // Required: component identifier
  "componentVersion": "1.0.0",            // Required: version string
  "label": "Custom Label",                // Optional: custom display name
  "parameters": { ... },                  // Required: component parameters (can be empty object)
  "inputs": {                            // Optional: input connections
    "domain": {                          // Input port ID
      "source": "file-loader-123",       // Source node ID
      "output": "fileContents"           // Source output port ID
    }
  }
}
```

### 4. **Edge Structure**
```json
{
  "id": "reactflow__edge-sourceNode-sourceHandle-targetNode-targetHandle",  // Unique edge ID
  "source": "file-loader-123",          // Source node ID
  "target": "subfinder-456",            // Target node ID
  "sourceHandle": "fileContents",       // Source output port ID (optional)
  "targetHandle": "domain",             // Target input port ID (optional)
  "type": "smoothstep",                 // Edge type: "default" | "smoothstep" | "step" | "straight"
  "animated": false,                    // Optional: boolean
  "label": "Connection Label"           // Optional: string
}
```

### 5. **Datetime Format**
Use ISO 8601 format with timezone:
```
"2025-01-15T10:30:00Z"
```

### 6. **UUID Format**
Use standard UUID v4:
```
"550e8400-e29b-41d4-a716-446655440000"
```

### 7. **Response Preservation**
The backend **must preserve**:
- Exact node IDs (do not regenerate)
- Exact edge IDs (do not regenerate)
- Node positions
- Input mappings in `data.inputs`
- All parameters in `data.parameters`

### 8. **What NOT to Store**
The frontend strips these fields before sending, backend should NOT expect them:
- `data.status` (execution state)
- `data.executionTime` (runtime metric)
- `data.error` (runtime error)
- `data.config` (legacy field)
- Any React Flow internal fields

---

## Testing the Backend

You can use these `curl` commands to test:

### Create Workflow
```bash
curl -X POST http://localhost:8080/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Workflow",
    "description": "Testing",
    "nodes": [],
    "edges": []
  }'
```

### Get Workflow
```bash
curl http://localhost:8080/workflows/550e8400-e29b-41d4-a716-446655440000
```

### Update Workflow
```bash
curl -X PUT http://localhost:8080/workflows/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Updated Name",
    "nodes": [],
    "edges": []
  }'
```

### Delete Workflow
```bash
curl -X DELETE http://localhost:8080/workflows/550e8400-e29b-41d4-a716-446655440000
```
