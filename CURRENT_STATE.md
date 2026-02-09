# ShipSec Studio - Current State Summary

**Date:** 2026-02-09
**Session:** E2E Testing & MCP Group Integration

---

## ✅ What's Working

### Core Platform

- **Backend API:** Running at `http://localhost:3211`
- **Temporal UI:** Running at `http://localhost:8081`
- **Worker:** Processing workflows and activities
- **Infrastructure:** PostgreSQL, Redis, MinIO, Loki, Redpanda all operational

### E2E Tests Passing (547 pass)

| Test File                    | Status  | Description                                  |
| ---------------------------- | ------- | -------------------------------------------- |
| `webhooks.test.ts`           | ✅ PASS | Webhook transforms GitHub payload → workflow |
| `error-handling.test.ts`     | ✅ PASS | Retry policies, timeout errors (5 tests)     |
| `node-io-spilling.test.ts`   | ✅ PASS | Large output spilling to storage             |
| `subworkflow.test.ts`        | ✅ PASS | Parent-child workflow communication          |
| `http-observability.test.ts` | ✅ PASS | HAR capture, error tracing                   |

### Webhook Flow Verified

```
GitHub Event → Webhook Endpoint → Parsing Script → Workflow Execution → Temporal → Completion
```

**Working webhook example:**

```javascript
export async function script(input) {
  console.log('Full input:', JSON.stringify(input));
  return { alert: input.payload || input };
}
```

---

## 🔧 MCP Group Mechanism (New)

### Old Approach (Deprecated)

```typescript
// ❌ No longer works
security.aws - cloudtrail - mcp; // Separate component
security.aws - cloudwatch - mcp; // Separate component
```

### New Approach (Working)

```typescript
// ✅ Use MCP groups instead
mcp.group.aws
  - enabledServers: [
      'aws-cloudtrail',
      'aws-cloudwatch',
      'aws-iam',
      'aws-s3-tables',
      'aws-lambda',
      'aws-dynamodb',
      'aws-documentation',
      'aws-well-architected',
      'aws-api'
    ]
  - Input: AWS credentials (core.credentials.aws)
  - Output: tools (mcp.tool contract)
```

### Wiring Example

```typescript
edges: [
  {
    id: 'a1',
    source: 'aws-creds',
    target: 'aws-mcp-group',
    sourceHandle: 'credentials',
    targetHandle: 'credentials',
  },
  {
    id: 't1',
    source: 'aws-mcp-group',
    target: 'agent',
    sourceHandle: 'tools',
    targetHandle: 'tools',
  },
];
```

---

## ⚠️ Current Issues

### Alert Investigation E2E Test

**Status:** ❌ FAILING
**File:** `e2e-tests/alert-investigation.test.ts`
**Error:** `fetch failed` when running `aws-mcp-group` component

**What we fixed:**

- ✅ Updated test to use `mcp.group.aws` instead of deprecated components
- ✅ Updated edges to connect credentials → mcp-group → agent

**Remaining issue:**

- The MCP group component is failing with "fetch failed" error
- Likely a Docker image pull or network issue
- Needs investigation into MCP group component implementation

**Error details:**

```
[Activity] Failed aws-mcp-group: fetch failed
ApplicationFailure: fetch failed
  type: 'TypeError'
```

---

## 📊 Available Components

### Security Components

- ✅ `security.abuseipdb.check`
- ✅ `security.virustotal.lookup`
- ✅ `security.prowler.scan`

### AI Components

- ✅ `core.ai.opencode` (OpenCode Agent)
- ✅ `core.ai.agent`

### MCP Components

- ✅ `mcp.group.aws` (AWS MCPs)
- ✅ `mcp.custom` (Custom MCP)

### Credentials

- ✅ `core.credentials.aws`

---

## 🎯 Test Credentials Available

**File:** `.env.eng-104`

- ✅ ZAI_API_KEY
- ✅ ABUSEIPDB_API_KEY
- ✅ VIRUSTOTAL_API_KEY
- ✅ AWS_ACCESS_KEY_ID
- ✅ AWS_SECRET_ACCESS_KEY
- ✅ AWS_REGION

---

## 🚀 Quick Test Commands

### Run All E2E Tests

```bash
cd ~/shipsec/shipsec-studio
export $(cat .env.eng-104 | grep -v '^#' | xargs)
RUN_E2E=true bun test
```

### Run Specific Tests

```bash
# Webhook tests (PASSING)
RUN_E2E=true bun test e2e-tests/webhooks.test.ts

# Alert investigation (FAILING - needs MCP group fix)
RUN_E2E=true bun test e2e-tests/alert-investigation.test.ts
```

---

## 📋 Next Steps

1. **Fix MCP Group Issue** (HIGH PRIORITY)
   - Investigate `fetch failed` error in `mcp.group.aws`
   - Check Docker image availability
   - Verify component implementation

2. **Create Simple Agent Test** (Recommended)
   - Skip AWS MCPs for now
   - Test OpenCode agent with AbuseIPDB + VirusTotal only
   - Validate agent → tools → report flow

3. **Update Documentation**
   - Document MCP group migration
   - Update component catalog
   - Add troubleshooting guide

---

## 🔗 Key Files

| File                                    | Purpose                                |
| --------------------------------------- | -------------------------------------- |
| `.env.eng-104`                          | E2E test credentials                   |
| `e2e-tests/alert-investigation.test.ts` | OpenCode agent E2E (currently failing) |
| `e2e-tests/webhooks.test.ts`            | Webhook E2E (passing)                  |
| `run-e2e-test.sh`                       | Full AWS integration test script       |

---

## 💡 Key Learnings

1. **Webhook parsing scripts must export a function:**

   ```javascript
   export async function script(input) { ... }
   ```

2. **MCP groups are the new standard** - individual AWS MCP components are deprecated

3. **The core pipeline works:** webhook → parsing → workflow → temporal → completion

4. **Agent component works** - just need to resolve the MCP group fetch issue

---

**Generated:** 2026-02-09
**Session:** E2E Testing & Validation
