# ShipSec Studio - Complete Technical Specification

## Executive Summary

ShipSec Studio is a visual workflow automation platform for security reconnaissance, built on Temporal for reliable orchestration. Think "Zapier for Security Recon" - where users drag-and-drop security tools (subfinder, httpx, nuclei) into workflows, and Temporal ensures reliable, long-running execution with automatic retries and failure recovery.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Core Concepts](#core-concepts)
4. [Data Flow](#data-flow)
5. [Temporal Integration](#temporal-integration)
6. [Worker Architecture](#worker-architecture)
7. [Component System](#component-system)
8. [Implementation Guide](#implementation-guide)
9. [API Specifications](#api-specifications)
10. [Deployment Strategy](#deployment-strategy)

---

## Architecture Overview

### High-Level System Architecture

```mermaid
graph TB
    subgraph "Frontend - React + ReactFlow"
        UI[Workflow Canvas<br/>Drag-and-drop editor]
        Inspector[Inspector Panel<br/>Node configuration]
        Exec[Execution Viewer<br/>Real-time status]
        Market[Module Marketplace<br/>Component discovery]
    end
    
    subgraph "Backend - NestJS + Hono"
        API[REST/GraphQL API<br/>Workflow CRUD]
        Auth[Auth Service<br/>Users & permissions]
        WFEngine[Workflow Engine<br/>DAG compiler]
        TempSvc[Temporal Service<br/>Workflow client]
    end
    
    subgraph "Temporal Cluster"
        TServer[Temporal Server<br/>Event sourcing]
        TQueue[Task Queues<br/>Work distribution]
        TWorker[Worker Pool<br/>Execution engine]
    end
    
    subgraph "Execution Layer"
        Registry[Component Registry<br/>Tool definitions]
        InlineRunner[Inline Runner<br/>TypeScript execution]
        DockerRunner[Docker Runner<br/>Container execution]
        K8sRunner[K8s Runner<br/>Job execution]
    end
    
    subgraph "Storage"
        Postgres[(PostgreSQL<br/>Workflows, users, runs)]
        S3[(S3/MinIO<br/>Artifacts, outputs)]
        Redis[(Redis<br/>Cache, sessions)]
    end
    
    UI --> API
    Inspector --> API
    Exec --> API
    Market --> API
    
    API --> Auth
    API --> WFEngine
    API --> TempSvc
    
    TempSvc --> TServer
    TServer --> TQueue
    TQueue --> TWorker
    
    TWorker --> Registry
    Registry --> InlineRunner
    Registry --> DockerRunner
    Registry --> K8sRunner
    
    InlineRunner --> S3
    DockerRunner --> S3
    K8sRunner --> S3
    
    API --> Postgres
    API --> S3
    API --> Redis
    
    TServer --> Postgres
```

### Key Differentiators

| Feature | ShipSec Studio | Tracecat (SOAR) | Manual Scripts |
|---------|----------------|-----------------|----------------|
| **Focus** | Offensive Security / Recon | Defensive / Incident Response | N/A |
| **User Persona** | Bug bounty hunters, pentesters | SOC analysts, security ops | Developers |
| **Tool Ecosystem** | ProjectDiscovery, recon tools | SIEM, EDR, ticketing | Custom scripts |
| **Workflow Pattern** | Target → Discover → Scan → Report | Alert → Investigate → Respond → Close | Linear scripts |
| **Visual Builder** | ✅ ReactFlow-based | ✅ YAML + UI | ❌ Code only |
| **Orchestration** | ✅ Temporal (durable) | ✅ Temporal | ❌ Manual |
| **Marketplace** | 🎯 Recon-specific connectors | 🛡️ SOAR integrations | ❌ N/A |

---

## Technology Stack

### Frontend Stack

```typescript
{
  "framework": "React 18 + TypeScript",
  "build": "Vite",
  "ui": {
    "canvas": "ReactFlow (visual DAG editor)",
    "components": "Shadcn/ui (copy-paste components)",
    "styling": "TailwindCSS",
    "state": "Zustand (lightweight store)",
    "data": "TanStack Query (server state)"
  }
}
```

### Backend Stack

```typescript
{
  "runtime": "Bun (faster than Node.js)",
  "framework": "NestJS (architecture) + Hono (HTTP adapter)",
  "orchestration": "Temporal TypeScript SDK",
  "database": {
    "primary": "PostgreSQL (metadata)",
    "orm": "Drizzle (type-safe, lightweight)",
    "cache": "Redis (sessions, locks)",
    "artifacts": "S3/MinIO (file storage)"
  },
  "validation": "Zod (runtime type checking)"
}
```

### Infrastructure

```yaml
Development:
  - Docker Compose (Temporal + PostgreSQL + MinIO)
  - Workers run on host (easy debugging)
  - Frontend dev server (Vite)

Production:
  - Kubernetes / Docker Compose
  - Temporal Server cluster
  - Multiple specialized workers
  - S3 for artifacts
  - CloudFront CDN
```

---

## Core Concepts

### 1. Workflows (User-Defined Pipelines)

**Definition:** A directed acyclic graph (DAG) of security tools connected by data dependencies.

**Example Workflow: "Full Domain Recon"**
```
Trigger (domain: example.com)
  ↓
Subfinder (enumerate subdomains)
  ↓ (outputs: subdomains[])
HTTPX (probe HTTP services)
  ↓ (outputs: liveHosts[])
Nuclei (scan vulnerabilities)
  ↓ (outputs: findings[])
Slack Notify (send results)
```

**Storage Format:**
```json
{
  "workflowId": "wf-123",
  "name": "Full Domain Recon",
  "version": 1,
  "graph": {
    "nodes": [
      {
        "id": "node-1",
        "type": "trigger",
        "componentId": "manual-trigger",
        "config": { "domain": "{{input.domain}}" }
      },
      {
        "id": "node-2",
        "type": "tool",
        "componentId": "subfinder",
        "config": { "timeout": 300 }
      }
    ],
    "edges": [
      { "from": "node-1", "to": "node-2" }
    ]
  },
  "dsl": null
}
```

### 2. Components (Reusable Tools)

**Definition:** Executable units that perform specific security tasks. Can be inline TypeScript, Docker containers, or Kubernetes jobs.

**Component Types:**

```typescript
type ComponentRunner = 
  | 'inline'   // TypeScript code in worker process
  | 'docker'   // Docker container
  | 'k8s'      // Kubernetes Job
  | 'lambda';  // AWS Lambda (future)

interface ComponentDefinition {
  id: string;                    // e.g., "subfinder"
  name: string;                  // e.g., "Subfinder - Subdomain Enumeration"
  runner: ComponentRunner;       // How to execute
  inputSchema: ZodSchema;        // Input validation
  outputSchema: ZodSchema;       // Output structure
  execute: ExecuteFunction;      // Implementation
  metadata: {
    category: string;            // e.g., "discovery"
    tags: string[];              // e.g., ["subdomain", "passive"]
    icon: string;                // UI icon
    version: string;             // Semver
  };
}
```

**Example Component: Subfinder**

```typescript
const subfinderComponent: ComponentDefinition = {
  id: 'subfinder',
  name: 'Subfinder',
  runner: 'docker',
  inputSchema: z.object({
    domain: z.string(),
    sources: z.array(z.string()).optional(),
    timeout: z.number().default(300),
  }),
  outputSchema: z.object({
    subdomains: z.array(z.string()),
  }),
  execute: async (inputs, config, context) => {
    const cmd = `docker run --rm projectdiscovery/subfinder -d ${inputs.domain} -silent`;
    const { stdout } = await execAsync(cmd);
    
    const subdomains = stdout.trim().split('\n').filter(Boolean);
    
    // Store artifact
    await context.artifacts.store('subdomains.json', JSON.stringify(subdomains));
    
    return { subdomains };
  },
  metadata: {
    category: 'discovery',
    tags: ['subdomain', 'passive', 'recon'],
    icon: '🔍',
    version: '1.0.0',
  },
};
```

### 3. DSL (Domain-Specific Language)

**Definition:** Compiled, validated representation of a workflow ready for execution.

**Compilation Process:**
```
ReactFlow State → DAG JSON → Compiler → DSL → Temporal Workflow
```

**DSL Structure:**
```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  trigger: TriggerDefinition;
  actions: ActionDefinition[];  // Topologically sorted
  edges: Edge[];
}

interface ActionDefinition {
  id: string;
  componentId: string;
  inputs: Record<string, any>;    // Can contain {{variables}}
  config: Record<string, any>;
  dependsOn: string[];            // Parent action IDs
}
```

**Variable Resolution:**
```json
{
  "id": "action-2",
  "componentId": "httpx",
  "inputs": {
    "targets": "{{action-1.output.subdomains}}"
  }
}
```

At runtime, `{{action-1.output.subdomains}}` resolves to actual subdomain list from action-1.

### 4. Execution Context

**Definition:** Runtime environment provided to each component during execution.

```typescript
interface ExecutionContext {
  runId: string;
  actionId: string;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  secrets: {
    get: (key: string) => Promise<string | undefined>;
  };
  artifacts: {
    store: (name: string, content: string | Buffer) => Promise<string>;
    get: (path: string) => Promise<Buffer>;
  };
}
```

---

## Data Flow

### Complete Journey: Frontend → Temporal → Results

```mermaid
sequenceDiagram
    participant User
    participant ReactFlow as ReactFlow Canvas
    participant API as NestJS API
    participant Compiler as DSL Compiler
    participant Temporal as Temporal Server
    participant Worker as Temporal Worker
    participant Registry as Component Registry
    participant Docker as Docker Runner
    participant S3 as Artifact Store
    
    Note over User,ReactFlow: STAGE 1: Building Workflow
    User->>ReactFlow: Drag "Subfinder" node
    User->>ReactFlow: Connect to "HTTPX" node
    ReactFlow->>ReactFlow: Update state: {nodes[], edges[]}
    
    Note over User,API: STAGE 2: Saving Workflow
    User->>ReactFlow: Click "Save"
    ReactFlow->>ReactFlow: Convert ReactFlow → DAG JSON
    ReactFlow->>API: POST /workflows {name, graph}
    API->>API: Validate graph structure
    API->>Compiler: Compile DAG → DSL
    Compiler->>Compiler: Topological sort
    Compiler->>Compiler: Validate dependencies
    API-->>ReactFlow: {workflowId: "wf-123"}
    
    Note over User,Temporal: STAGE 3: Executing Workflow
    User->>ReactFlow: Click "Run"
    ReactFlow->>API: POST /workflows/wf-123/run<br/>{inputs: {domain: "example.com"}}
    API->>API: Load WorkflowDefinition (DSL)
    API->>Temporal: client.workflow.start(shipSecWorkflow, {dsl, inputs})
    Temporal->>Temporal: Create workflow instance
    Temporal->>Temporal: Add task to queue "shipsec-docker"
    Temporal-->>API: {workflowId, runId}
    API-->>ReactFlow: 202 Accepted {runId: "run-456"}
    
    Note over Worker,Registry: STAGE 4: Worker Execution
    Worker->>Temporal: Poll queue "shipsec-docker"
    Temporal-->>Worker: Workflow task: {dsl, inputs}
    Worker->>Worker: Parse DSL actions
    Worker->>Worker: Topologically sort execution order
    
    loop For each action in DAG
        Worker->>Registry: Get component "subfinder"
        Registry-->>Worker: ComponentDefinition
        Worker->>Docker: Execute component
        Docker->>Docker: docker run projectdiscovery/subfinder
        Docker-->>Worker: {output: {subdomains: [...]}}
        Worker->>S3: Upload artifact
        Worker->>Temporal: Activity completed
    end
    
    Worker->>Temporal: Workflow completed
    Temporal->>Temporal: Mark as completed
    
    Note over ReactFlow,User: STAGE 5: Results Display
    ReactFlow->>API: GET /runs/run-456/status (polling)
    API->>Temporal: Query workflow status
    Temporal-->>API: {status: "completed", result: {...}}
    API-->>ReactFlow: {status: "completed", artifacts: [...]}
    ReactFlow->>ReactFlow: Update UI (green checkmarks)
    ReactFlow-->>User: Show results + download artifacts
```

### Data Shape Transformations

```typescript
// 1. ReactFlow State (Frontend)
const reactFlowState = {
  nodes: [
    { id: "1", type: "trigger", data: { label: "Manual" } },
    { id: "2", type: "tool", data: { componentId: "subfinder" } },
  ],
  edges: [
    { id: "e1-2", source: "1", target: "2" }
  ]
};

// 2. DAG JSON (API Request)
const dagJSON = {
  workflowId: "wf-123",
  name: "Recon Pipeline",
  nodes: [
    { id: "1", type: "trigger", inputs: { domain: "example.com" } },
    { id: "2", type: "action", componentId: "subfinder", inputs: { domain: "{{1.domain}}" } },
  ],
  edges: [{ from: "1", to: "2" }]
};

// 3. DSL (Compiled)
const dsl: WorkflowDefinition = {
  id: "wf-123",
  name: "Recon Pipeline",
  version: 1,
  actions: [
    { id: "1", componentId: "trigger", inputs: {}, dependsOn: [] },
    { id: "2", componentId: "subfinder", inputs: { domain: "{{1.domain}}" }, dependsOn: ["1"] },
  ],
  edges: [{ from: "1", to: "2" }]
};

// 4. Temporal Workflow Input
const workflowInput = {
  workflowDefinition: dsl,
  inputs: { domain: "example.com" },
  runId: "run-456"
};

// 5. Worker Execution Context
const executionState = {
  runId: "run-456",
  actionOutputs: {
    "1": { domain: "example.com" },
    "2": { subdomains: ["api.example.com", "dev.example.com"] }
  },
  artifacts: [
    { actionId: "2", path: "s3://bucket/run-456/subdomains.json" }
  ]
};

// 6. Final Result (API Response)
const result = {
  runId: "run-456",
  status: "completed",
  startTime: "2024-10-05T10:00:00Z",
  endTime: "2024-10-05T10:05:00Z",
  outputs: {
    "2": { subdomains: ["api.example.com", "dev.example.com"] }
  },
  artifacts: [
    { name: "subdomains.json", url: "/api/artifacts/...", size: 1024 }
  ]
};
```

---

## Temporal Integration

### Why Temporal for ShipSec?

| Requirement | Why Temporal Fits |
|-------------|------------------|
| **Long-running workflows** | Recon scans can take hours; Temporal handles this natively |
| **Reliability** | Auto-retry on failure, resume after crashes |
| **Event-driven** | User triggers scan immediately, not on cron schedule |
| **Complex orchestration** | Parallel execution, conditional logic, human-in-loop |
| **State management** | No need to manage workflow state in database |
| **Observability** | Built-in UI shows all workflow executions and history |

### Temporal Architecture

```mermaid
graph TB
    subgraph "Temporal Infrastructure (Docker)"
        TS[Temporal Server<br/>━━━━━━━━━<br/>Event sourcing<br/>Task distribution<br/>State machines]
        TUI[Temporal UI<br/>━━━━━━━━━<br/>Workflow monitoring<br/>localhost:8080]
        PG[(PostgreSQL<br/>━━━━━━━━━<br/>Event history storage)]
        
        TS --> PG
        TUI --> TS
    end
    
    subgraph "Your Application (Backend)"
        API[NestJS API<br/>━━━━━━━━━<br/>Temporal Client<br/>Starts workflows<br/>Queries status]
        
        W1[Worker Process 1<br/>━━━━━━━━━<br/>Polls queue<br/>Executes workflows<br/>Runs activities]
        
        W2[Worker Process 2<br/>━━━━━━━━━<br/>Polls queue<br/>Same capabilities]
    end
    
    API -->|gRPC: StartWorkflow| TS
    API -->|gRPC: QueryWorkflow| TS
    
    W1 -->|gRPC: PollTaskQueue| TS
    W2 -->|gRPC: PollTaskQueue| TS
    
    TS -->|Assign tasks| W1
    TS -->|Assign tasks| W2
    
    style TS fill:#E74C3C,color:#fff
    style API fill:#3498DB,color:#fff
    style W1 fill:#27AE60,color:#fff
    style W2 fill:#27AE60,color:#fff
```

### Workflows vs Activities

**Workflows (Orchestration)**
- ✅ Deterministic (same input = same output)
- ✅ Can call activities, timers, signals
- ❌ Cannot do I/O (no API calls, no file reads, no randomness)
- ❌ Cannot access external state
- ✅ Automatically replayed on worker restart
- ✅ Can run for months/years

**Activities (Execution)**
- ✅ Non-deterministic (can do anything)
- ✅ Can call APIs, read files, run binaries
- ✅ Automatically retried on failure
- ✅ Have timeouts, heartbeats
- ❌ Should be idempotent (safe to retry)
- ✅ Usually short-lived (seconds to minutes)

### ShipSec Workflow Implementation

```typescript
// backend/src/temporal/workflows/shipsec.workflow.ts

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { runComponentActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '1s',
    maximumAttempts: 3,
  },
});

export async function shipSecWorkflow(input: {
  workflowDefinition: WorkflowDefinition;
  inputs: Record<string, any>;
  runId: string;
}): Promise<WorkflowResult> {
  const { workflowDefinition, inputs, runId } = input;
  
  console.log(`Starting workflow: ${workflowDefinition.name}`);
  
  const actionOutputs: Record<string, any> = {};
  const artifacts: ArtifactReference[] = [];
  
  // Actions are already topologically sorted in DSL
  for (const action of workflowDefinition.actions) {
    console.log(`Executing action: ${action.id} (${action.componentId})`);
    
    // Resolve variables like {{action-1.output.domain}}
    const resolvedInputs = resolveVariables(
      action.inputs,
      actionOutputs,
      inputs
    );
    
    // Execute component via activity
    const result = await runComponentActivity({
      componentId: action.componentId,
      actionId: action.id,
      inputs: resolvedInputs,
      config: action.config || {},
      runId,
    });
    
    // Store output for downstream actions
    actionOutputs[action.id] = result.output;
    artifacts.push(...result.artifacts);
    
    console.log(`Action ${action.id} completed`);
  }
  
  return {
    status: 'completed',
    outputs: actionOutputs,
    artifacts,
  };
}

// Helper: Resolve {{variables}} in inputs
function resolveVariables(
  inputs: Record<string, any>,
  actionOutputs: Record<string, any>,
  workflowInputs: Record<string, any>
): Record<string, any> {
  const resolved: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'string' && value.startsWith('{{')) {
      const path = value.slice(2, -2).trim();
      resolved[key] = resolvePath(path, actionOutputs, workflowInputs);
    } else {
      resolved[key] = value;
    }
  }
  
  return resolved;
}
```

### Activity Implementation

```typescript
// backend/src/temporal/activities/component.activity.ts

import { ComponentRegistry } from '../../components/registry';

export async function runComponentActivity(input: {
  componentId: string;
  actionId: string;
  inputs: Record<string, any>;
  config: Record<string, any>;
  runId: string;
}): Promise<{
  output: any;
  artifacts: ArtifactReference[];
}> {
  const { componentId, actionId, inputs, config, runId } = input;
  
  console.log(`[Activity] Running component: ${componentId}`);
  
  // Get component from registry
  const registry = ComponentRegistry.getInstance();
  const component = registry.get(componentId);
  
  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }
  
  // Create execution context
  const context: ExecutionContext = {
    runId,
    actionId,
    logger: {
      info: (msg) => console.log(`[${actionId}] ${msg}`),
      error: (msg) => console.error(`[${actionId}] ${msg}`),
      debug: (msg) => console.debug(`[${actionId}] ${msg}`),
    },
    secrets: {
      get: async (key) => process.env[key],
    },
    artifacts: {
      store: async (name, content) => {
        const path = await uploadToS3(runId, actionId, name, content);
        return path;
      },
    },
  };
  
  // Execute component
  const output = await component.execute(inputs, config, context);
  
  return {
    output,
    artifacts: [], // Populated by context.artifacts.store()
  };
}
```

### Temporal Service (Client Wrapper)

```typescript
// backend/src/temporal/temporal.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Connection, Client } from '@temporalio/client';
import { shipSecWorkflow } from './workflows/shipsec.workflow';

@Injectable()
export class TemporalService implements OnModuleInit {
  private connection: Connection;
  private client: Client;

  async onModuleInit() {
    this.connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    this.client = new Client({ connection: this.connection });
    console.log('✓ Temporal client connected');
  }

  async startWorkflow(input: {
    workflowDefinition: WorkflowDefinition;
    inputs: Record<string, any>;
    runId: string;
  }) {
    const workflowId = `shipsec-${input.runId}`;
    
    const handle = await this.client.workflow.start(shipSecWorkflow, {
      taskQueue: 'shipsec-main',
      args: [input],
      workflowId,
      workflowExecutionTimeout: '1 hour',
    });

    return {
      workflowId: handle.workflowId,
      runId: await handle.firstExecutionRunId,
    };
  }

  async getWorkflowStatus(workflowId: string) {
    const handle = this.client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    
    return {
      workflowId,
      status: description.status.name,
      startTime: description.startTime,
      closeTime: description.closeTime,
    };
  }

  async getWorkflowResult(workflowId: string) {
    const handle = this.client.workflow.getHandle(workflowId);
    return await handle.result();
  }
}
```

---

## Worker Architecture

### Worker Specialization Strategy

Workers can be specialized based on capabilities. This allows efficient resource allocation and horizontal scaling.

```mermaid
graph TB
    subgraph "Task Queues (Routing)"
        Q1[shipsec-general<br/>━━━━━━━━━<br/>Inline transforms<br/>API calls<br/>Webhooks]
        
        Q2[shipsec-docker<br/>━━━━━━━━━<br/>Docker-based tools<br/>Subfinder, Nuclei<br/>HTTPX, Katana]
        
        Q3[shipsec-compute<br/>━━━━━━━━━<br/>Heavy processing<br/>Large file parsing<br/>Mass DNS resolution]
    end
    
    subgraph "Specialized Workers"
        W1[General Workers x5<br/>━━━━━━━━━<br/>Queue: general<br/>Cost: $20/mo each<br/>Instance: t3.small]
        
        W2[Docker Workers x3<br/>━━━━━━━━━<br/>Queue: docker<br/>Cost: $80/mo each<br/>Instance: t3.large + Docker]
        
        W3[Compute Worker x1<br/>━━━━━━━━━<br/>Queue: compute<br/>Cost: $300/mo<br/>Instance: c5.4xlarge]
    end
    
    subgraph "Component Registry"
        REG[Registry Routes:<br/>━━━━━━━━━<br/>inline → general<br/>docker → docker<br/>compute → compute]
    end
    
    Q1 --> W1
    Q2 --> W2
    Q3 --> W3
    
    REG -.defines.-> Q1
    REG -.defines.-> Q2
    REG -.defines.-> Q3
    
    style Q1 fill:#3498DB,color:#fff
    style Q2 fill:#27AE60,color:#fff
    style Q3 fill:#E74C3C,color:#fff
```

### Worker Polling Mechanism

```mermaid
sequenceDiagram
    participant W as Worker Process
    participant TS as Temporal Server
    participant TQ as Task Queue
    
    Note over W: Worker starts
    W->>TS: Connect via gRPC (localhost:7233)
    W->>TS: Register: taskQueue="shipsec-docker"
    
    Note over W,TS: Long-polling begins
    loop Infinite polling
        W->>TS: PollWorkflowTaskQueue("shipsec-docker")
        Note over W,TS: Connection open for 60s
        alt Task available
            TS-->>W: Workflow task
            W->>W: Execute workflow code
            W->>TS: CompleteWorkflowTask
        else No tasks
            TS-->>W: No tasks (timeout)
        end
        
        W->>TS: PollActivityTaskQueue("shipsec-docker")
        alt Task available
            TS-->>W: Activity task
            W->>W: Execute activity (run component)
            W->>TS: CompleteActivityTask
        else No tasks
            TS-->>W: No tasks (timeout)
        end
    end
```

### Worker Types

**Development Worker (Single, Hybrid)**
```typescript
// backend/src/temporal/workers/dev.worker.ts
const worker = await Worker.create({
  taskQueue: 'shipsec-dev',
  workflowsPath: require.resolve('../workflows'),
  activities: {
    ...inlineActivities,
    ...dockerActivities,
    ...apiActivities,
  },
});

// Handles everything - easy for local development
```

**Production Workers (Specialized)**

```typescript
// General Worker (cheap, scalable)
const generalWorker = await Worker.create({
  taskQueue: 'shipsec-general',
  activities: {
    parseJSON,
    filterData,
    transformData,
    sendWebhook,
  },
});

// Docker Worker (medium cost, Docker daemon required)
const dockerWorker = await Worker.create({
  taskQueue: 'shipsec-docker',
  activities: {
    runSubfinder,
    runHttpx,
    runNuclei,
    runKatana,
  },
});

// Compute Worker (expensive, high CPU/RAM)
const computeWorker = await Worker.create({
  taskQueue: 'shipsec-compute',
  activities: {
    parseLargeFile,
    massDNSResolution,
    bruteforceSubdomains,
  },
});
```

### How Temporal Routes Tasks

1. **Workflow specifies task queue per activity:**
```typescript
// In workflow code
const dockerActivities = proxyActivities({
  taskQueue: 'shipsec-docker',  // ← Routes to Docker workers
  startToCloseTimeout: '30m',
});

const generalActivities = proxyActivities({
  taskQueue: 'shipsec-general',  // ← Routes to General workers
  startToCloseTimeout: '5m',
});

// Use appropriate activity proxy
await dockerActivities.runSubfinder({ domain });
await generalActivities.sendWebhook({ url, data });
```

2. **Component Registry decides routing:**
```typescript
class ComponentRegistry {
  getTaskQueue(componentId: string): string {
    const component = this.components.get(componentId);
    
    switch (component.runner) {
      case 'inline': return 'shipsec-general';
      case 'docker': return 'shipsec-docker';
      case 'compute': return 'shipsec-compute';
      default: return 'shipsec-general';
    }
  }
}
```

3. **Dynamic activity routing:**
```typescript
// In workflow - dynamically route based on component
const registry = ComponentRegistry.getInstance();
const taskQueue = registry.getTaskQueue(componentId);

const activities = proxyActivities({
  taskQueue,  // ← Determined at runtime
  startToCloseTimeout: '30m',
});

await activities.runComponentActivity({ componentId, inputs });
```

---

## Component System

### Component Registry Architecture

```mermaid
graph TB
    subgraph "Component Definition Layer"
        DEF1[Component: Subfinder<br/>━━━━━━━━━<br/>runner: docker<br/>inputs: {'{domain}'}<br/>outputs: {'{subdomains}'}]
        
        DEF2[Component: HTTPX<br/>━━━━━━━━━<br/>runner: docker<br/>inputs: {'{targets}'}<br/>outputs: {'{results}'}]
        
        DEF3[Component: JSON Parser<br/>━━━━━━━━━<br/>runner: inline<br/>inputs: {'{data}'}<br/>outputs: {'{parsed}'}]
    end
    
    subgraph "Component Registry"
        REG[Registry Map<br/>━━━━━━━━━<br/>'subfinder' → DEF1<br/>'httpx' → DEF2<br/>'json-parser' → DEF3]
    end
    
    subgraph "Runner Layer"
        INLINE[Inline Runner<br/>━━━━━━━━━<br/>Execute TypeScript<br/>In-process]
        
        DOCKER[Docker Runner<br/>━━━━━━━━━<br/>Spawn container<br/>Capture output]
        
        K8S[K8s Runner<br/>━━━━━━━━━<br/>Create Job<br/>Wait for completion]
    end
    
    DEF1 --> REG
    DEF2 --> REG
    DEF3 --> REG
    
    REG --> INLINE
    REG --> DOCKER
    REG --> K8S
    
    style DEF1 fill:#27AE60,color:#fff
    style DEF2 fill:#3498DB,color:#fff
    style DEF3 fill:#F39C12,color:#fff
```

### Component Interface

```typescript
// backend/src/components/types.ts

export type ComponentRunner = 'inline' | 'docker' | 'k8s' | 'lambda';

export interface ComponentDefinition {
  // Metadata
  id: string;
  name: string;
  description: string;
  version: string;
  
  // Execution
  runner: ComponentRunner;
  execute: ExecuteFunction;
  
  // Schema
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;
  configSchema?: z.ZodSchema;
  
  // UI Metadata
  metadata: {
    category: 'discovery' | 'scanning' | 'exploitation' | 'reporting' | 'transform';
    tags: string[];
    icon: string;
    author: string;
    license: string;
  };
  
  // Runner-specific config
  runnerConfig?: {
    docker?: {
      image: string;
      command?: string[];
      env?: Record<string, string>;
    };
    k8s?: {
      image: string;
      resources?: {
        cpu: string;
        memory: string;
      };
    };
  };
}

export type ExecuteFunction = (
  inputs: Record<string, any>,
  config: Record<string, any>,
  context: ExecutionContext
) => Promise<Record<string, any>>;

export interface ExecutionContext {
  runId: string;
  actionId: string;
  logger: Logger;
  secrets: SecretStore;
  artifacts: ArtifactStore;
}
```

### Example Components

**1. Subfinder (Docker)**
```typescript
export const subfinderComponent: ComponentDefinition = {
  id: 'subfinder',
  name: 'Subfinder',
  description: 'Fast subdomain enumeration tool',
  version: '2.6.3',
  runner: 'docker',
  
  inputSchema: z.object({
    domain: z.string(),
    sources: z.array(z.string()).optional(),
    timeout: z.number().default(300),
  }),
  
  outputSchema: z.object({
    subdomains: z.array(z.string()),
    count: z.number(),
  }),
  
  runnerConfig: {
    docker: {
      image: 'projectdiscovery/subfinder:latest',
    },
  },
  
  execute: async (inputs, config, context) => {
    const { domain, sources, timeout } = inputs;
    
    context.logger.info(`Enumerating subdomains for: ${domain}`);
    
    let cmd = `docker run --rm projectdiscovery/subfinder -d ${domain} -silent`;
    
    if (sources?.length) {
      cmd += ` -sources ${sources.join(',)}`;
    }
    
    const { stdout } = await execWithTimeout(cmd, timeout * 1000);
    const subdomains = stdout.trim().split('\n').filter(Boolean);
    
    // Store artifact
    const artifactPath = await context.artifacts.store(
      'subdomains.txt',
      subdomains.join('\n')
    );
    
    context.logger.info(`Found ${subdomains.length} subdomains`);
    
    return {
      subdomains,
      count: subdomains.length,
    };
  },
  
  metadata: {
    category: 'discovery',
    tags: ['subdomain', 'passive', 'recon'],
    icon: '🔍',
    author: 'ProjectDiscovery',
    license: 'MIT',
  },
};
```

**2. HTTPX (Docker)**
```typescript
export const httpxComponent: ComponentDefinition = {
  id: 'httpx',
  name: 'HTTPX',
  description: 'Fast HTTP probe',
  version: '1.3.7',
  runner: 'docker',
  
  inputSchema: z.object({
    targets: z.array(z.string()),
    threads: z.number().default(50),
    timeout: z.number().default(10),
    followRedirects: z.boolean().default(false),
  }),
  
  outputSchema: z.object({
    results: z.array(z.object({
      url: z.string(),
      status: z.number(),
      title: z.string().optional(),
      contentLength: z.number().optional(),
      technologies: z.array(z.string()).optional(),
    })),
  }),
  
  runnerConfig: {
    docker: {
      image: 'projectdiscovery/httpx:latest',
    },
  },
  
  execute: async (inputs, config, context) => {
    const { targets, threads, timeout, followRedirects } = inputs;
    
    context.logger.info(`Probing ${targets.length} targets`);
    
    // Write targets to temp file
    const targetsFile = `/tmp/${context.runId}-targets.txt`;
    await writeFile(targetsFile, targets.join('\n'));
    
    let cmd = `docker run --rm -v ${targetsFile}:/targets.txt `;
    cmd += `projectdiscovery/httpx -l /targets.txt -json `;
    cmd += `-threads ${threads} -timeout ${timeout}`;
    
    if (followRedirects) {
      cmd += ` -follow-redirects`;
    }
    
    const { stdout } = await execAsync(cmd);
    
    const results = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    
    // Store artifact
    await context.artifacts.store('httpx-results.json', JSON.stringify(results, null, 2));
    
    context.logger.info(`Found ${results.length} live hosts`);
    
    return { results };
  },
  
  metadata: {
    category: 'discovery',
    tags: ['http', 'probe', 'web'],
    icon: '🌐',
    author: 'ProjectDiscovery',
    license: 'MIT',
  },
};
```

**3. JSON Parser (Inline)**
```typescript
export const jsonParserComponent: ComponentDefinition = {
  id: 'json-parser',
  name: 'JSON Parser',
  description: 'Parse and transform JSON data',
  version: '1.0.0',
  runner: 'inline',
  
  inputSchema: z.object({
    data: z.string(),
    path: z.string().optional(),
  }),
  
  outputSchema: z.object({
    parsed: z.any(),
  }),
  
  execute: async (inputs, config, context) => {
    const { data, path } = inputs;
    
    context.logger.info('Parsing JSON data');
    
    let parsed = JSON.parse(data);
    
    if (path) {
      // Support JSONPath-like syntax: "users[0].name"
      const parts = path.split('.');
      for (const part of parts) {
        parsed = parsed[part];
      }
    }
    
    return { parsed };
  },
  
  metadata: {
    category: 'transform',
    tags: ['json', 'parse', 'transform'],
    icon: '📋',
    author: 'ShipSec',
    license: 'MIT',
  },
};
```

**4. Nuclei (Docker)**
```typescript
export const nucleiComponent: ComponentDefinition = {
  id: 'nuclei',
  name: 'Nuclei',
  description: 'Vulnerability scanner based on templates',
  version: '3.1.0',
  runner: 'docker',
  
  inputSchema: z.object({
    targets: z.array(z.string()),
    templates: z.array(z.string()).optional(),
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
    rateLimit: z.number().default(150),
  }),
  
  outputSchema: z.object({
    findings: z.array(z.object({
      templateId: z.string(),
      name: z.string(),
      severity: z.string(),
      host: z.string(),
      matched: z.string(),
    })),
    count: z.number(),
  }),
  
  runnerConfig: {
    docker: {
      image: 'projectdiscovery/nuclei:latest',
    },
  },
  
  execute: async (inputs, config, context) => {
    const { targets, templates, severity, rateLimit } = inputs;
    
    context.logger.info(`Scanning ${targets.length} targets with Nuclei`);
    
    const targetsFile = `/tmp/${context.runId}-nuclei-targets.txt`;
    await writeFile(targetsFile, targets.join('\n'));
    
    let cmd = `docker run --rm -v ${targetsFile}:/targets.txt `;
    cmd += `projectdiscovery/nuclei -l /targets.txt -json `;
    cmd += `-rate-limit ${rateLimit}`;
    
    if (templates?.length) {
      cmd += ` -t ${templates.join(',')}`;
    }
    
    if (severity) {
      cmd += ` -severity ${severity}`;
    }
    
    const { stdout } = await execAsync(cmd);
    
    const findings = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    
    // Store artifact
    await context.artifacts.store('nuclei-findings.json', JSON.stringify(findings, null, 2));
    
    context.logger.info(`Found ${findings.length} vulnerabilities`);
    
    return {
      findings,
      count: findings.length,
    };
  },
  
  metadata: {
    category: 'scanning',
    tags: ['vulnerability', 'nuclei', 'template'],
    icon: '🎯',
    author: 'ProjectDiscovery',
    license: 'MIT',
  },
};
```

### Component Registry Implementation

```typescript
// backend/src/components/registry.ts

export class ComponentRegistry {
  private static instance: ComponentRegistry;
  private components = new Map<string, ComponentDefinition>();
  
  static getInstance(): ComponentRegistry {
    if (!this.instance) {
      this.instance = new ComponentRegistry();
    }
    return this.instance;
  }
  
  register(component: ComponentDefinition): void {
    this.components.set(component.id, component);
    console.log(`✓ Registered component: ${component.id}`);
  }
  
  get(id: string): ComponentDefinition | undefined {
    return this.components.get(id);
  }
  
  list(): ComponentDefinition[] {
    return Array.from(this.components.values());
  }
  
  listByCategory(category: string): ComponentDefinition[] {
    return this.list().filter(c => c.metadata.category === category);
  }
  
  getTaskQueue(componentId: string): string {
    const component = this.get(componentId);
    if (!component) {
      throw new Error(`Component not found: ${componentId}`);
    }
    
    switch (component.runner) {
      case 'inline':
        return 'shipsec-general';
      case 'docker':
        return 'shipsec-docker';
      case 'k8s':
        return 'shipsec-k8s';
      case 'lambda':
        return 'shipsec-lambda';
      default:
        return 'shipsec-general';
    }
  }
}

// Initialize registry with built-in components
export function initializeRegistry(): void {
  const registry = ComponentRegistry.getInstance();
  
  // Discovery components
  registry.register(subfinderComponent);
  registry.register(httpxComponent);
  registry.register(katanaComponent);
  
  // Scanning components
  registry.register(nucleiComponent);
  registry.register(nmapComponent);
  
  // Transform components
  registry.register(jsonParserComponent);
  registry.register(filterComponent);
  registry.register(dedupeComponent);
  
  // Action components
  registry.register(slackWebhookComponent);
  registry.register(discordWebhookComponent);
  
  console.log(`✓ Initialized registry with ${registry.list().length} components`);
}
```

---

## Implementation Guide

### Phase 4: Temporal Integration (Current Phase)

**Goal:** Integrate Temporal workflow orchestration with component registry.

#### Step 1: Setup Temporal Infrastructure

**docker/docker-compose.yml:**
```yaml
version: '3.8'

services:
  postgresql:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
      POSTGRES_DB: temporal
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  temporal:
    image: temporalio/auto-setup:1.24.2
    depends_on:
      - postgresql
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=postgres
      - POSTGRES_PWD=postgres
      - POSTGRES_SEEDS=postgresql
    ports:
      - "7233:7233"  # gRPC
      - "8233:8233"  # Membership

  temporal-ui:
    image: temporalio/ui:2.26.2
    depends_on:
      - temporal
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_CORS_ORIGINS=http://localhost:3000
    ports:
      - "8080:8080"

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  minio_data:
```

**Start infrastructure:**
```bash
cd docker
docker-compose up -d

# Verify
docker ps
curl http://localhost:8080  # Temporal UI
curl http://localhost:9001  # MinIO Console
```

#### Step 2: Install Dependencies

```bash
cd backend

# Temporal
bun add @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity

# AWS SDK for S3/MinIO
bun add @aws-sdk/client-s3

# Utilities
bun add uuid zod
bun add -d @types/uuid
```

#### Step 3: Create Temporal Module Structure

```bash
backend/src/temporal/
├── workflows/
│   └── shipsec.workflow.ts
├── activities/
│   ├── component.activity.ts
│   └── index.ts
├── workers/
│   ├── dev.worker.ts
│   ├── docker.worker.ts
│   └── general.worker.ts
├── temporal.service.ts
├── temporal.module.ts
└── types.ts
```

#### Step 4: Implement Workflow

*See "Temporal Integration" section above for complete workflow code.*

#### Step 5: Implement Activities

*See "Temporal Integration" section above for complete activity code.*

#### Step 6: Create Worker Script

**backend/src/temporal/workers/dev.worker.ts:**
```typescript
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from '../activities';
import { ComponentRegistry, initializeRegistry } from '../../components/registry';

async function startWorker() {
  // Initialize component registry
  initializeRegistry();
  
  // Connect to Temporal
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'shipsec-dev',
    workflowsPath: require.resolve('../workflows/shipsec.workflow'),
    activities,
  });

  console.log('🔧 Worker started');
  console.log('   Queue: shipsec-dev');
  console.log('   Address:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
  console.log('   Components:', ComponentRegistry.getInstance().list().length);
  
  await worker.run();
}

startWorker().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
```

#### Step 7: Update Workflows Service

**backend/src/workflows/workflows.service.ts:**
```typescript
import { Injectable } from '@nestjs/common';
import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRepository } from './workflow.repository';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly workflowRepo: WorkflowRepository,
    private readonly temporal: TemporalService,
  ) {}

  async executeWorkflow(workflowId: string, inputs: Record<string, any>) {
    // Load workflow
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (!workflow.dsl) {
      throw new Error(`Workflow not committed: ${workflowId}. Run POST /workflows/:id/commit first.`);
    }

    // Generate run ID
    const runId = uuidv4();

    // Start Temporal workflow
    const result = await this.temporal.startWorkflow({
      workflowDefinition: workflow.dsl,
      inputs,
      runId,
    });

    return {
      runId,
      workflowId: result.workflowId,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
  }

  async getRunStatus(runId: string) {
    const workflowId = `shipsec-${runId}`;
    return await this.temporal.getWorkflowStatus(workflowId);
  }

  async getRunResult(runId: string) {
    const workflowId = `shipsec-${runId}`;
    return await this.temporal.getWorkflowResult(workflowId);
  }

  async cancelRun(runId: string) {
    const workflowId = `shipsec-${runId}`;
    await this.temporal.cancelWorkflow(workflowId);
    return { runId, status: 'cancelled' };
  }
}
```

#### Step 8: Update Workflows Controller

**backend/src/workflows/workflows.controller.ts:**
```typescript
import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post(':id/run')
  async executeWorkflow(
    @Param('id') workflowId: string,
    @Body() body: { inputs: Record<string, any> }
  ) {
    return await this.workflowsService.executeWorkflow(workflowId, body.inputs);
  }

  @Get('runs/:runId/status')
  async getRunStatus(@Param('runId') runId: string) {
    return await this.workflowsService.getRunStatus(runId);
  }

  @Get('runs/:runId/result')
  async getRunResult(@Param('runId') runId: string) {
    return await this.workflowsService.getRunResult(runId);
  }

  @Delete('runs/:runId')
  async cancelRun(@Param('runId') runId: string) {
    return await this.workflowsService.cancelRun(runId);
  }
}
```

#### Step 9: Update App Module

**backend/src/app.module.ts:**
```typescript
import { Module } from '@nestjs/common';
import { WorkflowsModule } from './workflows/workflows.module';
import { TemporalModule } from './temporal/temporal.module';
import { ComponentsModule } from './components/components.module';

@Module({
  imports: [
    TemporalModule,
    ComponentsModule,
    WorkflowsModule,
  ],
})
export class AppModule {}
```

#### Step 10: Add Package Scripts

**backend/package.json:**
```json
{
  "scripts": {
    "start": "bun src/main.ts",
    "dev": "bun --watch src/main.ts",
    "worker": "bun src/temporal/workers/dev.worker.ts",
    "worker:dev": "bun --watch src/temporal/workers/dev.worker.ts",
    "worker:docker": "bun src/temporal/workers/docker.worker.ts",
    "worker:general": "bun src/temporal/workers/general.worker.ts"
  }
}
```

#### Step 11: Run and Test

```bash
# Terminal 1: Infrastructure
cd docker && docker-compose up -d

# Terminal 2: API
cd backend && bun run dev

# Terminal 3: Worker
bun run worker:dev

# Terminal 4: Test execution
curl -X POST http://localhost:3000/workflows/wf-123/run \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "domain": "example.com"
    }
  }'

# Response:
# {
#   "runId": "abc-123-def",
#   "workflowId": "shipsec-abc-123-def",
#   "status": "running"
# }

# Check status
curl http://localhost:3000/workflows/runs/abc-123-def/status

# Get results
curl http://localhost:3000/workflows/runs/abc-123-def/result
```

#### Step 12: Verify in Temporal UI

1. Open http://localhost:8080
2. Navigate to "Workflows"
3. Find workflow `shipsec-abc-123-def`
4. View execution history, events, and results

---

## API Specifications

### Workflow Endpoints

```typescript
// GET /workflows
// List all workflows
{
  "workflows": [
    {
      "id": "wf-123",
      "name": "Full Domain Recon",
      "version": 1,
      "createdAt": "2024-10-05T10:00:00Z",
      "updatedAt": "2024-10-05T12:00:00Z"
    }
  ]
}

// POST /workflows
// Create new workflow
Request: {
  "name": "My Recon Pipeline",
  "graph": {
    "nodes": [...],
    "edges": [...]
  }
}
Response: {
  "id": "wf-456",
  "name": "My Recon Pipeline",
  "status": "draft"
}

// POST /workflows/:id/commit
// Compile and validate workflow
Response: {
  "id": "wf-456",
  "status": "committed",
  "dsl": { ... }
}

// POST /workflows/:id/run
// Execute workflow
Request: {
  "inputs": {
    "domain": "example.com"
  }
}
Response: {
  "runId": "run-789",
  "workflowId": "shipsec-run-789",
  "status": "running",
  "startedAt": "2024-10-05T14:00:00Z"
}

// GET /workflows/runs/:runId/status
// Check execution status
Response: {
  "runId": "run-789",
  "status": "running" | "completed" | "failed",
  "startTime": "2024-10-05T14:00:00Z",
  "closeTime": null,
  "progress": {
    "completedActions": 2,
    "totalActions": 5
  }
}

// GET /workflows/runs/:runId/result
// Get execution results
Response: {
  "runId": "run-789",
  "status": "completed",
  "outputs": {
    "action-1": { "domain": "example.com" },
    "action-2": { "subdomains": ["api.example.com"] }
  },
  "artifacts": [
    {
      "actionId": "action-2",
      "name": "subdomains.json",
      "url": "/api/artifacts/run-789/action-2/subdomains.json",
      "size": 1024
    }
  ]
}

// DELETE /workflows/runs/:runId
// Cancel running workflow
Response: {
  "runId": "run-789",
  "status": "cancelled"
}
```

### Component Endpoints

```typescript
// GET /components
// List all available components
Response: {
  "components": [
    {
      "id": "subfinder",
      "name": "Subfinder",
      "category": "discovery",
      "runner": "docker",
      "version": "2.6.3",
      "icon": "🔍"
    }
  ]
}

// GET /components/:id
// Get component details
Response: {
  "id": "subfinder",
  "name": "Subfinder",
  "description": "Fast subdomain enumeration",
  "inputSchema": { ... },
  "outputSchema": { ... },
  "metadata": { ... }
}

// GET /components/categories
// List component categories
Response: {
  "categories": [
    { "id": "discovery", "name": "Discovery", "count": 5 },
    { "id": "scanning", "name": "Scanning", "count": 3 },
    { "id": "transform", "name": "Transform", "count": 8 }
  ]
}
```

### Artifact Endpoints

```typescript
// GET /artifacts/:runId/:actionId/:filename
// Download artifact
Response: Binary file or JSON

// GET /artifacts/:runId
// List all artifacts for a run
Response: {
  "artifacts": [
    {
      "actionId": "action-2",
      "name": "subdomains.json",
      "url": "/api/artifacts/run-789/action-2/subdomains.json",
      "size": 1024,
      "contentType": "application/json",
      "createdAt": "2024-10-05T14:05:00Z"
    }
  ]
}
```

---

## Deployment Strategy

### Development Setup

```mermaid
graph LR
    subgraph "Local Machine"
        FE[Frontend<br/>localhost:5173<br/>Vite dev server]
        API[Backend API<br/>localhost:3000<br/>bun run dev]
        WORKER[Worker<br/>bun run worker:dev]
    end
    
    subgraph "Docker Compose"
        TEMP[Temporal Server<br/>localhost:7233]
        PG[(PostgreSQL<br/>localhost:5432)]
        MINIO[MinIO<br/>localhost:9000]
        TUI[Temporal UI<br/>localhost:8080]
    end
    
    FE --> API
    API --> TEMP
    WORKER --> TEMP
    TEMP --> PG
    API --> MINIO
    WORKER --> MINIO
    
    style FE fill:#9B59B6,color:#fff
    style API fill:#3498DB,color:#fff
    style WORKER fill:#27AE60,color:#fff
```

**Commands:**
```bash
# Start infrastructure
docker-compose up -d

# Start API
cd backend && bun run dev

# Start worker
bun run worker:dev

# Start frontend
cd frontend && bun run dev
```

### Production Deployment (Docker Compose)

**docker-compose.prod.yml:**
```yaml
version: '3.8'

services:
  postgresql:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_USER: postgres
      POSTGRES_DB: temporal
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always

  temporal:
    image: temporalio/auto-setup:1.24.2
    depends_on:
      - postgresql
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=postgres
      - POSTGRES_PWD=${DB_PASSWORD}
      - POSTGRES_SEEDS=postgresql
    restart: always

  temporal-ui:
    image: temporalio/ui:2.26.2
    depends_on:
      - temporal
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
    ports:
      - "8080:8080"
    restart: always

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: bun run start
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@postgresql:5432/shipsec
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - S3_SECRET_KEY=${MINIO_SECRET_KEY}
    ports:
      - "3000:3000"
    depends_on:
      - temporal
      - postgresql
      - minio
    restart: always

  worker-general:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: bun run worker:general
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - S3_SECRET_KEY=${MINIO_SECRET_KEY}
    depends_on:
      - temporal
      - minio
    deploy:
      replicas: 3
    restart: always

  worker-docker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: bun run worker:docker
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - S3_ENDPOINT=http://minio:9000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - temporal
      - minio
    deploy:
      replicas: 2
    restart: always

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    restart: always

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - api
    restart: always

volumes:
  postgres_data:
  minio_data:
```

**Dockerfile (Backend):**
```dockerfile
FROM oven/bun:1.1.4

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build (if using TypeScript compilation)
RUN bun run build

# Expose API port
EXPOSE 3000

# Default command (can be overridden)
CMD ["bun", "run", "start"]
```

**Dockerfile (Frontend):**
```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Production Deployment (Kubernetes)

**k8s/temporal-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal-server
  template:
    metadata:
      labels:
        app: temporal-server
    spec:
      containers:
      - name: temporal
        image: temporalio/auto-setup:1.24.2
        env:
        - name: DB
          value: postgresql
        - name: POSTGRES_SEEDS
          value: postgresql
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: POSTGRES_PWD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        ports:
        - containerPort: 7233
---
apiVersion: v1
kind: Service
metadata:
  name: temporal-server
spec:
  selector:
    app: temporal-server
  ports:
  - port: 7233
    targetPort: 7233
```

**k8s/api-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipsec-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shipsec-api
  template:
    metadata:
      labels:
        app: shipsec-api
    spec:
      containers:
      - name: api
        image: shipsec/backend:latest
        command: ["bun", "run", "start"]
        env:
        - name: TEMPORAL_ADDRESS
          value: temporal-server:7233
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: connection-string
        ports:
        - containerPort: 3000
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: shipsec-api
spec:
  type: LoadBalancer
  selector:
    app: shipsec-api
  ports:
  - port: 80
    targetPort: 3000
```

**k8s/worker-docker-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipsec-worker-docker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shipsec-worker-docker
  template:
    metadata:
      labels:
        app: shipsec-worker-docker
    spec:
      containers:
      - name: worker
        image: shipsec/backend:latest
        command: ["bun", "run", "worker:docker"]
        env:
        - name: TEMPORAL_ADDRESS
          value: temporal-server:7233
        - name: S3_ENDPOINT
          value: http://minio:9000
        volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
        resources:
          requests:
            cpu: 1000m
            memory: 2Gi
          limits:
            cpu: 2000m
            memory: 4Gi
      volumes:
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
```

**k8s/worker-general-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipsec-worker-general
spec:
  replicas: 5
  selector:
    matchLabels:
      app: shipsec-worker-general
  template:
    metadata:
      labels:
        app: shipsec-worker-general
    spec:
      containers:
      - name: worker
        image: shipsec/backend:latest
        command: ["bun", "run", "worker:general"]
        env:
        - name: TEMPORAL_ADDRESS
          value: temporal-server:7233
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: 500m
            memory: 1Gi
```

---

## Data Models

### Database Schema

```sql
-- Workflows table
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  graph JSONB NOT NULL,
  dsl JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Workflow runs table
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id),
  temporal_workflow_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL,
  inputs JSONB,
  outputs JSONB,
  error TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- Execution trace table
CREATE TABLE execution_trace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES workflow_runs(id),
  action_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Artifacts table
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES workflow_runs(id),
  action_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  size BIGINT,
  content_type VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_workflows_created_by ON workflows(created_by);
CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_execution_trace_run_id ON execution_trace(run_id);
CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
```

---

## Security Considerations

### Authentication & Authorization

```typescript
// backend/src/auth/auth.guard.ts

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    
    if (!token) {
      return false;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request['user'] = payload;
      return true;
    } catch {
      return false;
    }
  }

  private extractToken(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

### Secrets Management

```typescript
// backend/src/secrets/secrets.service.ts

import { Injectable } from '@nestjs/common';

@Injectable()
export class SecretsService {
  private secrets = new Map<string, string>();

  async get(key: string, userId: string): Promise<string | undefined> {
    // In production, use AWS Secrets Manager, HashiCorp Vault, etc.
    const secretKey = `${userId}:${key}`;
    return this.secrets.get(secretKey);
  }

  async set(key: string, value: string, userId: string): Promise<void> {
    const secretKey = `${userId}:${key}`;
    this.secrets.set(secretKey, value);
  }

  async delete(key: string, userId: string): Promise<void> {
    const secretKey = `${userId}:${key}`;
    this.secrets.delete(secretKey);
  }
}
```

### Rate Limiting

```typescript
// backend/src/main.ts

import { NestFactory } from '@nestjs/core';
import { rateLimit } from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Rate limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    })
  );

  await app.listen(3000);
}
```

### Input Validation

```typescript
// All component inputs are validated with Zod

const subfinderInputSchema = z.object({
  domain: z.string()
    .min(1)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid domain format'),
  timeout: z.number()
    .min(1)
    .max(3600)
    .optional(),
});

// Usage
const validatedInputs = subfinderInputSchema.parse(rawInputs);
```

---

## Monitoring & Observability

### Temporal UI

- **URL:** http://localhost:8080 (dev) or https://temporal.yourdomain.com (prod)
- **Features:**
  - View all workflow executions
  - Inspect event history
  - See task queue metrics
  - Query workflow state
  - Cancel/terminate workflows

### Application Logs

```typescript
// backend/src/common/logger.ts

import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class AppLogger implements LoggerService {
  log(message: string, context?: string) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      context,
      timestamp: new Date().toISOString(),
    }));
  }

  error(message: string, trace?: string, context?: string) {
    console.error(JSON.stringify({
      level: 'error',
      message,
      trace,
      context,
      timestamp: new Date().toISOString(),
    }));
  }

  warn(message: string, context?: string) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      context,
      timestamp: new Date().toISOString(),
    }));
  }

  debug(message: string, context?: string) {
    console.debug(JSON.stringify({
      level: 'debug',
      message,
      context,
      timestamp: new Date().toISOString(),
    }));
  }
}
```

### Metrics

```typescript
// backend/src/metrics/metrics.service.ts

import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private counters = new Map<string, number>();

  increment(metric: string, value: number = 1) {
    const current = this.counters.get(metric) || 0;
    this.counters.set(metric, current + value);
  }

  get(metric: string): number {
    return this.counters.get(metric) || 0;
  }

  // Expose Prometheus-compatible endpoint
  getPrometheusMetrics(): string {
    let output = '';
    for (const [key, value] of this.counters.entries()) {
      output += `${key} ${value}\n`;
    }
    return output;
  }
}

// Usage in workflow execution
metricsService.increment('workflows.executed');
metricsService.increment('workflows.failed');
metricsService.increment('components.subfinder.executions');
```

---

## Testing Strategy

### Unit Tests

```typescript
// backend/src/components/__tests__/subfinder.spec.ts

import { describe, it, expect, mock } from 'bun:test';
import { subfinderComponent } from '../subfinder.component';
import { ExecutionContext } from '../types';

describe('Subfinder Component', () => {
  it('should enumerate subdomains', async () => {
    const mockContext: ExecutionContext = {
      runId: 'test-run',
      actionId: 'test-action',
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
      },
      secrets: {
        get: mock(async () => undefined),
      },
      artifacts: {
        store: mock(async () => 's3://test/path'),
      },
    };

    const result = await subfinderComponent.execute(
      { domain: 'example.com', timeout: 60 },
      {},
      mockContext
    );

    expect(result).toHaveProperty('subdomains');
    expect(Array.isArray(result.subdomains)).toBe(true);
  });

  it('should validate input schema', () => {
    const invalidInput = { domain: 'not-a-valid-domain' };
    
    expect(() => {
      subfinderComponent.inputSchema.parse(invalidInput);
    }).toThrow();
  });
});
```

### Integration Tests

```typescript
// backend/src/temporal/__tests__/workflow.integration.spec.ts

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { shipSecWorkflow } from '../workflows/shipsec.workflow';
import * as activities from '../activities';

describe('ShipSec Workflow Integration', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('should execute workflow successfully', async () => {
    const { client } = testEnv;
    
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../workflows/shipsec.workflow'),
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(shipSecWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [{
          workflowDefinition: mockWorkflowDef,
          inputs: { domain: 'example.com' },
          runId: 'test-run',
        }],
      });

      const result = await handle.result();
      
      expect(result.status).toBe('completed');
      expect(result.outputs).toBeDefined();
    });
  });
});
```

### End-to-End Tests

```typescript
// e2e/workflow-execution.spec.ts

import { test, expect } from '@playwright/test';

test('complete workflow execution flow', async ({ page }) => {
  // Login
  await page.goto('http://localhost:5173/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');

  // Create workflow
  await page.goto('http://localhost:5173/workflows/new');
  await page.fill('[name="name"]', 'E2E Test Workflow');
  
  // Drag components
  await page.dragAndDrop('[data-component="subfinder"]', '[data-canvas]');
  await page.dragAndDrop('[data-component="httpx"]', '[data-canvas]');
  
  // Connect nodes
  await page.click('[data-node="1"] [data-handle="output"]');
  await page.click('[data-node="2"] [data-handle="input"]');
  
  // Save workflow
  await page.click('button:has-text("Save")');
  await expect(page.locator('text=Workflow saved')).toBeVisible();
  
  // Execute workflow
  await page.click('button:has-text("Run")');
  await page.fill('[name="domain"]', 'example.com');
  await page.click('button:has-text("Execute")');
  
  // Wait for completion
  await expect(page.locator('text=Completed')).toBeVisible({ timeout: 60000 });
  
  // Verify results
  await expect(page.locator('[data-results]')).toContainText('subdomains');
});
```

---

## Performance Optimization

### Caching Strategy

```typescript
// backend/src/cache/cache.service.ts

import { Injectable } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class CacheService {
  private client: RedisClientType;

  async onModuleInit() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await this.client.connect();
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    await this.client.setEx(key, ttl, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

// Usage: Cache workflow DSL
const cacheKey = `workflow:${workflowId}:dsl`;
const cachedDsl = await cacheService.get(cacheKey);
if (cachedDsl) {
  return cachedDsl;
}
const dsl = await compileWorkflow(workflow);
await cacheService.set(cacheKey, dsl, 3600); // Cache for 1 hour
```

### Database Query Optimization

```typescript
// Use indexes for common queries
CREATE INDEX CONCURRENTLY idx_workflows_status_created_at 
ON workflows(status, created_at DESC);

CREATE INDEX CONCURRENTLY idx_workflow_runs_created_by_started_at 
ON workflow_runs(created_by, started_at DESC);

// Pagination with cursor
async findWorkflows(cursor: string, limit: number = 20) {
  return await db.workflows.findMany({
    where: cursor ? { id: { lt: cursor } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
```

### Worker Scaling

```yaml
# Kubernetes HPA for workers
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: shipsec-worker-docker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: shipsec-worker-docker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

## Troubleshooting Guide

### Common Issues

**1. Worker not picking up tasks**

```bash
# Check worker logs
docker logs shipsec-worker-docker

# Verify task queue name matches
# In workflow: taskQueue: 'shipsec-docker'
# In worker: taskQueue: 'shipsec-docker'

# Check Temporal UI
# http://localhost:8080 → Task Queues
```

**2. Workflow stuck in running state**

```bash
# Check Temporal event history
# UI → Workflows → [WorkflowID] → History

# Common causes:
# - Activity timeout too short
# - Worker crashed/restarted
# - Activity throwing unhandled exception

# Solution: Increase timeout or fix activity code
const activities = proxyActivities({
  startToCloseTimeout: '30m', // Increase this
  retry: {
    maximumAttempts: 3,
  },
});
```

**3. Docker containers not spawning**

```bash
# Check Docker socket access
ls -la /var/run/docker.sock

# Ensure worker has Docker socket mounted
# docker-compose.yml:
volumes:
  - /var/run/docker.sock:/var/run/docker.sock

# Test Docker from worker
docker exec shipsec-worker-docker docker ps
```

**4. Artifacts not uploading to S3/MinIO**

```bash
# Check S3 credentials
echo $S3_ACCESS_KEY
echo $S3_SECRET_KEY

# Test S3 connection
aws s3 --endpoint-url http://localhost:9000 ls

# Check bucket exists
aws s3 --endpoint-url http://localhost:9000 mb s3://shipsec-artifacts
```

---

## Future Enhancements

### Phase 5-8 Roadmap

**Phase 5: Runner Abstractions**
- [ ] Implement inline runner (TypeScript execution)
- [ ] Implement Docker runner (container spawning)
- [ ] Implement K8s runner (Job creation)
- [ ] Add runner selection logic in component registry

**Phase 6: Execution Trace**
- [x] Define trace event types
- [x] Implement in-memory trace collector
- [x] Emit events during execution
- [x] Add GET /runs/:id/trace endpoint
- [ ] Stream trace events via WebSocket
- [ ] Add trace visualization in UI

**Phase 7: Frontend Integration**
- [ ] Create API client SDK
- [ ] Wire save/commit/run endpoints
- [ ] Display execution trace in UI
- [ ] Add artifact download links
- [ ] Real-time status updates (WebSocket)

**Phase 8: Production Readiness**
- [ ] Kubernetes deployment manifests
- [ ] Secrets management (Vault/AWS Secrets Manager)
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Alerting (PagerDuty integration)
- [ ] Backup strategy
- [ ] Disaster recovery plan

### Advanced Features

**Marketplace**
- [ ] Component publishing workflow
- [ ] Versioning and dependency management
- [ ] Community ratings and reviews
- [ ] Private component repositories

**Collaboration**
- [ ] Team workspaces
- [ ] Workflow sharing
- [ ] Role-based access control
- [ ] Approval workflows

**AI/ML Integration**
- [ ] AI-assisted workflow building
- [ ] Anomaly detection in findings
- [ ] Auto-remediation suggestions
- [ ] Natural language workflow creation

---

## Summary

### What We Built

ShipSec Studio is a **visual workflow automation platform** for security reconnaissance that combines:

1. **ReactFlow** for intuitive drag-and-drop workflow building
2. **NestJS + Hono** for robust, scalable backend API
3. **Temporal** for reliable, durable workflow orchestration
4. **Component Registry** for extensible tool ecosystem
5. **Specialized Workers** for optimized resource allocation

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Temporal over Airflow** | Event-driven, real-time execution; long-running workflows; automatic retries |
| **NestJS over Express** | Modular architecture; dependency injection; scalability |
| **Bun over Node.js** | 3x faster; built-in TypeScript; modern tooling |
| **Task Queue Routing** | Specialized workers; cost optimization; horizontal scaling |
| **Component-based Design** | Extensibility; marketplace; community contributions |

### Data Flow Summary

```
User Action (ReactFlow) 
  → DAG JSON 
  → DSL Compilation 
  → Temporal Workflow Start 
  → Worker Polls Queue 
  → Component Execution 
  → Artifacts Stored 
  → Results Returned 
  → UI Updated
```

### Getting Started Checklist

- [ ] Clone repository
- [ ] Run `docker-compose up -d` (infrastructure)
- [ ] Run `bun install` (dependencies)
- [ ] Run `bun run dev` (API)
- [ ] Run `bun run worker:dev` (worker)
- [ ] Open http://localhost:3000 (API)
- [ ] Open http://localhost:8080 (Temporal UI)
- [ ] Test with: `curl -X POST http://localhost:3000/workflows/wf-123/run`

### Next Steps for Your AI Agent

This document provides complete context for implementing ShipSec Studio. Your AI agent should:

1. **Phase 4:** Implement Temporal integration (workflows, activities, workers)
2. **Phase 5:** Add runner abstractions (inline, Docker, K8s)
3. **Phase 6:** Implement execution tracing
4. **Phase 7:** Connect frontend to backend APIs
5. **Phase 8:** Production deployment and monitoring

All code examples, architecture diagrams, and API specifications are included above. Good luck building ShipSec Studio! 🚀

---

## Appendix: Quick Reference

### Environment Variables

```bash
# Temporal
TEMPORAL_ADDRESS=localhost:7233

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shipsec

# S3/MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=shipsec-artifacts

# Auth
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# App
NODE_ENV=development
PORT=3000
```

### Useful Commands

```bash
# Development
bun run dev              # Start API
bun run worker:dev       # Start worker
bun run test             # Run tests

# Docker
docker-compose up -d     # Start infrastructure
docker-compose down      # Stop infrastructure
docker-compose logs -f   # View logs

# Database
bun run db:migrate       # Run migrations
bun run db:seed          # Seed database

# Deployment
bun run build            # Build for production
bun run start            # Start production server
```

### Temporal CLI Commands

```bash
# Start workflow
temporal workflow start \
  --task-queue shipsec-dev \
  --type shipSecWorkflow \
  --input '{"workflowDefinition": {...}, "inputs": {...}}'

# Query workflow
temporal workflow describe --workflow-id shipsec-run-123

# Cancel workflow
temporal workflow cancel --workflow-id shipsec-run-123

# List workflows
temporal workflow list

# Show task queue
temporal task-queue describe --task-queue shipsec-docker
```