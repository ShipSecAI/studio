# Docker-in-Docker File Mounting Solution

## Problem Summary

In a Docker-in-Docker (DinD) setup where the worker container runs inside Docker and creates containers:

1. **Volume Path Mismatch**: When the worker creates a container with volume mounts, those paths are relative to the Docker daemon's filesystem, not the worker container's filesystem
2. **Security Risk**: Shared volumes in multi-tenant SaaS allow one tenant to access another tenant's data
3. **Limited stdin Approach**: Previous fix used stdin to pass data, which:
   - ❌ Can't use file-based features (config files, custom resolvers)
   - ❌ Doesn't work for binary files
   - ❌ Can't handle tools that write output files
   - ❌ Has memory limits for large inputs

## Solution: Isolated Named Volumes

Use **unique Docker named volumes** created per `tenantId + runId + timestamp`:

```
tenant-${tenantId}-run-${runId}-${timestamp}
```

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Docker Host                                              │
│                                                          │
│  ┌─────────────────────────────────────────────┐        │
│  │ Worker Container (DinD)                     │        │
│  │                                              │        │
│  │  1. Creates volume via Docker CLI           │        │
│  │     docker volume create tenant-A-run-1-... │        │
│  │                                              │        │
│  │  2. Populates files using temp container    │        │
│  │     docker run -v vol:/data alpine sh -c .. │        │
│  │                                              │        │
│  │  3. Runs actual tool with volume mounted    │        │
│  │     docker run -v vol:/inputs dnsx ...      │        │
│  │                                              │        │
│  │  4. Reads output files using temp container │        │
│  │     docker run -v vol:/data alpine cat ...  │        │
│  │                                              │        │
│  │  5. Cleans up volume                        │        │
│  │     docker volume rm tenant-A-run-1-...     │        │
│  └─────────────────────────────────────────────┘        │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │ Docker Volumes (on Docker Host)          │           │
│  │                                           │           │
│  │  • tenant-A-run-123-1732090000           │           │
│  │  • tenant-B-run-456-1732090001           │           │
│  │  • tenant-A-run-789-1732090002           │           │
│  │                                           │           │
│  │  Each volume isolated per tenant + run   │           │
│  └──────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

### Security Benefits

| Aspect | Old Approach | New Approach |
|--------|-------------|--------------|
| **Tenant Isolation** | ❌ Shared volume or stdin | ✅ Unique volume per tenant+run |
| **Path Traversal** | ⚠️ Possible with file mounts | ✅ Validated filenames |
| **Data Leakage** | ❌ Files persist in shared space | ✅ Immediate cleanup |
| **Audit Trail** | ❌ None | ✅ Volume labels track tenant/run |
| **DinD Compatible** | ❌ File mounts don't work | ✅ Named volumes work perfectly |

---

## Implementation

### Before: File Mounting (Broken in DinD)

```typescript
// worker/src/components/security/dnsx.ts (OLD)

const hostInputDir = await mkdtemp(path.join(tmpdir(), 'dnsx-input-'));
const domainFilePath = path.join(hostInputDir, DOMAIN_FILE_NAME);
await writeFile(domainFilePath, normalisedDomains.join('\n'), 'utf8');

const runnerConfig: DockerRunnerConfig = {
  volumes: [
    { source: hostInputDir, target: '/inputs', readOnly: true }
  ]
};

try {
  await runComponentWithRunner(runnerConfig, ...);
} finally {
  await rm(hostInputDir, { recursive: true, force: true });
}
```

**Issues:**
- `hostInputDir` is a path inside the worker container
- Docker daemon can't access this path (different filesystem)
- Volume mount silently fails in DinD

### After: Isolated Volumes (DinD Compatible)

```typescript
// worker/src/components/security/dnsx.ts (NEW)

const tenantId = context.tenantId ?? 'default-tenant';
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  // Write input files to isolated volume
  await volume.initialize({
    [DOMAIN_FILE_NAME]: normalisedDomains.join('\n'),
    [RESOLVER_FILE_NAME]: resolverList.join('\n')
  });

  const runnerConfig: DockerRunnerConfig = {
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  await runComponentWithRunner(runnerConfig, ...);

  // Can also read output files
  const outputs = await volume.readFiles(['results.json']);

} finally {
  await volume.cleanup();
}
```

**Benefits:**
- ✅ Works in DinD (named volumes are in Docker daemon's namespace)
- ✅ Tenant isolated (unique volume per execution)
- ✅ Can read output files
- ✅ Automatic cleanup

---

## Comparison: All Approaches

| Feature | File Mounts | stdin Approach | Isolated Volumes |
|---------|-------------|----------------|------------------|
| **DinD Compatible** | ❌ No | ✅ Yes | ✅ Yes |
| **File-based tools** | ✅ Yes | ❌ No | ✅ Yes |
| **Config files** | ✅ Yes | ❌ No | ✅ Yes |
| **Output files** | ❌ Hard to read | ❌ No | ✅ Yes |
| **Binary files** | ✅ Yes | ❌ No | ✅ Yes |
| **Large files** | ✅ Yes | ⚠️ Memory limits | ✅ Yes |
| **Tenant isolation** | ❌ No | ⚠️ Process-level | ✅ Volume-level |
| **Complexity** | Low | Low | Medium |

---

## Usage Examples

### Simple Input Files

```typescript
const volume = new IsolatedContainerVolume(tenantId, runId);

try {
  await volume.initialize({
    'targets.txt': targets.join('\n')
  });

  const config = {
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  await runTool(config);
} finally {
  await volume.cleanup();
}
```

### Input + Output Files

```typescript
const volume = new IsolatedContainerVolume(tenantId, runId);

try {
  // Write inputs
  await volume.initialize({
    'config.yaml': yamlConfig
  });

  // Tool writes to same volume
  const config = {
    command: ['--input', '/data/config.yaml', '--output', '/data/results.json'],
    volumes: [volume.getVolumeConfig('/data', false)] // Read-write
  };

  await runTool(config);

  // Read outputs
  const outputs = await volume.readFiles(['results.json', 'summary.txt']);
  return JSON.parse(outputs['results.json']);

} finally {
  await volume.cleanup();
}
```

### Multiple Volumes

```typescript
const inputVol = new IsolatedContainerVolume(tenantId, `${runId}-in`);
const outputVol = new IsolatedContainerVolume(tenantId, `${runId}-out`);

try {
  await inputVol.initialize({ 'data.csv': csvData });
  await outputVol.initialize({}); // Empty volume for outputs

  const config = {
    volumes: [
      inputVol.getVolumeConfig('/inputs', true),
      outputVol.getVolumeConfig('/outputs', false)
    ]
  };

  await runTool(config);

  const results = await outputVol.readFiles(['output.json']);

} finally {
  await Promise.all([
    inputVol.cleanup(),
    outputVol.cleanup()
  ]);
}
```

---

## Volume Lifecycle

1. **Create**: `docker volume create tenant-A-run-123-...`
2. **Populate**: Use temporary Alpine container to write files
3. **Mount**: Container uses the volume via `-v volumeName:/path`
4. **Read**: Use temporary Alpine container to read files
5. **Cleanup**: `docker volume rm tenant-A-run-123-...`

### Automatic Cleanup

Volumes are **always** cleaned up via `finally` blocks:

```typescript
try {
  await volume.initialize(...);
  await runTool(...);
} finally {
  await volume.cleanup(); // Always runs, even on error
}
```

### Orphan Cleanup

For volumes that weren't cleaned up (e.g., worker crash):

```typescript
import { cleanupOrphanedVolumes } from './utils';

// Run daily via cron
const removed = await cleanupOrphanedVolumes(24); // 24 hours
console.log(`Removed ${removed} orphaned volumes`);
```

Or manually:

```bash
# List studio-managed volumes
docker volume ls --filter "label=studio.managed=true"

# Remove old volumes
docker volume prune --filter "label=studio.managed=true"
```

---

## Performance Considerations

### Volume Creation Overhead

- **Creation**: ~50-100ms per volume
- **File writes**: ~10-50ms per file (depends on size)
- **Cleanup**: ~50-100ms per volume

**Total overhead**: ~100-250ms per execution

This is acceptable for security tools that typically run for seconds/minutes.

### Optimization Tips

1. **Batch file writes**: Write all files in one `initialize()` call
2. **Reuse volumes**: For sequential operations in same run, reuse the volume
3. **Lazy cleanup**: Clean up volumes in background job if latency-sensitive

---

## Migration Checklist

To migrate a component to use isolated volumes:

- [ ] Import `IsolatedContainerVolume`
- [ ] Get `tenantId` from context (use fallback for now)
- [ ] Create volume instance: `new IsolatedContainerVolume(tenantId, runId)`
- [ ] Replace file writes with `volume.initialize({ files })`
- [ ] Replace volume mount with `volume.getVolumeConfig()`
- [ ] Add `finally` block with `volume.cleanup()`
- [ ] If tool writes outputs, use `volume.readFiles()` to retrieve them
- [ ] Test in DinD environment

---

## When to Use Each Approach

### Use Isolated Volumes When:
- ✅ Running in DinD environment
- ✅ Need multi-tenant isolation
- ✅ Tool requires file-based config
- ✅ Tool writes output files
- ✅ Handling binary/large files

### Use stdin/stdout When:
- ✅ Tool supports stdin input
- ✅ Single-tenant or dev environment
- ✅ Small text-only inputs
- ✅ Don't need output files

### Use File Mounts When:
- ✅ NOT running in DinD (direct Docker)
- ✅ Development/testing only
- ✅ Quick prototyping

---

## Future Enhancements

1. **Add tenantId to ExecutionContext**: Update SDK to include `tenantId`
   ```typescript
   export interface ExecutionContext {
     runId: string;
     tenantId: string;  // Add this
     ...
   }
   ```

2. **Volume Metrics**: Track volume usage, size, creation time
3. **Encryption**: Encrypt volume contents at rest
4. **S3 Integration**: For very large files, use object storage
5. **Caching**: Reuse volumes for identical inputs (hash-based)

---

## Questions?

- Technical questions: #engineering-core
- Security questions: #security
- Bug reports: GitHub Issues

---

## Related Documentation

- [Isolated Volume Utility README](./README.md)
- [Component SDK Documentation](../../packages/component-sdk/README.md)
- [Docker Volume Documentation](https://docs.docker.com/storage/volumes/)
