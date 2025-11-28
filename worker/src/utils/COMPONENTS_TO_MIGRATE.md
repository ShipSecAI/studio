# Components to Migrate to IsolatedContainerVolume

This document tracks which security components need migration from file mounts to isolated volumes for DinD compatibility.

## Migration Status

| Component | Status | Uses Files | Priority | Notes |
|-----------|--------|------------|----------|-------|
| **dnsx** | ✅ **Migrated** | Yes (domains, resolvers) | High | PR #100 - Working in DinD |
| **prowler-scan** | ✅ **Migrated** | Yes (AWS credentials, config) | High | Uses isolated volumes for AWS creds + output |
| **shuffledns-massdns** | ✅ **Migrated** | Yes (domains, wordlists, resolvers) | High | Uses isolated volume for inputs |
| **supabase-scanner** | ✅ **Migrated** | TBD | Medium | Uses isolated volume for config/output |
| **httpx** | ⏸️ To Review | TBD | Medium | Check if file-based |
| **subfinder** | ⏸️ To Review | TBD | Medium | Check if file-based |
| **naabu** | ⏸️ To Review | TBD | Medium | Check if file-based |
| **amass** | ⏸️ To Review | TBD | Medium | Check if file-based |

## Legend
- ✅ **Migrated** - Using IsolatedContainerVolume
- ⚠️ **Needs Migration** - Currently using file mounts (broken in DinD)
- ⏸️ **To Review** - Needs investigation to determine if migration needed
- ⛔ **No Migration Needed** - Doesn't use files or already works

---

## Detailed Migration Plans

### 1. prowler-scan (High Priority)

**Current Approach:**
```typescript
hostAwsConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-creds-'));
await fs.writeFile(path.join(hostAwsConfigDir, 'credentials'), ...);
await fs.writeFile(path.join(hostAwsConfigDir, 'config'), ...);
```

**Migration:**
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);

await volume.initialize({
  'credentials': credentialsContent,
  'config': configContent
});

// Mount at ~/.aws in container
volumes: [volume.getVolumeConfig('/root/.aws', true)]
```

**Complexity:** Medium
**Estimated Time:** 30-45 minutes
**Breaking Changes:** None (internal only)

---

### 2. shuffledns-massdns (High Priority)

**Expected Files:**
- Domain list
- Wordlist (for bruteforce mode)
- Resolvers list
- Trusted resolvers list (optional)

**Migration:**
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);

const files: Record<string, string> = {
  'domains.txt': domains.join('\n'),
  'resolvers.txt': resolvers.join('\n')
};

if (mode === 'bruteforce' && words) {
  files['wordlist.txt'] = words.join('\n');
}

if (trustedResolvers.length > 0) {
  files['trusted-resolvers.txt'] = trustedResolvers.join('\n');
}

await volume.initialize(files);
```

**Complexity:** Medium-High (multiple conditional files)
**Estimated Time:** 45-60 minutes
**Breaking Changes:** None

---

### 3. supabase-scanner (Medium Priority)

**Status:** Migrated — now uses `IsolatedContainerVolume` for config/output mounts (no host temp dirs).

**Action Items:**
- [x] Check if component uses temp files
- [x] Determine if Docker runner or inline
- [x] Identify file dependencies
- [x] Create migration plan if needed

---

## Migration Template

For each component, follow this pattern:

```typescript
// 1. Import utility
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

// 2. Get tenant ID (update when available in context)
const tenantId = (context as any).tenantId ?? 'default-tenant';

// 3. Create volume instance
const volume = new IsolatedContainerVolume(tenantId, context.runId);

try {
  // 4. Prepare files
  const inputFiles: Record<string, string> = {
    'file1.txt': content1,
    'file2.json': JSON.stringify(config)
  };

  // 5. Initialize volume
  await volume.initialize(inputFiles);
  context.logger.info(`Created isolated volume: ${volume.getVolumeName()}`);

  // 6. Configure runner with volume
  const runnerConfig: DockerRunnerConfig = {
    // ... other config
    volumes: [volume.getVolumeConfig('/inputs', true)]
  };

  // 7. Run component
  const result = await runComponentWithRunner(runnerConfig, ...);

  // 8. Read output files if needed
  const outputs = await volume.readFiles(['results.json']);

  return result;

} finally {
  // 9. Always cleanup
  await volume.cleanup();
  context.logger.info('Cleaned up isolated volume');
}
```

---

## Testing Checklist

After migrating each component:

- [ ] TypeScript compiles without errors
- [ ] Worker starts successfully
- [ ] Component works in local environment
- [ ] Component works in DinD environment (if available)
- [ ] Volume is created with correct naming
- [ ] Files are written to volume successfully
- [ ] Container can read files from volume
- [ ] Volume is cleaned up after execution
- [ ] Volume is cleaned up on error/failure
- [ ] Logs show creation and cleanup messages
- [ ] No orphaned volumes left behind

---

## Bulk Migration Strategy

### Option 1: One-by-one (Recommended)
- Migrate and test each component individually
- Create separate PR for each or small batches
- Lower risk, easier to review

### Option 2: Batch Migration
- Migrate all at once
- Single large PR
- Faster but higher risk

**Recommendation:** Start with prowler-scan and shuffledns-massdns (high priority), then review others.

---

## Post-Migration

Once all components are migrated:

1. **Add tenantId to ExecutionContext**
   ```typescript
   export interface ExecutionContext {
     runId: string;
     tenantId: string;  // Add this
     ...
   }
   ```

2. **Remove fallback values**
   ```typescript
   // Before
   const tenantId = (context as any).tenantId ?? 'default-tenant';

   // After
   const tenantId = context.tenantId;
   ```

3. **Set up orphan cleanup**
   ```typescript
   // Cron job or scheduled task
   import { cleanupOrphanedVolumes } from './utils';
   await cleanupOrphanedVolumes(24);
   ```

4. **Add monitoring**
   - Track volume creation/deletion
   - Alert on orphaned volumes
   - Monitor volume storage usage

---

## Questions?

- Migration help: See [worker/src/utils/README.md](./README.md)
- Architecture details: See [worker/src/utils/MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md)
- File issues: GitHub Issues
