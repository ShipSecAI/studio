# OpenCode Agent E2E Testing - Current State Update

## Progress Summary

### ✅ Completed
1. **Z.AI Provider Added** - `zai-coding-plan` provider added to LLMProviderSchema
2. **Component Fixes** - OpenCode component updated with:
   - Proper model string format: `zai-coding-plan/glm-4.7`
   - Provider config with `apiKey` in `provider.options.apiKey`
   - MCP config fix: `type: "remote"` instead of `transport: "http"`
3. **Committed** - Hash `87dbf5d`

### ⚠️ In Progress
4. **E2E Test Failing** - Tests fail due to Docker command argument handling

---

## Root Cause Analysis

### The Issue
When passing `['run', '--quiet', finalPrompt]` where `finalPrompt` contains spaces, the arguments are not being correctly interpreted by Docker/PTY layer.

### Evidence from Logs
```
[Docker][PTY] Spawning: docker run ... --entrypoint sh ghcr.io/anomalyco/opencode run --quiet Analyze the security alert...
```

The prompt appears without quotes, causing it to be split into multiple arguments.

### What Works Manually
```bash
# This works:
docker run ... ghcr.io/anomalyco/opencode run "Write a hello world function in Python."

# But the component's array format ['run', '--quiet', prompt] doesn't work
```

---

## Possible Solutions

### Option 1: Use `stdinJson: false` in Runner Definition
Set `stdinJson: false` in the runner definition to prevent stdin handling that might interfere.

### Option 2: Pass Command as Single String
Change command from array to single string that gets shell-parsed:
```typescript
command: [`sh`, `-c`, `opencode run --quiet '${finalPrompt.replace(/'/g, "'\\''")}'`]
```

### Option 3: Use Direct Prompt Argument
Try passing prompt as direct argument without `--quiet` flag.

### Option 4: Investigate PTY Mode
PTY mode (`runDockerWithPty`) is being used when it shouldn't be. Need to debug why.

---

## Current Component State

**File**: `worker/src/components/ai/opencode.ts`

**Current Implementation**:
```typescript
const escapedPrompt = finalPrompt.replace(/'/g, "'\\''");
const runnerConfig = {
  ...definition.runner,
  entrypoint: 'sh',
  command: ['-c', `opencode run --quiet '${escapedPrompt}'`],
  network: 'host' as const,
  ...
};
```

---

## Manual Test Results

| Command | Result |
|---------|--------|
| `docker run ... opencode run "hello world"` | ✅ Works |
| `docker run ... sh -c "opencode run 'hello'"` | ❌ Shows help |
| `docker run ... --entrypoint sh opencode -c "..."` | ❌ Shows help |
| `docker run ... --entrypoint /bin/sh opencode -lc "..."` | ❌ Shows help |

---

## Next Steps

1. Debug why PTY mode is being used in E2E tests
2. Try removing entrypoint override and pass prompt directly
3. Consider using `stdinJson: false` in runner definition
4. Update `current-state.md` and commit progress

---

## Environment

- **ZAI_API_KEY**: `aa8e1ccdcb48463aa3def6939a959a5c.GK2rlnuBm76aHRaI`
- **GLM Model**: `zai-coding-plan/glm-4.7`
- **Studio API**: Running on `http://127.0.0.1:3211`

---

## Key Findings

1. **Z.AI Native Provider**: `zai-coding-plan` is a first-class provider in OpenCode - no npm or baseURL needed
2. **Model Format**: Must be `zai-coding-plan/glm-4.7` (provider/modelId)
3. **API Key**: Goes in `provider.zai-coding-plan.options.apiKey`
4. **MCP Format**: `mcp.{name}: {type: 'remote', url: '...'}`
5. **Docker Command Issue**: Multi-word prompts need shell parsing for correct argument handling
