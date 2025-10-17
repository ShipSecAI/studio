# ShipSec Studio: Specialized Workers Implementation Guide

## 🎯 Quick Answer to Your Questions

### Q1: Does the whole workflow run in a single worker?
**Answer**: **NO** - The workflow code itself runs on one worker, but activities can run on different workers!

```
Workflow Execution:
  ┌─────────────────────┐
  │  Worker 1 (default) │  ← Workflow orchestration logic
  │  - Start workflow   │
  │  - Call activity A  │ ────────┐
  │  - Call activity B  │ ────┐   │
  │  - Return result    │     │   │
  └─────────────────────┘     │   │
                              │   │
                              ▼   ▼
              ┌──────────────────────────────┐
              │  Worker 2 (security-tools)   │  ← Heavy activities
              │  - Executes activity A       │
              └──────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │  Worker 3 (file-ops)         │  ← I/O activities
              │  - Executes activity B       │
              └──────────────────────────────┘
```

### Q2: How do we divide activities per worker?
**Answer**: Using **task queues** - you specify which queue an activity should run on!

```typescript
// In your workflow
const securityActivities = proxyActivities({
  taskQueue: 'security-tools',  // ← Routes to security worker
});

const fileActivities = proxyActivities({
  taskQueue: 'file-ops',  // ← Routes to file ops worker
});
```

---

## 🏗️ Current ShipSec Architecture

### What We Have Now

```
┌────────────────────────────────────────────┐
│          Temporal Server                    │
│                                             │
│  Task Queue: shipsec-default               │
│  ┌────────────────────────────┐           │
│  │ • Workflow tasks            │           │
│  │ • runWorkflow activity      │           │
│  └────────────────────────────┘           │
└────────────────────────────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │  Single Worker      │
        │  (tsx dev.worker)   │
        │                     │
        │  • All workflows    │
        │  • All activities   │
        │  • 1 process        │
        └─────────────────────┘
```

**Pros:**
- ✅ Simple
- ✅ Easy to debug
- ✅ Works great for development

**Cons:**
- ❌ No resource isolation
- ❌ Heavy component blocks light ones
- ❌ Can't scale independently

---

## 🚀 Recommended Production Architecture

### Multi-Worker Setup for ShipSec

```
                    Temporal Server
                          │
          ┌───────────────┼───────────────┬──────────────┐
          │               │               │              │
          ▼               ▼               ▼              ▼
   ┌────────────┐  ┌────────────┐  ┌───────────┐  ┌──────────┐
   │  Worker 1  │  │  Worker 2  │  │  Worker 3 │  │ Worker 4 │
   │  Default   │  │  Security  │  │  File Ops │  │  Notify  │
   └────────────┘  └────────────┘  └───────────┘  └──────────┘
        │                │               │              │
        ▼                ▼               ▼              ▼
   Workflows      Subfinder         MinIO          Webhooks
   Light tasks    Nmap              S3             Email
   Validation     Nuclei            Storage        Slack
```

### Task Queue Mapping

| Worker | Task Queue | Components | Use Case |
|--------|------------|------------|----------|
| **Default** | `shipsec-default` | Workflows, Trigger, Validation | Orchestration |
| **Security** | `shipsec-security` | Subfinder, Nmap, Nuclei | Heavy scanning |
| **File Ops** | `shipsec-files` | FileLoader, S3, MinIO | I/O operations |
| **Notifications** | `shipsec-notify` | Webhooks, Email, Slack | External APIs |

---

## 💻 Implementation Steps

### Step 1: Update Component Registry with Task Queues

```typescript
// backend/src/components/registry.ts

export interface ComponentMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  taskQueue?: string;  // ← Add this
  // ... other fields
}

// Define task queues
export const TASK_QUEUES = {
  DEFAULT: 'shipsec-default',
  SECURITY: 'shipsec-security',
  FILES: 'shipsec-files',
  NOTIFY: 'shipsec-notify',
} as const;

// Register components with task queues
componentRegistry.register({
  id: 'core.subfinder',
  name: 'Subfinder',
  taskQueue: TASK_QUEUES.SECURITY,  // ← Heavy security tool
  category: 'security',
  runner: 'docker',
  // ...
});

componentRegistry.register({
  id: 'core.file.loader',
  name: 'File Loader',
  taskQueue: TASK_QUEUES.FILES,  // ← I/O bound
  category: 'input-output',
  runner: 'inline',
  // ...
});
```

### Step 2: Update Workflow to Use Task Queues

```typescript
// backend/src/temporal/workflows/run-workflow.workflow.ts
import { proxyActivities, log } from '@temporalio/workflow';
import type { RunWorkflowActivityInput, RunWorkflowActivityOutput } from '../types';

// Create multiple activity proxies for different queues
const defaultActivities = proxyActivities<{
  runWorkflow(input: RunWorkflowActivityInput): Promise<RunWorkflowActivityOutput>;
}>({
  taskQueue: 'shipsec-default',
  startToCloseTimeout: '10 minutes',
});

const securityActivities = proxyActivities<{
  runWorkflow(input: RunWorkflowActivityInput): Promise<RunWorkflowActivityOutput>;
}>({
  taskQueue: 'shipsec-security',
  startToCloseTimeout: '1 hour',  // Longer for security scans
  retry: {
    maximumAttempts: 3,
  },
});

const fileActivities = proxyActivities<{
  runWorkflow(input: RunWorkflowActivityInput): Promise<RunWorkflowActivityOutput>;
}>({
  taskQueue: 'shipsec-files',
  startToCloseTimeout: '30 minutes',
});

export async function shipsecWorkflowRun(input: RunWorkflowActivityInput) {
  log.info('🚀 Workflow started', { runId: input.runId });
  
  // Determine which activity proxy to use based on component
  const componentType = detectComponentType(input.definition);
  
  let activities;
  if (componentType === 'security') {
    activities = securityActivities;
  } else if (componentType === 'file') {
    activities = fileActivities;
  } else {
    activities = defaultActivities;
  }
  
  const result = await activities.runWorkflow(input);
  log.info('✅ Workflow completed');
  return result;
}

function detectComponentType(definition: any): string {
  // Check which components are used in the workflow
  const componentIds = definition.actions.map(a => a.componentId);
  
  if (componentIds.some(id => id.includes('subfinder') || id.includes('nmap'))) {
    return 'security';
  }
  if (componentIds.some(id => id.includes('file') || id.includes('s3'))) {
    return 'file';
  }
  return 'default';
}
```

### Step 3: Create Specialized Workers

#### Security Tools Worker

```typescript
// backend/src/temporal/workers/security.worker.ts
import { Worker, NativeConnection } from '@temporalio/worker';
import { runWorkflowActivity } from '../activities/run-workflow.activity';

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
  
  console.log(`🔒 Connecting to Temporal at ${address}...`);
  const connection = await NativeConnection.connect({ address });
  console.log(`✅ Connected to Temporal`);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: 'shipsec-security',  // ← Specialized queue
    activities: {
      runWorkflow: runWorkflowActivity,
    },
    maxConcurrentActivityTaskExecutions: 3,  // Limit heavy tasks
  });

  console.log(`🔒 Security worker ready (queue=shipsec-security)`);
  console.log(`📡 Polling for security tool tasks...`);
  
  await worker.run();
}

main().catch((error) => {
  console.error('Security worker failed', error);
  process.exit(1);
});
```

#### File Operations Worker

```typescript
// backend/src/temporal/workers/file-ops.worker.ts
import { Worker, NativeConnection } from '@temporalio/worker';
import { runWorkflowActivity } from '../activities/run-workflow.activity';

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
  
  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: 'shipsec-files',  // ← File operations queue
    activities: {
      runWorkflow: runWorkflowActivity,
    },
    maxConcurrentActivityTaskExecutions: 10,  // Higher for I/O
  });

  console.log(`📁 File ops worker ready (queue=shipsec-files)`);
  await worker.run();
}

main().catch((error) => {
  console.error('File ops worker failed', error);
  process.exit(1);
});
```

### Step 4: Update PM2 Configuration

```javascript
// pm2.config.cjs
module.exports = {
  apps: [
    {
      name: 'shipsec-backend',
      cwd: './backend',
      script: 'bun',
      args: 'run src/main.ts',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
    },
    {
      name: 'worker-default',
      cwd: './backend',
      script: 'tsx',
      args: 'src/temporal/workers/dev.worker.ts',
      env: {
        TEMPORAL_TASK_QUEUE: 'shipsec-default',
      },
    },
    {
      name: 'worker-security',
      cwd: './backend',
      script: 'tsx',
      args: 'src/temporal/workers/security.worker.ts',
      env: {
        TEMPORAL_TASK_QUEUE: 'shipsec-security',
      },
    },
    {
      name: 'worker-files',
      cwd: './backend',
      script: 'tsx',
      args: 'src/temporal/workers/file-ops.worker.ts',
      env: {
        TEMPORAL_TASK_QUEUE: 'shipsec-files',
      },
    },
  ],
};
```

### Step 5: Update Package.json Scripts

```json
{
  "scripts": {
    "worker:dev": "tsx src/temporal/workers/dev.worker.ts",
    "worker:security": "tsx src/temporal/workers/security.worker.ts",
    "worker:files": "tsx src/temporal/workers/file-ops.worker.ts",
    "workers:all": "concurrently \"npm:worker:dev\" \"npm:worker:security\" \"npm:worker:files\""
  }
}
```

---

## 🎮 How to Use

### Development (Current - Simple)
```bash
# Single worker for everything
npm run worker:dev
```

### Production (Multi-Worker)
```bash
# Start all workers
pm2 start pm2.config.cjs

# Or individually
npm run worker:dev       # Default queue
npm run worker:security  # Security tools
npm run worker:files     # File operations
```

### Scaling in Production
```bash
# Scale security workers to 3 instances
pm2 scale worker-security 3

# All 3 instances poll the same queue = automatic load balancing!
```

---

## 📊 Real-World Example

### Workflow with Multiple Activities

```typescript
// User creates this workflow in UI:
// [Trigger] → [Subfinder] → [File Save] → [Webhook]

// What happens behind the scenes:

1. Workflow starts on Worker 1 (default queue)
   └─> Executes workflow orchestration logic

2. Subfinder activity scheduled
   └─> Temporal routes to 'shipsec-security' queue
   └─> Worker 2 (security) picks it up
   └─> Executes subfinder scan (30 mins)
   └─> Returns results to workflow

3. File save activity scheduled
   └─> Temporal routes to 'shipsec-files' queue
   └─> Worker 3 (files) picks it up
   └─> Saves to MinIO (2 mins)
   └─> Returns confirmation to workflow

4. Webhook activity scheduled
   └─> Temporal routes to 'shipsec-default' queue
   └─> Worker 1 (default) picks it up
   └─> Sends webhook (5 secs)
   └─> Workflow completes!
```

---

## 🎯 Benefits Summary

### With Specialized Workers

✅ **Resource Isolation**
- Heavy Subfinder scan doesn't block file operations
- Each worker can have different resource limits

✅ **Independent Scaling**
```bash
pm2 scale worker-security 5   # More security scans
pm2 scale worker-files 2       # Fewer file operations
```

✅ **Failure Isolation**
- If security worker crashes, file ops continue
- Temporal automatically retries on another worker

✅ **Optimized Performance**
- Security workers on GPU machines
- File workers on high-IOPS storage
- Default workers on cheap instances

✅ **Better Monitoring**
- Track queue backlogs separately
- Alert on specific worker types
- Optimize each workload independently

---

## 🔍 Monitoring

### Check Worker Status
```bash
# Via PM2
pm2 status

# Via Temporal UI
open http://localhost:8081/namespaces/shipsec-dev/task-queues
```

### Check Queue Backlogs
```typescript
// Via Temporal CLI
temporal task-queue describe \
  --namespace shipsec-dev \
  --task-queue shipsec-security

// Output shows:
// - Active workers: 3
// - Pending tasks: 5
// - Task backlog: true/false
```

---

## 💡 Best Practices

### 1. Start Simple
- ✅ Begin with single worker (current setup)
- ✅ Add specialized workers as bottlenecks appear
- ✅ Monitor queue metrics to identify needs

### 2. Queue Naming Convention
```
<project>-<purpose>
shipsec-default
shipsec-security
shipsec-files
shipsec-notify
```

### 3. Set Appropriate Timeouts
```typescript
// Quick activities
taskQueue: 'shipsec-default',
startToCloseTimeout: '5 minutes'

// Heavy activities
taskQueue: 'shipsec-security',
startToCloseTimeout: '1 hour'
```

### 4. Limit Concurrency
```typescript
maxConcurrentActivityTaskExecutions: 3,  // For CPU-heavy
maxConcurrentActivityTaskExecutions: 20, // For I/O-bound
```

---

## 🎓 Summary

### Your Questions Answered

**Q: Does the whole workflow run in a single worker?**
- Workflow logic: Yes, one worker
- Activities: No, can run on different workers via task queues

**Q: How do we divide activities per worker?**
- Use `taskQueue` parameter in `proxyActivities()`
- Each worker polls specific task queues
- Temporal routes activities automatically

**Q: Can we have specialized workers?**
- Yes! Create multiple workers with different task queues
- Scale them independently
- Optimize resources per workload type

### Current State
✅ Single worker (`shipsec-default`)
✅ Works great for development
✅ Ready to scale when needed

### Next Steps (When Ready)
1. Identify slow/heavy activities
2. Create specialized workers
3. Update workflows to use task queues
4. Monitor and scale independently


