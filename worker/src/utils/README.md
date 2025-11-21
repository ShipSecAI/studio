# Worker Utilities

Shared utilities for ShipSec Studio worker components.

## IsolatedContainerVolume

**Secure, multi-tenant volume management for Docker-in-Docker (DinD) environments.**

### Problem

In DinD setups, direct volume mounting fails because:
- Worker container paths don't align with Docker daemon's filesystem
- Shared volumes create security risks in multi-tenant SaaS
- File-based tools can't use stdin/stdout for all operations

### Solution

`IsolatedContainerVolume` creates unique Docker volumes per tenant + execution with:
- ✅ **Perfect tenant isolation** - Each run gets a unique volume
- ✅ **Automatic cleanup** - No volume leaks
- ✅ **Support for file I/O** - Read and write files
- ✅ **Audit trail** - Volumes are labeled with tenant/run metadata

---

## Usage

### Basic Example

```typescript
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

// In your component's execute function
async execute(input, context) {
  const tenantId = context.tenantId ?? 'default-tenant';
  const volume = new IsolatedContainerVolume(tenantId, context.runId);

  try {
    // 1. Create volume and write input files
    await volume.initialize({
      'domains.txt': domains.join('\n'),
      'config.json': JSON.stringify(config)
    });

    // 2. Use volume in Docker container
    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: 'your-tool:latest',
      command: ['-i', '/inputs/domains.txt', '-o', '/outputs/results.json'],
      volumes: [
        volume.getVolumeConfig('/inputs', true),  // read-only
        volume.getVolumeConfig('/outputs', false) // read-write for outputs
      ]
    };

    await runComponentWithRunner(runnerConfig, ...);

    // 3. Read output files from volume
    const outputs = await volume.readFiles(['results.json', 'summary.txt']);
    const results = JSON.parse(outputs['results.json']);

    return results;

  } finally {
    // 4. ALWAYS cleanup in finally block
    await volume.cleanup();
  }
}
```

### Advanced: Multiple Volumes

For tools that need separate input/output volumes:

```typescript
const inputVolume = new IsolatedContainerVolume(tenantId, `${runId}-input`);
const outputVolume = new IsolatedContainerVolume(tenantId, `${runId}-output`);

try {
  await inputVolume.initialize({ 'data.txt': inputData });
  await outputVolume.initialize({});  // Empty volume for outputs

  const runnerConfig: DockerRunnerConfig = {
    volumes: [
      inputVolume.getVolumeConfig('/inputs', true),
      outputVolume.getVolumeConfig('/outputs', false)
    ]
  };

  // ... run container ...

  const results = await outputVolume.readFiles(['output.json']);

} finally {
  await Promise.all([
    inputVolume.cleanup(),
    outputVolume.cleanup()
  ]);
}
```

### Binary Files

The utility supports binary files via `Buffer`:

```typescript
const imageBuffer = await fs.readFile('logo.png');

await volume.initialize({
  'config.txt': 'text content',
  'logo.png': imageBuffer  // Binary data
});
```

---

## API Reference

### Constructor

```typescript
new IsolatedContainerVolume(tenantId: string, runId: string)
```

**Parameters:**
- `tenantId` - Tenant identifier (alphanumeric, hyphens, underscores only)
- `runId` - Unique run/execution identifier

**Throws:**
- Error if tenant ID or run ID contains invalid characters

### Methods

#### `initialize(files: Record<string, string | Buffer>): Promise<string>`

Creates the volume and populates it with files.

**Returns:** Volume name (e.g., `tenant-foo-run-bar-1234567890`)

**Example:**
```typescript
const volumeName = await volume.initialize({
  'input.txt': 'data',
  'config.json': JSON.stringify({ key: 'value' })
});
```

---

#### `getVolumeConfig(containerPath: string, readOnly: boolean): VolumeConfig`

Returns volume configuration for the component SDK.

**Parameters:**
- `containerPath` - Mount path inside container (default: `/inputs`)
- `readOnly` - Mount as read-only (default: `true`)

**Returns:**
```typescript
{
  source: string,    // Volume name
  target: string,    // Container path
  readOnly: boolean
}
```

**Example:**
```typescript
volumes: [
  volume.getVolumeConfig('/inputs', true),
  volume.getVolumeConfig('/outputs', false)
]
```

---

#### `getBindMount(containerPath: string, readOnly: boolean): string`

Returns bind mount string for raw docker commands.

**Returns:** String like `"volumeName:/path:ro"`

**Example:**
```typescript
const mount = volume.getBindMount('/data', false);
// Returns: "tenant-foo-run-bar-123:/data:rw"
```

---

#### `readFiles(filenames: string[]): Promise<Record<string, string>>`

Reads files from the volume after container execution.

**Parameters:**
- `filenames` - Array of filenames to read

**Returns:** Map of filename to content

**Example:**
```typescript
const outputs = await volume.readFiles(['results.json', 'errors.log']);
console.log(JSON.parse(outputs['results.json']));
```

**Note:** Non-existent files are logged as warnings, not errors.

---

#### `cleanup(): Promise<void>`

Removes the volume. Call in `finally` block.

**Example:**
```typescript
finally {
  await volume.cleanup();
}
```

---

#### `getVolumeName(): string | undefined`

Returns the volume name for debugging/logging.

---

## Maintenance

### Cleanup Orphaned Volumes

Run periodically (e.g., daily cron job) to remove old volumes:

```typescript
import { cleanupOrphanedVolumes } from '../utils';

// Remove volumes older than 24 hours
const removed = await cleanupOrphanedVolumes(24);
console.log(`Cleaned up ${removed} orphaned volumes`);
```

You can also use Docker commands:

```bash
# List all studio-managed volumes
docker volume ls --filter "label=studio.managed=true"

# Remove volumes older than 24h
docker volume prune --filter "label=studio.managed=true"
```

---

## Migration Guide

### Before (File Mounts - DinD Incompatible)

```typescript
const tempDir = await mkdtemp(path.join(tmpdir(), 'tool-'));
await writeFile(path.join(tempDir, 'input.txt'), data);

const runnerConfig = {
  volumes: [{ source: tempDir, target: '/inputs', readOnly: true }]
};

try {
  await runComponentWithRunner(runnerConfig, ...);
} finally {
  await rm(tempDir, { recursive: true });
}
```

**Issues:**
- ❌ Breaks in DinD (volume paths don't align)
- ❌ No tenant isolation
- ❌ Can't read output files easily

### After (Isolated Volumes - DinD Compatible)

```typescript
const volume = new IsolatedContainerVolume(tenantId, runId);

try {
  await volume.initialize({ 'input.txt': data });

  const runnerConfig = {
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  await runComponentWithRunner(runnerConfig, ...);

  const outputs = await volume.readFiles(['output.txt']);
} finally {
  await volume.cleanup();
}
```

**Benefits:**
- ✅ Works in DinD
- ✅ Tenant isolated
- ✅ Can read output files
- ✅ Automatic cleanup

---

## Security Considerations

1. **Tenant Isolation**: Each volume is scoped to `tenantId` + `runId` + `timestamp`
2. **Input Validation**: Filenames are validated to prevent path traversal (`..` and `/` prefixes rejected)
3. **Read-only Mounts**: Input volumes default to read-only
4. **Volume Labels**: All volumes tagged with `studio.managed=true` for tracking
5. **Automatic Cleanup**: Volumes are removed immediately after use

---

## Troubleshooting

### Volume not mounting in container

**Check:**
1. Volume was initialized: `await volume.initialize(...)`
2. Volume name is valid: `console.log(volume.getVolumeName())`
3. Docker daemon is running: `docker volume ls`

### Files not appearing in container

**Check:**
1. Files were written: `await volume.initialize({ 'file.txt': 'content' })`
2. Container path matches: `getVolumeConfig('/inputs')` and container reads from `/inputs`
3. Filename doesn't start with `/` or contain `..`

### Cleanup failures

**Check:**
1. Container has stopped before cleanup
2. No other containers are using the volume
3. Docker daemon is accessible

**Manual cleanup:**
```bash
docker volume rm tenant-{tenantId}-run-{runId}-{timestamp}
```

---

## Future Enhancements

- [ ] Support for volume size limits
- [ ] Encryption at rest
- [ ] Compression for large files
- [ ] Metrics on volume usage
- [ ] Integration with object storage (S3) for large files

---

## Examples in Codebase

See these components for real-world usage:

- [worker/src/components/security/dnsx.ts](../components/security/dnsx.ts) - Input files only
- More examples coming soon...

---

## Questions?

File an issue or ping the team in #engineering-core on Slack.
