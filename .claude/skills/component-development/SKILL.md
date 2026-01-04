---
name: component-development
description: Creating components (inline/docker). Dynamic ports, retry policies, PTY patterns, IsolatedContainerVolume.
---

# Component Development

**Full guide:** `docs/development/component-development.mdx`

---

## Quick Reference

### File Location
```
worker/src/components/<category>/<component-name>.ts
```
Categories: `security/`, `core/`, `ai/`, `notification/`, `manual-action/`

### ID Pattern
```
<namespace>.<tool>.<action>
```
Examples: `shipsec.dnsx.run`, `core.http.request`, `ai.llm.generate`

### Minimal Component
```typescript
import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const definition: ComponentDefinition<Input, Output> = {
  id: 'category.tool.action',
  label: 'My Component',
  category: 'security',  // or: core, ai, notification, manual_action
  runner: { kind: 'inline' },  // or: docker
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  async execute(input, context) { ... }
};

componentRegistry.register(definition);
export default definition;
```

---

## Agent Instructions

### When Creating a New Component

1. **Check existing components** in same category for patterns
   ```bash
   ls worker/src/components/<category>/
   ```

2. **Copy structure from similar component** — don't start from scratch

3. **Always include:**
   - `inputSchema` + `outputSchema` (Zod)
   - `metadata` block with inputs/outputs/parameters
   - Unit test in `__tests__/<component>.test.ts`

4. **For Docker components:**
   - MUST use shell wrapper: `entrypoint: 'sh', command: ['-c', 'tool "$@"', '--']`
   - MUST use `IsolatedContainerVolume` for file I/O
   - Reference: `worker/src/components/security/dnsx.ts`

### Quick Component Checklist

```
□ ID follows pattern: namespace.tool.action
□ File in correct category folder
□ inputSchema/outputSchema defined with Zod
□ metadata.inputs/outputs match schema
□ Docker: shell wrapper pattern used
□ Docker with files: IsolatedContainerVolume used
□ Unit test created
□ Registered with componentRegistry.register()
□ Exported as default
```

---

## Key Patterns (Quick Look)

### Inline Component
```typescript
runner: { kind: 'inline' }
// Just write TypeScript in execute()
```

### Docker Component  
```typescript
runner: {
  kind: 'docker',
  image: 'tool:latest',
  entrypoint: 'sh',
  command: ['-c', 'tool "$@"', '--'],
  network: 'bridge',
}
// ⚠️ Shell wrapper required for PTY
```
→ See: `docs/development/component-development.mdx#docker-component-requirements`

### File I/O (Docker)
```typescript
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
const volume = new IsolatedContainerVolume(tenantId, context.runId);
try {
  await volume.initialize({ 'input.txt': data });
  // volumes: [volume.getVolumeConfig('/path', true)]
} finally {
  await volume.cleanup();
}
```
→ See: `docs/development/isolated-volumes.mdx`

### Dynamic Ports
```typescript
resolvePorts(params) {
  return { inputs: [...], outputs: [...] };
}
```
→ See: `docs/development/component-development.mdx#dynamic-ports-resolveports`

---

## Context Services

```typescript
async execute(input, context) {
  context.logger.info('...');           // Logs to UI timeline
  context.emitProgress('...');          // Progress events
  await context.secrets?.get('KEY');    // Encrypted secrets
  await context.storage?.downloadFile(id);  // MinIO files
  await context.artifacts?.upload({...});   // Save artifacts
}
```

---

## Error Handling

```typescript
import { ValidationError, AuthenticationError, ServiceError } from '@shipsec/component-sdk';

// Non-retryable (immediate fail)
throw new ValidationError('Bad input', { fieldErrors: {...} });
throw new AuthenticationError('Invalid API key');

// Retryable (Temporal will retry)
throw new ServiceError('API down', { statusCode: 503 });
```
→ See: `docs/development/component-development.mdx#error-handling`

---

## Testing Commands

```bash
# Unit tests (mocked, fast)
bun --cwd worker test

# Integration tests (real Docker)
ENABLE_DOCKER_TESTS=true bun --cwd worker test

# E2E tests (full stack - requires `just dev`)
RUN_E2E=true bun --cwd e2e-tests test
```

---

## Common Mistakes to Avoid

| Mistake | Fix |
|---------|-----|
| Docker without shell wrapper | Use `entrypoint: 'sh', command: ['-c', 'tool "$@"', '--']` |
| Direct file mounts in Docker | Use `IsolatedContainerVolume` |
| Missing `finally` for volume cleanup | Always `await volume.cleanup()` in finally |
| No metadata block | Add `metadata: { inputs: [...], outputs: [...] }` |
| Throwing plain Error | Use SDK errors: `ValidationError`, `ServiceError`, etc. |
| Forgetting to register | Add `componentRegistry.register(definition)` |

---

## Reference Files

| What | Where |
|------|-------|
| Full docs | `docs/development/component-development.mdx` |
| Isolated volumes | `docs/development/isolated-volumes.mdx` |
| SDK source | `packages/component-sdk/src/` |
| Good example (Docker) | `worker/src/components/security/dnsx.ts` |
| Good example (inline) | `worker/src/components/core/http-request.ts` |
| E2E tests | `e2e-tests/` |
