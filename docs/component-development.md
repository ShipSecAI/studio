# Component Development Guide

This guide provides best practices and required patterns for developing ShipSec Studio components.

## Table of Contents

- [Component Basics](#component-basics)
- [Docker Component Requirements (CRITICAL)](#docker-component-requirements-critical)
- [UI-Only Components](#ui-only-components)
- [File System Access (REQUIRED)](#file-system-access-required)
- [Security Requirements](#security-requirements)
- [Testing Checklist](#testing-checklist)
- [Common Patterns](#common-patterns)
- [Docker Entrypoint Pattern: Shell Wrapper for PTY Compatibility](#docker-entrypoint-pattern-shell-wrapper-for-pty-compatibility)
- [Output Buffering: Universal Solutions for All CLI Tools](#output-buffering-universal-solutions-for-all-cli-tools)

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

## Docker Component Requirements (CRITICAL)

### ⚠️ MANDATORY: PTY-Compatible Pattern

**All Docker-based components run with PTY (pseudo-terminal) enabled by default in workflows.** This means your component MUST be tested and designed for PTY mode from the start.

### The SDK Behavior

When your component runs in a workflow, the SDK executes Docker with different flags depending on the mode:

**PTY Mode (default for all workflows):**
```bash
docker run --rm -t your-image:latest  # TTY only, no stdin (-i flag removed by SDK)
```

**Non-PTY Mode (batch/testing only):**
```bash
docker run --rm -i your-image:latest  # Interactive stdin for JSON input
```

**Key SDK Feature:** The SDK automatically removes the `-i` (interactive stdin) flag in PTY mode to prevent tools from hanging while waiting for stdin input. This allows direct binary execution for distroless images.

### Two Valid Patterns

Choose based on your Docker image type:

#### Pattern 1: Shell Wrapper (Preferred for images with shell)

**Use when:** Your image has `/bin/sh` or `/bin/bash` available

```typescript
✅ CORRECT - Shell Wrapper Pattern:
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.tool.scan',
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    entrypoint: 'sh',                      // ✅ Shell wrapper
    command: ['-c', 'tool "$@"', '--'],    // ✅ Wraps CLI execution
    network: 'bridge',
  },
  async execute(input, context) {
    const args = ['-json', '-output', '/data/results.json'];

    const config: DockerRunnerConfig = {
      ...this.runner,
      command: [...(this.runner.command ?? []), ...args],
      // Final command: sh -c 'tool "$@"' -- -json -output /data/results.json
    };

    return runComponentWithRunner(config, input, context);
  }
};
```

**Benefits:**
- ✅ Shell handles closed stdin gracefully (won't wait for input)
- ✅ Shell manages TTY signals properly (SIGTERM, SIGHUP)
- ✅ Shell exits cleanly when the tool finishes
- ✅ Works identically in both PTY and non-PTY modes

**Examples:** dnsx, subfinder (ProjectDiscovery tools with full base images)

#### Pattern 2: Direct Binary + Stream Flag (For distroless images)

**Use when:** Your image is distroless (no shell available) OR tool has buffering issues

```typescript
✅ CORRECT - Direct Binary with Streaming:
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.nuclei.scan',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/nuclei:latest',
    entrypoint: 'nuclei',          // ✅ Direct binary (distroless, no shell)
    command: [],
    network: 'bridge',
  },
  async execute(input, context) {
    const args = [
      '-jsonl',
      '-stream',                   // ✅ Prevents output buffering
      '-l', '/inputs/targets.txt',
    ];

    const config: DockerRunnerConfig = {
      ...this.runner,
      command: args,
    };

    return runComponentWithRunner(config, input, context);
  }
};
```

**Requirements:**
- ✅ SDK removes `-i` flag automatically (prevents stdin hanging)
- ✅ Tool must have `-stream` or similar flag to prevent output buffering
- ✅ Tool must not wait for stdin input when none is provided

**Benefits:**
- ✅ Works with distroless images (smaller, more secure)
- ✅ SDK handles stdin issue automatically
- ✅ `-stream` flag prevents output buffering

**Examples:** nuclei, httpx (ProjectDiscovery tools with distroless images)

#### Pattern 3: Distroless Without Stream Flag

**Use when:** Image has no shell AND tool has no `-stream` flag

```typescript
✅ FALLBACK - Rely on SDK stdin handling:
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.tool.scan',
  runner: {
    kind: 'docker',
    image: 'distroless/tool:latest',
    entrypoint: 'tool',            // Direct binary (no choice)
    command: [],
    network: 'bridge',
  },
  async execute(input, context) {
    const args = ['-json', '-output', '/data/results.json'];

    const config: DockerRunnerConfig = {
      ...this.runner,
      command: args,
    };

    return runComponentWithRunner(config, input, context);
  }
};
```

**Limitations:**
- ⚠️ May experience output buffering (results appear delayed)
- ⚠️ SDK removes `-i` flag to prevent stdin hanging (helps but not perfect)
- ⚠️ Consider requesting upstream to add `-stream` flag or use full base image

**Workarounds if buffering is an issue:**
- Rebuild image with shell: `FROM your-distroless-image` → `FROM alpine` + copy binary
- Use `stdbuf -oL tool` if the image includes GNU coreutils
- Request upstream maintainer to add streaming flag

### Anti-Pattern (Will Cause Issues)

```typescript
❌ WRONG - Direct binary without considering PTY:
const definition: ComponentDefinition<Input, Output> = {
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    entrypoint: 'tool',                    // ❌ No shell wrapper
    command: ['-read-stdin', '-output'],   // ❌ Expects stdin input
  }
};
```

**Why this fails:**
1. Container starts with TTY attached (`-t` flag)
2. SDK removes `-i` flag (stdin immediately closed)
3. Tool tries to read from stdin → gets EOF or blocks
4. **May hang or produce unexpected results**

**Fix:** Use file-based input instead of stdin, or add shell wrapper

### Testing Requirements

**Before deploying any Docker component, you MUST test it with PTY flags:**

```bash
# Step 1: Test with PTY mode (this is what workflows use)
docker run --rm -t your-image:latest sh -c 'tool "$@"' -- -flag value

# Expected: Tool runs and exits cleanly within expected time
# If it hangs: Your entrypoint needs the shell wrapper pattern

# Step 2: Verify it doesn't wait for stdin
echo "" | docker run --rm -t -i your-image:latest sh -c 'tool "$@"' -- -flag value

# Expected: Same behavior as step 1

# Step 3: Test without PTY (for comparison)
docker run --rm your-image:latest sh -c 'tool "$@"' -- -flag value

# Expected: Should also work (no visual differences without TTY)
```

### Common Mistakes

1. **Using direct binary without shell or stream flag**
   ```typescript
   // ❌ WRONG - Will experience buffering or hanging
   entrypoint: 'tool',
   command: ['-flag', 'value']

   // ✅ CORRECT - Shell wrapper (if shell available)
   entrypoint: 'sh',
   command: ['-c', 'tool "$@"', '--', '-flag', 'value']

   // ✅ CORRECT - Direct binary + stream flag (distroless)
   entrypoint: 'tool',
   command: ['-stream', '-flag', 'value']
   ```

2. **Assuming stdin will be available**
   ```typescript
   // ❌ WRONG - SDK closes stdin in PTY mode
   command: ['tool', '--read-from-stdin']

   // ✅ CORRECT - Use file-based input
   command: ['tool', '--input-file', '/data/input.txt']
   ```

3. **Not testing with PTY flags before deployment**
   ```bash
   # ❌ WRONG - Only testing without PTY
   docker run --rm your-image:latest tool -flag value

   # ✅ CORRECT - Test with -t flag (what workflows use)
   docker run --rm -t your-image:latest tool -flag value
   ```

### Summary: Quick Decision Tree

```
Does your Docker image have a shell (/bin/sh)?
├─ YES → Use Pattern 1 (Shell Wrapper)
│         entrypoint: 'sh', command: ['-c', 'tool "$@"', '--']
│
└─ NO (Distroless) → Does your tool have a -stream flag?
   ├─ YES → Use Pattern 2 (Direct Binary + Stream)
   │         entrypoint: 'tool', command: ['-stream', ...]
   │
   └─ NO → Use Pattern 3 (SDK stdin handling)
             entrypoint: 'tool', command: [...]
             Note: May have buffering issues, consider rebuilding image
```

### Exception: Pre-wrapped Images

**You can skip the shell wrapper ONLY if:**
- The Docker image's ENTRYPOINT is already a shell script
- You've verified the image handles closed stdin + TTY correctly
- You've tested with `docker run --rm -t` (no `-i`)

**Example of a pre-wrapped image:**
```dockerfile
# Image Dockerfile
ENTRYPOINT ["/bin/sh", "-c", "my-tool \"$@\"", "--"]
```

If the image has this entrypoint, you can use:
```typescript
runner: {
  kind: 'docker',
  image: 'pre-wrapped:latest',
  command: ['-flag', 'value'],  // Goes after the '--' in ENTRYPOINT
}
```

### Verification Checklist

Before submitting your Docker component:

- [ ] Used `entrypoint: 'sh'` with `command: ['-c', 'tool "$@"', '--']`
- [ ] Tested with `docker run --rm -t` (PTY mode)
- [ ] Container exits cleanly without hanging
- [ ] No stdin-dependent operations in the tool
- [ ] Tool arguments are appended after `'--'` in command array
- [ ] Workflow run completes successfully in Studio

### Real-World Example: Nuclei

```typescript
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.nuclei.scan',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/nuclei:latest',
    entrypoint: '/usr/local/bin/nuclei',  // ❌ WRONG - direct binary
    // This caused nuclei to hang for 300s waiting for stdin in PTY mode
  }
};

// Fixed version:
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.nuclei.scan',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/nuclei:latest',
    entrypoint: 'sh',                          // ✅ Shell wrapper
    command: ['-c', 'nuclei "$@"', '--'],      // ✅ Wraps nuclei execution
  },
  async execute(input, context) {
    const args = ['-duc', '-jsonl', '-verbose', '-l', '/inputs/targets.txt'];
    const config: DockerRunnerConfig = {
      ...this.runner,
      command: [...(this.runner.command ?? []), ...args],
    };
    return runComponentWithRunner(config, input, context);
  }
};
```

### What If the Tool Doesn't Work Well With TTY?

**PTY mode is always enabled in workflows and cannot be disabled at the component level.** However, some tools behave differently when a TTY is attached (colored output, progress bars, interactive prompts, etc.). Here's how to handle them:

#### Solution 1: Use Tool Flags to Disable TTY Features

Most modern CLI tools detect TTY and change behavior. Disable those features explicitly:

```typescript
const args = [
  '--no-color',        // Disable ANSI color codes
  '--no-progress',     // Disable progress bars
  '--plain',           // Plain output mode
  '--batch',           // Non-interactive batch mode
  '-q',                // Quiet mode (no prompts)
];

// Examples:
// git: ['--no-pager', '--no-color']
// npm: ['--no-color', '--no-progress']
// terraform: ['-no-color']
// docker: ['--no-color']
```

#### Solution 2: Redirect stderr to stdout

Some tools output diagnostics to stderr when TTY is detected:

```typescript
runner: {
  kind: 'docker',
  image: 'tool:latest',
  entrypoint: 'sh',
  command: ['-c', 'tool "$@" 2>&1', '--'],  // Merge stderr into stdout
}
```

#### Solution 3: Control Output Buffering

If the tool buffers output unexpectedly with TTY:

```typescript
runner: {
  kind: 'docker',
  image: 'tool:latest',
  entrypoint: 'sh',
  command: ['-c', 'stdbuf -oL -eL tool "$@"', '--'],
}
// -oL: Line-buffered stdout
// -eL: Line-buffered stderr
```

#### Solution 4: Full TTY Emulation (Last Resort)

For tools that absolutely require a real TTY session:

```typescript
runner: {
  kind: 'docker',
  image: 'tool:latest',
  entrypoint: 'sh',
  command: ['-c', 'script -q -c "tool \\"$@\\"" /dev/null', '--'],
}
// script command provides full TTY emulation
```

#### Testing for TTY Compatibility

```bash
# Step 1: Does the tool detect TTY?
docker run --rm -t tool:latest sh -c 'tool --version "$@"' --

# Step 2: Does it behave differently?
docker run --rm tool:latest sh -c 'tool --version "$@"' --
# Compare output - if different, use flags to normalize

# Step 3: Does it hang or wait for input?
timeout 5 docker run --rm -t tool:latest sh -c 'tool "$@"' -- --help
# If times out, the tool has TTY/stdin issues
```

#### Example: Tool with TTY Detection

```typescript
// Tool outputs colored JSON when TTY is detected
const definition: ComponentDefinition<Input, Output> = {
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    entrypoint: 'sh',
    command: ['-c', 'tool "$@"', '--'],
  },
  async execute(input, context) {
    const args = [
      '--json',           // JSON output
      '--no-color',       // ✅ Disable TTY-specific coloring
      '--output', '/data/results.json'
    ];

    const config: DockerRunnerConfig = {
      ...this.runner,
      command: [...(this.runner.command ?? []), ...args],
    };

    return runComponentWithRunner(config, input, context);
  }
};
```

**Key Principle:** Always test with `docker run --rm -t` to see how the tool behaves with TTY, then use tool-specific flags to ensure consistent, parseable output regardless of TTY detection.

---

## UI-Only Components

Some components are purely for UI purposes (documentation, notes) and should not be executed during workflow runs. Mark these with `uiOnly: true` in metadata:

```typescript
const definition: ComponentDefinition<Input, void> = {
  id: 'core.ui.text',
  label: 'Text Block',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema: z.void(),
  metadata: {
    // ... other metadata
    uiOnly: true,  // Excluded from workflow execution
  },
  async execute() {
    // No-op for UI-only components
  }
};
```

UI-only components:
- Are stored in workflow definitions (for display in the canvas)
- Are excluded from the execution graph by the compiler
- Cannot have inputs/outputs (no port connections)

See [docs/text-block.md](./text-block.md) for a complete example.

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

## Docker Entrypoint Pattern: Shell Wrapper for PTY Compatibility

### Why We Use Shell Wrappers

**All Docker-based components MUST use a shell wrapper (`sh -c`) as the entrypoint, not the CLI tool directly.**

This is required for **PTY (pseudo-terminal) compatibility**. PTY enables real-time streaming of terminal output to users, which is critical for:
- Live progress updates during long-running scans
- Streaming results as they're discovered
- Interactive terminal experience
- Better UX for monitoring execution

### The Problem: Direct Binary Execution

When CLI tools run directly as the main container process with a PTY attached (`docker run -it`), they may not properly handle TTY signals and can hang indefinitely:

```typescript
// ❌ WRONG - Can hang with PTY
const definition = {
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/dnsx:latest',
    entrypoint: 'dnsx',  // Direct binary execution
    command: ['-json', '-silent', '-l', '/inputs/domains.txt']
  }
}
```

**What happens:**
- Container starts successfully
- Tool begins execution
- Output never appears (buffering or waiting for TTY input)
- Container hangs until timeout (e.g., 180 seconds)
- Workflow fails with timeout error

### The Solution: Shell Wrapper Pattern

Wrap the CLI tool in a shell script, which properly handles TTY behavior and ensures clean exit:

```typescript
// ✅ CORRECT - PTY compatible
const definition = {
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/dnsx:latest',
    entrypoint: 'sh',           // Shell as entrypoint
    command: ['-c', 'dnsx "$@"', '--'],  // Wrap tool in shell
    // Additional args will be appended after '--'
  }
}
```

**How it works:**
- `sh -c` runs the command in a shell
- `dnsx "$@"` executes dnsx with all arguments
- `--` marks the end of shell options, everything after becomes `$@`
- Shell handles TTY signals correctly and exits cleanly

### Implementation Pattern

For components that build dynamic arguments, use this pattern:

```typescript
// 1. Define base runner with shell wrapper
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.tool.run',
  label: 'Tool',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    entrypoint: 'sh',
    command: ['-c', 'tool "$@"', '--'],  // Shell wrapper
    network: 'bridge',
  },
  // ... inputSchema, outputSchema ...

  async execute(input, context) {
    // 2. Build tool-specific arguments
    const toolArgs = buildArgs(input);  // e.g., ['-json', '-silent', '-l', '/inputs/file.txt']

    // 3. Combine shell wrapper + tool args
    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: baseRunner.image,
      entrypoint: baseRunner.entrypoint,  // 'sh'
      command: [...(baseRunner.command ?? []), ...toolArgs],
      // Result: ['sh', '-c', 'tool "$@"', '--', '-json', '-silent', '-l', '/inputs/file.txt']
      // Executes as: sh -c 'tool "$@"' -- -json -silent -l /inputs/file.txt
    };

    return await runComponentWithRunner(runnerConfig, ...);
  }
};
```

### Why This Pattern Works

1. **TTY Signal Handling**: Shell (`sh`) properly handles SIGTERM, SIGHUP, and other TTY signals
2. **Clean Exit**: Shell ensures process cleanup even if the wrapped tool doesn't
3. **Buffering Control**: Shell manages stdout/stderr buffering correctly for TTY
4. **No Stdin Issues**: Shell doesn't wait for stdin input when not needed
5. **Consistent Behavior**: Same execution path for PTY and non-PTY modes

### When This Is Required

**ALWAYS use shell wrapper for Docker runners**, especially when:
- ✅ Component will be used in workflows (PTY is enabled by default)
- ✅ Tool produces streaming output
- ✅ Tool is a CLI binary (not a shell script)
- ✅ Tool runs for more than a few seconds

**Exception**: If the Docker image's default entrypoint is already a shell script (like some official images), you may not need the wrapper. Verify by checking the image's Dockerfile.

### Real-World Examples

#### Example 1: DNSX (Fixed)

```typescript
// Before: Hung for 180s waiting for timeout
runner: {
  entrypoint: 'dnsx',
  command: ['-h']
}

// After: Completes in <1s
runner: {
  entrypoint: 'sh',
  command: ['-c', 'dnsx "$@"', '--']
}
```

#### Example 2: Subfinder (Already Correct)

```typescript
// Already uses shell wrapper with full script
runner: {
  entrypoint: 'sh',
  command: [
    '-c',
    String.raw`set -eo pipefail

    # Shell script that runs subfinder
    subfinder -silent -dL "/inputs/domains.txt" |
      sed 's/\r//g' |
      sed '/^$/d'
    `
  ]
}
```

### Testing Your Implementation

Verify PTY compatibility:

```bash
# 1. Build your component
bun test src/components/your-component/__tests__/*.test.ts

# 2. Test in actual workflow (PTY enabled)
# Run workflow in UI or via API
# Check that:
# - Output streams in real-time (not all at once after completion)
# - No timeout errors
# - Clean exit (no hanging containers)

# 3. Check for orphaned containers
docker ps -a | grep your-image-name
# Should be empty after execution completes
```

### Common Mistakes

❌ **Forgetting the shell wrapper:**
```typescript
entrypoint: 'tool',  // Direct binary - will hang
command: ['-flag']
```

❌ **Wrong argument passing:**
```typescript
entrypoint: 'sh',
command: ['-c', 'tool -flag']  // Hardcoded args - not flexible
```

❌ **Overriding entrypoint in execute():**
```typescript
const runnerConfig = {
  entrypoint: 'tool',  // Bypasses the shell wrapper!
  command: toolArgs
}
```

✅ **Correct pattern:**
```typescript
const runnerConfig = {
  entrypoint: baseRunner.entrypoint,  // Keep 'sh'
  command: [...(baseRunner.command ?? []), ...toolArgs]
}
```

### Performance Impact

**Minimal overhead:**
- Shell startup: <1ms
- Argument forwarding: negligible
- Total impact: <0.1% for typical scans

**Benefits far outweigh cost:**
- Eliminates 180s+ timeout failures
- Enables real-time output streaming
- Prevents orphaned containers
- Better user experience

---

## Output Buffering: Universal Solutions for All CLI Tools

### The Problem

Even with PTY enabled, some CLI tools **buffer their output** instead of streaming it. This causes:
- Container appears to hang (no output)
- Results don't stream in real-time
- Potential timeout failures
- Poor user experience

**Why buffering happens:**
- Programs use different buffering modes: line-buffered (TTY) vs fully-buffered (pipe/file)
- When stdout isn't a TTY, most programs switch to full buffering (4KB-8KB buffer)
- Buffer only flushes when full or program exits
- In Docker containers, this can make tools appear hung

### Tool-Specific Solutions

#### ProjectDiscovery Tools (dnsx, subfinder, httpx, nuclei, etc.)

These tools have a built-in `-stream` flag:

```typescript
// Add to args array
args.push('-stream');
```

**What it does:**
- Disables internal buffering
- Forces immediate output flush
- Disables progress stats (they interfere with streaming)

**Example:**
```typescript
const args = ['-json', '-silent', '-l', '/inputs/file.txt', '-stream'];
```

#### GNU Coreutils and Common Tools

Most don't have streaming flags, but you can use shell utilities:

**Option 1: `stdbuf` (line buffering)**
```typescript
// Wrap command with stdbuf
entrypoint: 'sh',
command: ['-c', 'stdbuf -oL tool "$@"', '--'],
// -oL means "line buffered output"
```

**Option 2: `unbuffer` (from expect package)**
```typescript
entrypoint: 'sh',
command: ['-c', 'unbuffer tool "$@"', '--'],
```

**Option 3: `script` command (full PTY emulation)**
```typescript
entrypoint: 'sh',
command: ['-c', 'script -qec "tool $*" /dev/null', '--'],
```

### Universal Buffering Control Pattern

For tools that might have buffering issues, use this shell wrapper:

```typescript
const definition: ComponentDefinition<Input, Output> = {
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    entrypoint: 'sh',
    command: [
      '-c',
      // Try stdbuf first (available in most images), fallback to direct execution
      'if command -v stdbuf >/dev/null 2>&1; then stdbuf -oL tool "$@"; else tool "$@"; fi',
      '--'
    ],
  }
}
```

### Checking Tool Availability in Images

Before using buffering control tools, verify they're available:

```bash
# Check Alpine-based images
docker run --rm alpine:latest which stdbuf unbuffer
# Usually not available - Alpine uses busybox which lacks stdbuf

# Check Debian/Ubuntu-based images
docker run --rm ubuntu:latest which stdbuf unbuffer
# stdbuf: /usr/bin/stdbuf (from coreutils)
# unbuffer: requires 'expect' package

# Check tool-specific images
docker run --rm projectdiscovery/dnsx:latest which stdbuf
# Not available in ProjectDiscovery images
```

### Decision Tree for Buffering Solutions

```
Does the tool have a streaming flag? (e.g., -stream, --unbuffered, --line-buffered)
├─ YES: Use the tool's native flag ✅ BEST OPTION
│   └─ Example: dnsx -stream, httpx -stream
│
└─ NO: Check Docker image base
    ├─ Debian/Ubuntu-based?
    │   └─ Use: stdbuf -oL tool "$@" ✅ GOOD OPTION
    │
    ├─ Alpine-based?
    │   ├─ Can you install coreutils?
    │   │   ├─ YES: apk add coreutils && use stdbuf
    │   │   └─ NO: Use PTY + script command workaround
    │   │
    │   └─ Fallback: Hope PTY mode works 🤞
    │
    └─ Unknown/Custom image?
        └─ Test first, then add stdbuf wrapper if needed
```

### Testing for Buffering Issues

**Symptoms of buffering problems:**
- Container runs but produces no output for extended periods
- Output appears all at once after container exits
- Container times out waiting for output
- `docker logs <container>` shows nothing while running

**How to test:**

```bash
# 1. Run tool in container without streaming
docker run --rm -i tool:latest tool-command > output.txt &
PID=$!
sleep 5
kill $PID
cat output.txt  # Empty or incomplete = buffering issue

# 2. Run with stdbuf
docker run --rm -i tool:latest sh -c "stdbuf -oL tool-command" > output.txt &
PID=$!
sleep 5
kill $PID
cat output.txt  # Should have partial output = fixed!
```

### When Buffering Doesn't Matter

You **don't need** buffering solutions when:
- ✅ Tool outputs JSON at the end (not streaming)
- ✅ Tool completes in < 5 seconds
- ✅ Real-time streaming isn't important
- ✅ Running in non-PTY mode (batch processing)

### Why Some Tools Work Without `-stream`

**Case Study: Why Subfinder Worked But DNSX/httpx Hung**

Both are ProjectDiscovery tools, but they behaved differently:

**Subfinder (worked fine without `-stream`):**
- Outputs results **line-by-line as discoveries happen**
- Each subdomain found triggers an immediate write
- Natural line-buffering behavior (common in text-processing tools)
- Small outputs (hostnames) flush frequently
- **Result:** PTY sees data regularly, no hang

**DNSX/httpx (hung without `-stream`):**
- Collects ALL results in memory first
- Outputs everything at once when scan completes
- Uses full buffering (8KB buffer) for JSON output
- With 27 domains, output < 8KB, buffer never flushes
- **Result:** PTY sees no data for 180s, timeout occurs

**Key Insight:**

Tools that naturally output **line-by-line** often work fine without `-stream` because:
- Each line triggers a buffer flush (line-buffering mode)
- PTY receives incremental data
- User sees progress in real-time

Tools that output **batch JSON** or **large objects** need `-stream` because:
- They accumulate data in memory
- Buffer only flushes when full (8KB) or program exits
- PTY sees nothing until buffer flushes
- Causes apparent "hang" even though tool is working

**Recommendation:**

Even if a tool "works" without `-stream`, **always add it for ProjectDiscovery tools** because:
1. Ensures consistent behavior across all input sizes
2. Prevents future issues when processing more targets
3. Better user experience (real-time feedback)
4. No performance penalty

### Output Format Selection: Plain Text vs JSON

**Why Subfinder Uses Plain Text Instead of JSON:**

Subfinder component does NOT use the `-json` flag, even though it's available. Here's why:

```bash
# Subfinder without -json (what we use)
$ subfinder -d example.com -silent
www.example.com
mail.example.com
api.example.com

# Subfinder with -json (what we DON'T use)
$ subfinder -d example.com -silent -json
{"host":"www.example.com","input":"example.com"}
{"host":"mail.example.com","input":"example.com"}
{"host":"api.example.com","input":"example.com"}
```

**The Problem with JSONL:**

Subfinder's `-json` flag outputs **JSONL (JSON Lines)** format - one JSON object per line, not a single JSON array. This creates parsing complexity:

```typescript
// ❌ Can't do this with JSONL:
const result = JSON.parse(output);  // SyntaxError: Multiple JSON objects

// ✅ Would need line-by-line parsing:
const subdomains = output
  .split('\n')
  .map(line => JSON.parse(line))  // Parse each line separately
  .map(obj => obj.host);           // Extract the hostname
```

**Why Other Tools Use JSON:**

Tools like DNSX and httpx output **batch JSON arrays**, which are trivial to parse:

```bash
# DNSX outputs a single JSON array
$ dnsx -l domains.txt -json
[
  {"host":"example.com","a":["93.184.216.34"]},
  {"host":"www.example.com","a":["93.184.216.34"]}
]
```

```typescript
// ✅ Clean single parse:
const result = JSON.parse(output);  // Works directly
const findings = result.map(item => ({ host: item.host, ips: item.a }));
```

**Decision Rule:**

| Tool Output Format | Use `-json` Flag? | Reason |
|-------------------|-------------------|---------|
| **Batch JSON array** (dnsx, httpx) | ✅ Yes | Single `JSON.parse()` extracts structured data |
| **JSONL** (subfinder) | ❌ No | Line-by-line parsing adds complexity; plain text is simpler |
| **Plain text lines** (subfinder, most tools) | ❌ No | Direct `.split('\n')` is simplest |

**Implementation in Subfinder Component:**

```typescript
// worker/src/components/security/subfinder.ts
runner: {
  command: [
    '-c',
    String.raw`subfinder -silent -dL /inputs/domains.txt 2>/dev/null || true`
    // Note: No -json flag - we want plain text output
  ],
}

// Parsing is simple:
const subdomains = rawOutput
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0);
```

**Key Takeaway:**

Choose output format based on **parsing simplicity**, not just "JSON is better":
- Plain text lines → simplest (`.split('\n')`)
- Batch JSON → structured data worth parsing (`JSON.parse()`)
- JSONL → avoid unless you need per-line metadata (requires line-by-line parse + aggregation)

### Best Practices Summary

1. **Always try tool-native flags first** (`-stream`, `--unbuffered`, etc.)
2. **Use shell wrapper pattern** from PTY section (enables buffering control)
3. **For ProjectDiscovery tools**: Always add `-stream` flag
4. **For other tools**: Test first, add `stdbuf -oL` if buffering detected
5. **Document any buffering workarounds** in component comments

### Example: Complete Buffering-Safe Component

```typescript
const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.tool.run',
  label: 'Tool Scanner',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'tool:latest',
    // Shell wrapper for PTY compatibility AND buffering control
    entrypoint: 'sh',
    command: ['-c', 'tool "$@"', '--'],
    network: 'bridge',
  },
  async execute(input, context) {
    const args = buildArgs(input);

    // Add tool-specific streaming flag if available
    // For ProjectDiscovery tools:
    if (isProjectDiscoveryTool) {
      args.push('-stream');
    }

    const runnerConfig = {
      ...baseRunner,
      command: [...baseRunner.command, ...args],
    };

    return await runComponentWithRunner(runnerConfig, input, context);
  }
};
```

---

## Example: Complete Component

See `worker/src/components/security/dnsx.ts` for a production example:
- Lines 320-326: Shell wrapper definition
- Lines 615-618: Volume creation
- Lines 626-635: File preparation
- Lines 637-649: Volume initialization and mount
- Lines 645-646: Preserving shell wrapper in runtime config
- Lines 659-661: Cleanup

See `worker/src/components/security/subfinder.ts` for shell script pattern:
- Lines 80-82: Shell entrypoint with full script
- Lines 84-131: Bash script that wraps subfinder execution

---

## Questions?

- Component development: `.ai/component-sdk.md`
- File access patterns: This document
- PTY/Terminal issues: This document (Shell Wrapper section)
- Security questions: #security channel
- Bug reports: GitHub Issues
