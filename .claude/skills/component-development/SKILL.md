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
import { defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';

export default defineComponent({
  id: 'category.tool.action',
  label: 'My Component',
  category: 'security',  // or: core, ai, notification, manual_action
  runner: { kind: 'inline' },  // or: docker
  
  inputs: inputs({
    target: port(z.string(), { label: 'Target Host' }),
  }),

  outputs: outputs({
    success: port(z.boolean(), { label: 'Success' }),
  }),

  async execute({ inputs }, context) { 
    // ... logic ...
    return { success: true };
  }
});
```

---

## Agent Instructions

### When Creating a New Component

1. **Check existing components** in same category for patterns
   ```bash
   ls worker/src/components/<category>/
   ```

2. **Copy structure from similar component** — don't start from scratch

3. **Always use defineComponent helper** with separated schemas:
   - `inputs()` + `port()`
   - `outputs()` + `port()`
   - `parameters()` + `param()` (optional)
   - Unit test in `__tests__/<component>.test.ts`

4. **For Docker components:**
   - MUST use shell wrapper: `entrypoint: 'sh', command: ['-c', 'tool "$@"', '--']`
   - MUST use `IsolatedContainerVolume` for file I/O
   - Reference: `worker/src/components/security/dnsx.ts`

### Quick Component Checklist

```
□ ID follows pattern: namespace.tool.action
□ File in correct category folder
□ inputs/outputs/parameters defined with port()/param() helpers
□ execute() receives { inputs, params }
□ Docker: shell wrapper pattern used
□ Docker with files: IsolatedContainerVolume used
□ Unit test created
□ Exported as default (componentRegistry.register is handled by defineComponent)
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
  // Note: Permissions are auto-set for nonroot containers
} finally {
  await volume.cleanup();
}
```
→ See: `docs/development/isolated-volumes.mdx`

### Entry Point Runtime Inputs
```typescript
// Supported types: text, number, file, json, array, secret
const runtimeInputs = [
  { id: 'apiKey', label: 'API Key', type: 'secret', required: true },
  { id: 'targets', label: 'Targets', type: 'array', required: true },
];
// Secret type renders as password field in UI
```
→ See: `docs/development/component-development.mdx#entry-point-runtime-input-types`

### Inputs vs. Parameters

| Type | Function | UI Location | Use Case |
|------|----------|-------------|----------|
| **Inputs** | `inputs()` + `port()` | Canvas handles | Runtime data (target, apiKey, fileId) |
| **Parameters**| `parameters()` + `param()` | Sidebar form | Static config (model, timeout, enum) |

**Note on Inputs:** You can set `valuePriority: 'manual-first'` in port metadata to prioritize manual overrides over connected data.

### Defining Parameters
```typescript
parameters: parameters({
  model: param(z.string().default('gpt-4'), {
    label: 'Model Name',
    editor: 'select',
    options: [{ label: 'GPT-4', value: 'gpt-4' }],
  }),
  timeout: param(z.number().min(1), { 
    label: 'Timeout', 
    editor: 'number' 
  }),
})
```
Editors: `text`, `textarea`, `number`, `boolean`, `select`, `multi-select`, `json`, `secret`.

---

## Context Services

```typescript
async execute({ inputs, params }, context) {
  context.logger.info('...');           // Logs to UI timeline
  context.emitProgress('...');          // Progress events
  await context.secrets?.get('KEY');    // Encrypted secrets
  await context.storage?.downloadFile(inputs.fileId);  // MinIO files
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
| Missing `port()` wrapper | All input/output schemas must use `port()` |
| Mixing inputs and parameters | Use `inputs()` for runtime ports and `parameters()` for design-time config |
| Throwing plain Error | Use SDK errors: `ValidationError`, `ServiceError`, etc. |

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
