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
Note: if a tool strictly requires a file input (e.g., `-list file.txt`), use the IsolatedContainerVolume pattern (see below) for secure, multi-tenant file handling in Docker-in-Docker environments.

## File System Access Pattern (Docker Components)

**IMPORTANT:** All Docker components that require file-based input/output **MUST** use the `IsolatedContainerVolume` utility for secure multi-tenant isolation in Docker-in-Docker (DinD) environments.

### Why IsolatedContainerVolume?

❌ **DO NOT use direct file mounts:**
```ts
// WRONG - Breaks in DinD, no tenant isolation
const tempDir = await mkdtemp(path.join(tmpdir(), 'input-'));
await writeFile(path.join(tempDir, 'file.txt'), data);
volumes: [{ source: tempDir, target: '/inputs' }]
```

✅ **DO use IsolatedContainerVolume:**
```ts
// CORRECT - DinD compatible, tenant isolated
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const tenantId = context.tenantId ?? 'default-tenant';
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  await volume.initialize({ 'file.txt': data });
  volumes: [volume.getVolumeConfig('/inputs', true)]
} finally {
  await volume.cleanup();
}
```

### Standard Pattern (REQUIRED for all file-based components)

```typescript
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';

async execute(input, context) {
  // 1. Get tenant ID (context will have this once ExecutionContext is updated)
  const tenantId = (context as any).tenantId ?? 'default-tenant';

  // 2. Create isolated volume instance
  const volume = new IsolatedContainerVolume(tenantId, context.runId);

  try {
    // 3. Prepare input files
    const inputFiles: Record<string, string | Buffer> = {
      'targets.txt': targets.join('\n'),
      'config.json': JSON.stringify(config),
      // Binary files work too
      'wordlist.bin': binaryBuffer
    };

    // 4. Initialize volume with files
    await volume.initialize(inputFiles);
    context.logger.info(`Created isolated volume: ${volume.getVolumeName()}`);

    // 5. Configure runner with volume mount
    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: 'tool:latest',
      command: buildCommandArgs(input),
      volumes: [
        // Input files (read-only for security)
        volume.getVolumeConfig('/inputs', true),
        // Output files (read-write if tool writes outputs)
        volume.getVolumeConfig('/outputs', false)
      ]
    };

    // 6. Run the component
    const result = await runComponentWithRunner(runnerConfig, async () => ({} as Output), input, context);

    // 7. Read output files if tool writes them
    const outputs = await volume.readFiles(['results.json', 'summary.txt']);
    const parsedResults = JSON.parse(outputs['results.json'] || '{}');

    return { ...result, additionalData: parsedResults };

  } finally {
    // 8. ALWAYS cleanup volume (even on error)
    await volume.cleanup();
    context.logger.info('Cleaned up isolated volume');
  }
}
```

### Pattern Variations

#### Input Files Only
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);
try {
  await volume.initialize({ 'domains.txt': domains.join('\n') });

  const config = {
    command: ['-l', '/inputs/domains.txt', ...otherFlags],
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  return await runComponentWithRunner(config, ...);
} finally {
  await volume.cleanup();
}
```

#### Input + Output Files
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);
try {
  // Write inputs
  await volume.initialize({ 'config.yaml': yamlConfig });

  const config = {
    command: [
      '--input', '/data/config.yaml',
      '--output', '/data/results.json'
    ],
    volumes: [volume.getVolumeConfig('/data', false)] // Read-write
  };

  await runComponentWithRunner(config, ...);

  // Read outputs
  const outputs = await volume.readFiles(['results.json']);
  return JSON.parse(outputs['results.json']);
} finally {
  await volume.cleanup();
}
```

#### Multiple Volumes (Separate Input/Output)
```typescript
const inputVol = new IsolatedContainerVolume(tenantId, `${context.runId}-in`);
const outputVol = new IsolatedContainerVolume(tenantId, `${context.runId}-out`);

try {
  await inputVol.initialize({ 'data.csv': csvData });
  await outputVol.initialize({}); // Empty volume for outputs

  const config = {
    volumes: [
      inputVol.getVolumeConfig('/inputs', true),
      outputVol.getVolumeConfig('/outputs', false)
    ]
  };

  await runComponentWithRunner(config, ...);

  const results = await outputVol.readFiles(['output.json']);
  return JSON.parse(results['output.json']);
} finally {
  await Promise.all([inputVol.cleanup(), outputVol.cleanup()]);
}
```

### Security Guarantees

Using `IsolatedContainerVolume` ensures:
- ✅ **Tenant Isolation** - Volume name includes tenant ID: `tenant-{tenantId}-run-{runId}-{timestamp}`
- ✅ **No Collisions** - Timestamp prevents concurrent execution conflicts
- ✅ **Path Safety** - Filenames validated (no `..` or `/` prefix)
- ✅ **Automatic Cleanup** - Guaranteed cleanup via finally blocks
- ✅ **Audit Trail** - Volumes labeled with `studio.managed=true`
- ✅ **DinD Compatible** - Named volumes work where file mounts fail

### When to Use

| Scenario | Use IsolatedVolume? |
|----------|---------------------|
| Tool requires file input (e.g., `-l file.txt`) | ✅ Yes |
| Tool writes output files | ✅ Yes |
| Tool reads binary files (wordlists, images) | ✅ Yes |
| Tool reads config files (.yaml, .json) | ✅ Yes |
| Tool only uses CLI args/flags | ❌ No |
| Tool reads from stdin only | ❌ No |

### Reference Documentation

- **API Reference**: `worker/src/utils/README.md`
- **Architecture Guide**: `docs/ISOLATED_VOLUMES.md`
- **Migration Tracking**: `worker/src/utils/COMPONENTS_TO_MIGRATE.md`

### Examples in Codebase

- **dnsx**: `worker/src/components/security/dnsx.ts:615-662` - Input files only
- **More examples coming** as other components migrate

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
