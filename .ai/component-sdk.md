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
    // Build the full CLI invocation in TypeScript; pass flags/args here
    command: string[];
    // Optional container overrides
    entrypoint?: string;
    env?: Record<string, string>;
    network?: 'none' | 'bridge' | 'host';
    timeoutSeconds?: number;
    // When true, the runner writes the JSON-encoded params to stdin
    // Use only for tools that read from stdin; prefer args otherwise
    stdinJson?: boolean;
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

### Docker Component Pattern (TS-first)
- Build the entire CLI command in TypeScript and pass it via `runner.docker.command`.
  - Prefer direct flags/args over shell wrappers. Only use a minimal shell when absolutely necessary (e.g., creating a temp file for tools that require `-L file`).
  - Set `stdinJson: true` only for tools that read JSON from stdin; otherwise keep it unset so no stdin is written.
- Perform all parsing/normalisation in the component's TypeScript `execute` function:
  - Parse NDJSON or text output, validate each record with Zod, and normalise into the shared output schema.
  - Derive metadata (counts, record types, resolver lists) in TypeScript so helpers and unit tests are reusable.
- Error handling: catch runner errors (non-zero exit, stderr) in TypeScript, wrap them in a friendly message, and propagate through the component's `errors` array or thrown error as appropriate.
- Example shape (illustrative):
```ts
const args = [
  '-json', '-resp', '-silent',
  ...mapRecordTypesToFlags(input.recordTypes),
  '-rl', input.rateLimit?.toString() ?? '0',
  ...input.resolvers.flatMap(r => ['-r', r]),
  ...input.domains.flatMap(d => ['-d', d]),
];

const runner = {
  kind: 'docker' as const,
  image: 'projectdiscovery/dnsx:latest',
  command: args,
  network: 'bridge' as const,
};
```
Note: if a tool strictly requires a file input (e.g., `-list file.txt`), use a minimal shell to write the temp file and then invoke the tool; keep all flag derivation in TypeScript.

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
