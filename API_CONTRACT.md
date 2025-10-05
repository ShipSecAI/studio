# Backend API Contract

This document defines the API contract between the frontend and backend.

**Base URL:** `http://localhost:8080`

All requests should use `Content-Type: application/json`.

---

## Workflow Endpoints

### List Workflows
```
GET /workflows
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Workflow Name",
    "description": "Optional description",
    "version": "1.0.0",
    "nodes": [...],
    "edges": [...],
    "createdAt": "2025-01-15T10:00:00Z",
    "updatedAt": "2025-01-15T10:00:00Z"
  }
]
```

### Get Workflow
```
GET /workflows/:id
```

**Response:** Single workflow object (same schema as list)

### Create Workflow
```
POST /workflows
```

**Request Body:**
```json
{
  "name": "New Workflow",
  "description": "Optional",
  "nodes": [],
  "edges": []
}
```

**Response:** Created workflow object with generated `id`, `createdAt`, `updatedAt`

### Update Workflow
```
PUT /workflows/:id
```

**Request Body:** Partial workflow object

**Response:** Updated workflow object

### Delete Workflow
```
DELETE /workflows/:id
```

**Response:** `204 No Content`

---

## Component Endpoints

### List Components
```
GET /components
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Subfinder",
    "slug": "subfinder",
    "version": "1.0.0",
    "category": "security-tool",
    "type": "scan",
    "author": {
      "name": "ShipSecAI",
      "type": "shipsecai"
    },
    "description": "Fast subdomain enumeration",
    "icon": "Network",
    "isLatest": true,
    "deprecated": false,
    "inputs": [...],
    "outputs": [...],
    "parameters": [...],
    "createdAt": "2025-01-15T10:00:00Z",
    "updatedAt": "2025-01-15T10:00:00Z"
  }
]
```

### Get Component
```
GET /components/:slug
```

**Response:** Single component object (same schema as list)

---

## Execution Endpoints

### Start Execution
```
POST /workflows/:workflowId/execute
```

**Request Body (optional):**
```json
{
  "parameters": {
    "param1": "value1"
  }
}
```

**Response:**
```json
{
  "executionId": "exec-uuid"
}
```

### Get Execution Status
```
GET /executions/:executionId
```

**Response:**
```json
{
  "executionId": "exec-uuid",
  "workflowId": "workflow-uuid",
  "status": "running",
  "startedAt": "2025-01-15T10:00:00Z",
  "completedAt": null,
  "nodeResults": {
    "node-1": {
      "nodeId": "node-1",
      "status": "success",
      "startedAt": "2025-01-15T10:00:01Z",
      "completedAt": "2025-01-15T10:00:03Z",
      "outputs": {
        "data": ["result1", "result2"]
      }
    },
    "node-2": {
      "nodeId": "node-2",
      "status": "running",
      "startedAt": "2025-01-15T10:00:03Z"
    }
  },
  "logs": [
    {
      "id": "log-uuid",
      "executionId": "exec-uuid",
      "nodeId": "node-1",
      "level": "info",
      "message": "Starting execution",
      "timestamp": "2025-01-15T10:00:01Z"
    }
  ]
}
```

**Status Values:**
- `pending` - Execution queued but not started
- `running` - Currently executing
- `completed` - Successfully completed
- `failed` - Failed with error
- `cancelled` - Cancelled by user

**Node Status Values:**
- `pending` - Not started yet
- `running` - Currently executing
- `success` - Completed successfully
- `error` - Failed with error

### Get Execution Logs
```
GET /executions/:executionId/logs
```

**Response:**
```json
[
  {
    "id": "log-uuid",
    "executionId": "exec-uuid",
    "nodeId": "node-1",
    "level": "info",
    "message": "Log message",
    "timestamp": "2025-01-15T10:00:01Z",
    "metadata": {}
  }
]
```

**Log Levels:** `info`, `warn`, `error`, `debug`

### Cancel Execution
```
POST /executions/:executionId/cancel
```

**Response:**
```json
{
  "success": true
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

**HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `204` - No Content
- `400` - Bad Request
- `404` - Not Found
- `409` - Conflict
- `500` - Internal Server Error

---

## Workflow JSON Structure

Workflows are stored as JSON with this structure:

```json
{
  "id": "uuid",
  "name": "Workflow Name",
  "description": "Optional",
  "version": "1.0.0",
  "nodes": [
    {
      "id": "node-id",
      "type": "workflow",
      "position": { "x": 100, "y": 100 },
      "data": {
        "componentSlug": "subfinder",
        "componentVersion": "1.0.0",
        "parameters": {
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
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "source": "node-1",
      "sourceHandle": "data",
      "target": "node-2",
      "targetHandle": "domain"
    }
  ],
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

---

## Implementation Notes

### Frontend Responsibilities
1. Build visual workflow editor
2. Generate and validate workflow JSON
3. Trigger execution via API
4. Poll for execution status
5. Display logs in real-time

### Backend Responsibilities
1. Store workflows in database
2. Validate workflow structure
3. Execute workflow components
4. Manage data flow between nodes
5. Track execution state
6. Stream logs to frontend

### Execution Flow
1. Frontend: `POST /workflows/:id/execute` → Get `executionId`
2. Frontend: Poll `GET /executions/:executionId` every 2 seconds
3. Backend: Parse workflow, execute nodes in order
4. Backend: Update node states and logs
5. Frontend: Update UI based on execution status
6. Backend: Complete or fail execution
7. Frontend: Stop polling, show final state

---

## Future Enhancements

- WebSocket support for real-time updates (instead of polling)
- Workflow versioning
- Execution history and results storage
- Scheduled executions
- Workflow templates
- Component marketplace
