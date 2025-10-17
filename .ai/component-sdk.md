# ShipSec Component SDK & Runner Architecture

## Component Definition Interface
```ts
interface ComponentDefinition<I, O> {
  id: string;
  label: string;
  category: 'trigger' | 'input' | 'discovery' | 'transform' | 'output';
  runner: RunnerConfig;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  defaults?: Partial<I>;
  docs?: string;
  execute(params: I, context: ExecutionContext): Promise<O>;
}

interface RunnerConfig {
  kind: 'inline' | 'docker' | 'remote';
  docker?: {
    image: string;
    command: string[];
    env?: Record<string, string>;
    mounts?: Array<{ hostPath: string; containerPath: string; mode?: 'ro' | 'rw' }>;
    timeoutSeconds?: number;
    cpu?: number;
    memoryMb?: number;
  };
  inline?: { concurrency?: number };
  remote?: { endpoint: string; authSecretName?: string };
}

interface ExecutionContext {
  runId: string;
  componentRef: string;
  logger: Logger;
  secrets: SecretAccessor;
  artifacts: ArtifactStore;
  workspace: WorkspaceMetadata;
  emitProgress(event: ProgressEvent): void;
}
```

## ShipSec SDK Responsibilities
1. Component registration (`registerComponent(def)` → stored in registry).
2. Shared utilities for schema validation, template evaluation.
3. Runner abstraction: map RunnerConfig → execution strategy (inline, Docker, remote executor).
4. Temporal integration: auto-register one activity per component ID.
5. Lifecycle hooks: logging, progress events, artifact management.

## Temporal Orchestration
- Workflow stores the DSL and schedules activities by component ID.
- `ShipSecWorkflow.run()` topologically sorts actions, resolves params, and calls `workflow.executeActivity(component.id, …)`.
- Activities delegate to SDK’s `invoke()` which:
  - Validates params via `inputSchema`.
  - Runs the component (calls inline code, spawns Docker, or hits remote executor).
  - Streams logs, emits progress, stores artifacts.
  - Validates outputs with `outputSchema` before returning to the workflow.

## Runner Layer
- Initial runners: inline (TypeScript) and Docker (with configurable resources).
- Future runners: Kubernetes jobs, ECS tasks, Firecracker, serverless functions.
- ExecutionContext provides consistent access to secrets/artifacts irrespective of runner.

## Sample Flow: File Loader → Subfinder → Webhook
1. **FileLoader** (`core.file.loader`)
   - Runner: inline.
   - Reads file by path / upload ID, returns `{ fileName, mimeType, content }`.
2. **SubfinderRunner** (`shipsec.subfinder.run`)
   - Runner: Docker image `shipsec/subfinder`.
   - Inputs: domain, optional wordlist from FileLoader’s output.
   - Outputs: `{ subdomains: string[], rawOutput: string, stats: … }`.
3. **WebhookUploader** (`core.webhook.post`)
   - Runner: inline (HTTP POST).
   - Sends subfinder results to a target URL, returns status.

The workflow DSL references these by component ID; Temporal executes them sequentially with retries, progress tracking, and trace events.
