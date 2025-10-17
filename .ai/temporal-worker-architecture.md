# Temporal Worker Architecture Explained

## 🏗️ How Temporal Workers Work

### Basic Concepts

**Workflow vs Activity Execution:**
- **Workflows** = Orchestration logic (deterministic, event-sourced)
- **Activities** = Actual work (non-deterministic, can fail/retry)

### Single Workflow Execution

```
┌─────────────────────────────────────────────────┐
│  Temporal Server                                 │
│  ┌───────────────┐        ┌──────────────────┐ │
│  │ Workflow Task │───────▶│  Activity Tasks  │ │
│  │    Queue      │        │      Queue       │ │
│  └───────────────┘        └──────────────────┘ │
└─────────────────────────────────────────────────┘
           │                         │
           │                         │
           ▼                         ▼
    ┌──────────────┐         ┌──────────────┐
    │   Worker 1   │         │   Worker 2   │
    │              │         │              │
    │ • Workflows  │         │ • Activities │
    │ • Activities │         │   (heavy)    │
    └──────────────┘         └──────────────┘
```

---

## 🎯 Current ShipSec Studio Setup

### Single Worker (Current State)

```typescript
// backend/src/temporal/workers/dev.worker.ts
const worker = await Worker.create({
  connection,
  namespace: 'shipsec-dev',
  taskQueue: 'shipsec-default',      // ← Single task queue
  workflowsPath,
  activities: {
    runWorkflow: runWorkflowActivity,  // ← All activities here
  },
});
```

**What happens:**
1. Worker polls `shipsec-default` task queue
2. Executes **both** workflows AND activities
3. Everything runs on the same worker process

---

## 🔀 Specialized Workers Architecture

### Multi-Worker Setup

```
                    Temporal Server
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Worker 1 │    │ Worker 2 │    │ Worker 3 │
  │          │    │          │    │          │
  │ Queue:   │    │ Queue:   │    │ Queue:   │
  │ default  │    │ security │    │ file-ops │
  │          │    │          │    │          │
  │ • Wrkflw │    │ • Nmap   │    │ • S3     │
  │ • Basic  │    │ • Subfin │    │ • MinIO  │
  └──────────┘    └──────────┘    └──────────┘
```

### Why Multiple Workers?

1. **Resource Isolation**: Heavy security scans don't block file operations
2. **Scaling**: Scale security workers independently
3. **Specialization**: Different machines for different tasks
4. **Failure Isolation**: One worker crash doesn't affect others

---

## 💡 How It Works in Practice

### Example: Security Scan Workflow

```typescript
// Workflow code (runs on default queue)
export async function securityScanWorkflow(input: ScanInput) {
  log.info('Starting security scan workflow');
  
  // This activity runs on 'security-tools' queue
  const subdomains = await securityActivities.subfinder({
    domain: input.domain,
  });
  
  // This activity runs on 'file-ops' queue
  await fileActivities.saveResults({
    data: subdomains,
    path: 's3://bucket/results.json',
  });
  
  return { subdomains };
}
```

### Activity Registration with Task Queues

```typescript
// Activities with task queue routing
const securityActivities = proxyActivities<SecurityActivities>({
  taskQueue: 'security-tools',  // ← Specific queue
  startToCloseTimeout: '30 minutes',
});

const fileActivities = proxyActivities<FileActivities>({
  taskQueue: 'file-ops',  // ← Different queue
  startToCloseTimeout: '5 minutes',
});
```

---

## 🛠️ Implementing Specialized Workers in ShipSec

### Step 1: Create Specialized Worker

```typescript
// backend/src/temporal/workers/security.worker.ts
import { Worker, NativeConnection } from '@temporalio/worker';
import { nmapScanActivity } from '../activities/nmap-scan.activity';
import { subfinderActivity } from '../activities/subfinder.activity';

async function main() {
  const connection = await NativeConnection.connect({
    address: 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: 'shipsec-dev',
    taskQueue: 'security-tools',  // ← Specialized queue
    activities: {
      // Only security-related activities
      nmapScan: nmapScanActivity,
      subfinder: subfinderActivity,
    },
    // No workflowsPath - only runs activities
  });

  console.log('🔒 Security worker running...');
  await worker.run();
}

main().catch(console.error);
```

### Step 2: Update Workflow to Use Specialized Queue

```typescript
// backend/src/temporal/workflows/security-scan.workflow.ts
import { proxyActivities } from '@temporalio/workflow';

// Activities on specialized queue
const securityActivities = proxyActivities<{
  subfinder(input: SubfinderInput): Promise<SubfinderOutput>;
  nmapScan(input: NmapInput): Promise<NmapOutput>;
}>({
  taskQueue: 'security-tools',  // ← Routes to specialized worker
  startToCloseTimeout: '30 minutes',
});

export async function securityScanWorkflow(input: ScanInput) {
  // This will be executed by the security-tools worker
  const subdomains = await securityActivities.subfinder({
    domain: input.domain,
  });
  
  const portScans = await Promise.all(
    subdomains.map(subdomain =>
      securityActivities.nmapScan({ target: subdomain })
    )
  );
  
  return { subdomains, portScans };
}
```

### Step 3: Run Multiple Workers

```javascript
// pm2.config.cjs
module.exports = {
  apps: [
    {
      name: 'shipsec-backend',
      cwd: './backend',
      script: 'bun',
      args: 'run src/main.ts',
    },
    {
      name: 'shipsec-worker-default',
      cwd: './backend',
      script: 'npm',
      args: 'run worker:dev',
    },
    {
      name: 'shipsec-worker-security',  // ← New specialized worker
      cwd: './backend',
      script: 'tsx',
      args: 'src/temporal/workers/security.worker.ts',
    },
    {
      name: 'shipsec-worker-file-ops',  // ← Another specialized worker
      cwd: './backend',
      script: 'tsx',
      args: 'src/temporal/workers/file-ops.worker.ts',
    },
  ],
};
```

---

## 🎭 Task Queue Routing

### How Activities Find Workers

```
Workflow (on default queue):
  └─> Calls activity with taskQueue='security-tools'
       └─> Temporal Server queues task on 'security-tools'
            └─> Security Worker polls 'security-tools'
                 └─> Executes activity
                      └─> Returns result to workflow
```

### Multiple Workers, Same Queue

```
                Temporal Server
                      │
              ┌───────┴───────┐
              ▼               ▼
         Worker A         Worker B
         (security)       (security)
              │               │
              └───────┬───────┘
                      ▼
              Load Balanced!
```

**Benefits:**
- Horizontal scaling
- Automatic load balancing
- No configuration needed

---

## 🚀 Real-World ShipSec Example

### Scenario: Subdomain Enumeration Pipeline

```typescript
// Workflow orchestration (lightweight)
export async function subdomainPipelineWorkflow(input: PipelineInput) {
  // 1. Run on security-tools worker (heavy)
  const subdomains = await securityActivities.subfinder({
    domain: input.domain,
    options: input.subfinderOptions,
  });
  
  // 2. Run on file-ops worker (I/O bound)
  const stored = await fileActivities.storeResults({
    data: subdomains,
    bucket: input.outputBucket,
  });
  
  // 3. Run on notification worker (external API)
  await notificationActivities.sendAlert({
    message: `Found ${subdomains.length} subdomains`,
    webhook: input.webhookUrl,
  });
  
  return { count: subdomains.length, stored };
}
```

### Worker Distribution

| Worker | Task Queue | Activities | Resources |
|--------|------------|------------|-----------|
| **Default** | `shipsec-default` | Workflow execution | CPU: Low, RAM: Low |
| **Security** | `security-tools` | Subfinder, Nmap | CPU: High, RAM: High |
| **File Ops** | `file-ops` | S3, MinIO | CPU: Low, I/O: High |
| **Notifications** | `notifications` | Webhooks, Email | CPU: Low, Network: High |

---

## 🎯 Best Practices

### 1. Default Worker for Workflows
```typescript
// Always have a worker for workflows
const defaultWorker = await Worker.create({
  taskQueue: 'shipsec-default',
  workflowsPath: './workflows',
  activities: {
    // Light activities only
    validateInput,
    logEvent,
  },
});
```

### 2. Specialized Workers for Heavy Activities
```typescript
// Security tools worker
const securityWorker = await Worker.create({
  taskQueue: 'security-tools',
  activities: {
    subfinder,
    nmap,
    nuclei,
  },
  maxConcurrentActivityTaskExecutions: 5,  // Limit concurrency
});
```

### 3. Route Activities by Task Queue
```typescript
// In workflow
const heavyActivities = proxyActivities<HeavyActivities>({
  taskQueue: 'security-tools',  // ← Explicit routing
  startToCloseTimeout: '1 hour',
});

const lightActivities = proxyActivities<LightActivities>({
  // No taskQueue = uses workflow's queue
  startToCloseTimeout: '1 minute',
});
```

---

## 🔍 Monitoring Task Queues

### Check Queue Status

```bash
# Temporal CLI
temporal task-queue describe \
  --namespace shipsec-dev \
  --task-queue security-tools
```

### Via Temporal UI
```
http://localhost:8081/namespaces/shipsec-dev/task-queues
```

You can see:
- Active workers per queue
- Pending tasks
- Task backlog
- Worker health

---

## 📊 Performance Implications

### Single Worker (Current)
```
✅ Simple setup
✅ Easy debugging
❌ Single point of failure
❌ No resource isolation
❌ Limited scaling
```

### Multi-Worker (Recommended)
```
✅ Resource isolation
✅ Horizontal scaling
✅ Failure isolation
✅ Optimized for workload
⚠️  More complex setup
⚠️  More processes to manage
```

---

## 🎓 Summary

### Key Concepts

1. **Workflows run on ANY worker** that polls their task queue
2. **Activities can be routed** to specific workers via `taskQueue` parameter
3. **Multiple workers on same queue** = automatic load balancing
4. **Different queues** = workload isolation and specialization

### Current ShipSec Setup
- ✅ Single worker on `shipsec-default` queue
- ✅ Executes both workflows and activities
- ✅ Good for development and small scale

### Recommended Production Setup
- 🎯 Default worker: Workflows + light activities
- 🎯 Security worker: Heavy security scanning tools
- 🎯 File ops worker: S3/MinIO operations
- 🎯 Notification worker: Webhooks, emails, alerts

### Next Steps
1. Identify heavy activities in your workflows
2. Create specialized workers for resource-intensive tasks
3. Update workflows to route activities via `taskQueue`
4. Monitor queue health in Temporal UI


