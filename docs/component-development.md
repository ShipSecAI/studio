# Component Development Guide

This guide provides best practices and required patterns for developing ShipSec Studio components.

## Table of Contents

- [Component Basics](#component-basics)
- [File System Access (REQUIRED)](#file-system-access-required)
- [Security Requirements](#security-requirements)
- [Testing Checklist](#testing-checklist)
- [Common Patterns](#common-patterns)

---

## Component Basics

See `.ai/component-sdk.md` for the full component interface and architecture.

### Quick Start

```typescript
import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  target: z.string()
});

const outputSchema = z.object({
  result: z.string()
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.tool.scan',
  label: 'Tool Scanner',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    command: [/* build args */],
    network: 'bridge'
  },
  inputSchema,
  outputSchema,
  async execute(input, context) {
    // Implementation
  }
};

componentRegistry.register(definition);
```

---

## File System Access (REQUIRED)

### ⚠️ CRITICAL: Multi-Tenant Security Pattern

**ALL components that require file-based input/output MUST use the `IsolatedContainerVolume` utility.**

This is **mandatory** for:
- ✅ Docker-in-Docker (DinD) compatibility
- ✅ Multi-tenant data isolation
- ✅ Production security compliance

### DO NOT Use File Mounts

```typescript
// ❌ WRONG - Breaks in DinD, no tenant isolation, SECURITY RISK
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';

const tempDir = await mkdtemp(path.join(tmpdir(), 'input-'));
await writeFile(path.join(tempDir, 'file.txt'), data);

const config = {
  volumes: [{ source: tempDir, target: '/inputs' }]  // FAILS in DinD
};
```

**Why this is wrong:**
- Doesn't work in Docker-in-Docker (volume paths don't align)
- No tenant isolation (security vulnerability)
- Manual cleanup prone to leaks
- Not auditable

### DO Use IsolatedContainerVolume

```typescript
// ✅ CORRECT - DinD compatible, tenant isolated, secure
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const tenantId = (context as any).tenantId ?? 'default-tenant';
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  await volume.initialize({
    'input.txt': data,
    'config.json': JSON.stringify(config)
  });

  const runnerConfig = {
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  const result = await runComponentWithRunner(runnerConfig, ...);
  return result;

} finally {
  await volume.cleanup();  // ALWAYS cleanup
}
```

---

## Standard File Access Pattern

Copy-paste this template for any file-based component:

```typescript
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';

async execute(input: Input, context: ExecutionContext): Promise<Output> {
  // 1. Get tenant ID
  const tenantId = (context as any).tenantId ?? 'default-tenant';

  // 2. Create volume
  const volume = new IsolatedContainerVolume(tenantId, context.runId);

  try {
    // 3. Prepare files
    const files: Record<string, string | Buffer> = {
      'targets.txt': input.targets.join('\n')
    };

    // 4. Initialize volume
    await volume.initialize(files);
    context.logger.info(`Created volume: ${volume.getVolumeName()}`);

    // 5. Build command args
    const args = buildCommandArgs(input);

    // 6. Configure runner
    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: 'tool:latest',
      command: args,
      network: 'bridge',
      volumes: [
        volume.getVolumeConfig('/inputs', true)  // read-only
      ]
    };

    // 7. Execute
    const rawOutput = await runComponentWithRunner(
      runnerConfig,
      async () => ({} as Output),
      input,
      context
    );

    // 8. Parse and return
    return parseOutput(rawOutput);

  } finally {
    // 9. ALWAYS cleanup
    await volume.cleanup();
    context.logger.info('Cleaned up volume');
  }
}
```

---

## Pattern Variations

### Input Files Only

Most common pattern - tool reads files, outputs to stdout:

```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  await volume.initialize({
    'domains.txt': domains.join('\n'),
    'config.yaml': yamlConfig
  });

  const config = {
    command: ['-l', '/inputs/domains.txt', '-c', '/inputs/config.yaml'],
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  return await runComponentWithRunner(config, ...);
} finally {
  await volume.cleanup();
}
```

### Input + Output Files

Tool reads and writes files:

```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  // Write inputs
  await volume.initialize({ 'config.json': JSON.stringify(cfg) });

  // Tool writes to same volume
  const config = {
    command: [
      '--config', '/data/config.json',
      '--output', '/data/results.json'
    ],
    volumes: [volume.getVolumeConfig('/data', false)] // read-write
  };

  await runComponentWithRunner(config, ...);

  // Read outputs
  const outputs = await volume.readFiles(['results.json', 'errors.log']);
  return JSON.parse(outputs['results.json']);
} finally {
  await volume.cleanup();
}
```

### Separate Input/Output Volumes

For maximum security or tools requiring separate paths:

```typescript
const inputVol = new IsolatedContainerVolume(tenantId, `${context.runId}-in`);
const outputVol = new IsolatedContainerVolume(tenantId, `${context.runId}-out`);

try {
  await inputVol.initialize({ 'data.csv': csvData });
  await outputVol.initialize({}); // Empty for outputs

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

---

## Security Requirements

### 1. Tenant Isolation (MANDATORY)

Every execution gets a unique volume:
```
tenant-{tenantId}-run-{runId}-{timestamp}
```

Example: `tenant-acme-run-wf-abc123-1732150000`

### 2. Automatic Cleanup (MANDATORY)

```typescript
try {
  await volume.initialize(...);
  // ... use volume ...
} finally {
  await volume.cleanup();  // MUST be in finally
}
```

**Never skip the finally block** - volumes must be cleaned up even on errors.

### 3. Read-Only Mounts (DEFAULT)

```typescript
// Input files should be read-only
volume.getVolumeConfig('/inputs', true)  // ✅ read-only

// Only make writable if tool needs to write
volume.getVolumeConfig('/outputs', false)  // ⚠️ read-write
```

### 4. Path Validation (AUTOMATIC)

The utility automatically validates filenames - don't bypass this:

```typescript
// ✅ OK
await volume.initialize({
  'file.txt': data,
  'subdir/file.txt': data  // Subdirs OK
});

// ❌ Rejected (security)
await volume.initialize({
  '../file.txt': data,     // Path traversal blocked
  '/etc/passwd': data      // Absolute paths blocked
});
```

---

## Security Guarantees

Using `IsolatedContainerVolume` ensures:

| Security Feature | How It Works |
|-----------------|--------------|
| **Tenant Isolation** | Volume name includes tenant ID |
| **No Collisions** | Timestamp prevents conflicts |
| **Path Safety** | Filenames validated (no `..` or `/`) |
| **Automatic Cleanup** | Finally blocks guarantee removal |
| **Audit Trail** | Volumes labeled `studio.managed=true` |
| **DinD Compatible** | Named volumes work in nested Docker |

---

## Testing Checklist

After implementing a file-based component:

### Local Testing
- [ ] Component compiles without TypeScript errors
- [ ] Worker starts successfully
- [ ] Component executes and returns expected output
- [ ] Volume is created with correct naming pattern
- [ ] Files are written to volume successfully
- [ ] Container can read files from volume
- [ ] Volume is cleaned up after successful execution
- [ ] Volume is cleaned up on error/exception
- [ ] Logs show volume creation message
- [ ] Logs show volume cleanup message

### DinD Testing
- [ ] Component works in Docker-in-Docker environment
- [ ] Volume mounts work correctly
- [ ] No "volume not found" errors
- [ ] Cleanup works in DinD

### Security Testing
- [ ] Different tenants get different volumes
- [ ] Volumes are isolated (tenant A can't access tenant B)
- [ ] No orphaned volumes after execution
- [ ] Path traversal attempts are blocked
- [ ] Volume names include tenant ID and timestamp

### Verify Cleanup
```bash
# Before execution
docker volume ls --filter "label=studio.managed=true"

# After execution (should be same or empty)
docker volume ls --filter "label=studio.managed=true"

# No orphaned volumes
docker volume ls --filter "dangling=true"
```

---

## Common Patterns

### Conditional File Writing

```typescript
const files: Record<string, string> = {
  'required.txt': requiredData
};

if (input.optionalConfig) {
  files['config.yaml'] = input.optionalConfig;
}

if (input.resolvers.length > 0) {
  files['resolvers.txt'] = input.resolvers.join('\n');
}

await volume.initialize(files);
```

### Binary Files

```typescript
import { readFile } from 'fs/promises';

const wordlistBuffer = await readFile('/path/to/wordlist.bin');

await volume.initialize({
  'wordlist.bin': wordlistBuffer,  // Buffer for binary
  'config.txt': 'text content'      // String for text
});
```

### Large Files

The utility handles large files efficiently:

```typescript
// No size limits - uses streaming internally
const largeWordlist = generateMillionsOfWords().join('\n');

await volume.initialize({
  'massive-wordlist.txt': largeWordlist  // Works fine
});
```

### Output File Reading

```typescript
// Tool writes results.json and summary.txt
await runComponentWithRunner(config, ...);

// Read both files
const outputs = await volume.readFiles(['results.json', 'summary.txt']);

// Parse as needed
const results = JSON.parse(outputs['results.json'] || '{}');
const summary = outputs['summary.txt'] || '';

return { results, summary };
```

---

## When NOT to Use IsolatedVolume

You **don't need** IsolatedContainerVolume if:

| Scenario | Alternative |
|----------|-------------|
| Tool only uses CLI args/flags | Pass args directly via `command` |
| Tool reads from stdin | Use stdin (sparingly - prefer files) |
| Inline runner (not Docker) | Use regular Node.js file APIs |
| Tool uses environment variables | Use `env` in runner config |

---

## Migration Guide

Migrating an existing component:

1. **Import utility**
   ```typescript
   import { IsolatedContainerVolume } from '../../utils/isolated-volume';
   ```

2. **Replace mkdtemp/writeFile**
   ```diff
   - const tempDir = await mkdtemp(path.join(tmpdir(), 'input-'));
   - await writeFile(path.join(tempDir, 'file.txt'), data);
   + const volume = new IsolatedContainerVolume(tenantId, context.runId);
   + await volume.initialize({ 'file.txt': data });
   ```

3. **Replace volume mount**
   ```diff
   - volumes: [{ source: tempDir, target: '/inputs' }]
   + volumes: [volume.getVolumeConfig('/inputs', true)]
   ```

4. **Replace cleanup**
   ```diff
   - finally { await rm(tempDir, { recursive: true }); }
   + finally { await volume.cleanup(); }
   ```

See `worker/src/utils/COMPONENTS_TO_MIGRATE.md` for detailed migration plans.

---

## Reference Documentation

- **API Reference**: `worker/src/utils/README.md` - Complete API docs
- **Architecture**: `docs/ISOLATED_VOLUMES.md` - How it works, security model
- **Component SDK**: `.ai/component-sdk.md` - Full SDK reference
- **Migration Tracking**: `worker/src/utils/COMPONENTS_TO_MIGRATE.md`

---

## Example: Complete Component

See `worker/src/components/security/dnsx.ts` for a production example:
- Lines 615-618: Volume creation
- Lines 626-635: File preparation
- Lines 637-649: Volume initialization and mount
- Lines 659-661: Cleanup

---

## Questions?

- Component development: `.ai/component-sdk.md`
- File access patterns: This document
- Security questions: #security channel
- Bug reports: GitHub Issues
