# ShipSec E2E Testing & AWS Integration Summary

## What You Have Now

### ✅ Local E2E Testing Framework

- **E2E Test**: [alert-investigation.test.ts](../e2e-tests/alert-investigation.test.ts)
  - Creates workflow with OpenCode agent + MCP tools
  - Injects sample GuardDuty alert
  - Validates agent output (8-minute timeout)
- **Setup Script**: [setup-eng-104-env.ts](../e2e-tests/scripts/setup-eng-104-env.ts)
  - Interactive prompt for API keys
- **Test Runner**: `./scripts/e2e-local-test.sh`
  - Validates environment
  - Checks backend connectivity
  - Runs E2E tests

### ✅ OpenCode Agent Component

- **Docker Image**: `ghcr.io/shipsecai/opencode:1.1.53`
- **Capabilities**:
  - MCP tool gateway (localhost on host network)
  - LLM model support (OpenAI, Z.AI, etc.)
  - Autonomous investigation
- **Location**: [worker/src/components/ai/opencode.ts](../worker/src/components/ai/opencode.ts)

### ✅ Smart Webhook System

- **Webhook Endpoints**:
  - Public: `POST /webhooks/inbound/{path}` (no auth)
  - Admin: `POST /webhooks/configurations` (manage webhooks)
- **Parsing Scripts**: User-defined TypeScript in sandboxed Docker/Bun
- **Database**: Tracks webhook configs + delivery history
- **Integration**: Automatically triggers Temporal workflows

### ✅ Webhook Testing

- **E2E Test**: [webhooks.test.ts](../e2e-tests/webhooks.test.ts)
  - Creates workflow
  - Creates webhook with parsing script
  - Tests script sandbox
  - Triggers webhook via public endpoint
  - Polls workflow status

---

## How to Use This Locally

### Start from Scratch

```bash
# 1. Setup environment
bun run e2e-tests/scripts/setup-eng-104-env.ts

# 2. Start backend + worker
just dev start

# 3. Run E2E tests
RUN_E2E=true bun run test:e2e

# Or just webhook + alert tests:
./scripts/e2e-local-test.sh webhooks
./scripts/e2e-local-test.sh alert-investigation
```

### Manual Testing (Without E2E)

```bash
# Create workflow + webhook via API
WORKFLOW_ID=$(curl -s -X POST http://localhost:3211/workflows \
  -H 'x-internal-token: local-internal-token' \
  -d @my-workflow.json | jq -r '.id')

WEBHOOK=$(curl -s -X POST http://localhost:3211/webhooks/configurations \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "workflowId": "'$WORKFLOW_ID'",
    "name": "Test Hook",
    "parsingScript": "export async function script(input) { return input.payload; }",
    "expectedInputs": [{"id": "data", "label": "Data", "type": "json", "required": true}]
  }' | jq -r '.webhookPath')

# Trigger webhook
curl -X POST http://localhost:3211/webhooks/inbound/$WEBHOOK \
  -H 'Content-Type: application/json' \
  -d '{"data": "test"}'

# Poll status
# (Returns: { "status": "delivered", "runId": "..." })
```

---

## Real AWS Integration (Cloud Platform Feature)

### For Self-Hosted / Testing Users

**Goal**: Connect real GuardDuty findings → ShipSec → OpenCode Agent

**Steps** (5-10 minutes):

1. **Create webhook in ShipSec**

   ```bash
   # API call creates webhook path: wh_xyz123...
   ```

2. **Deploy AWS CloudFormation stack**
   - Docs: [WEBHOOK-GUARDDUTY-SETUP.md](./WEBHOOK-GUARDDUTY-SETUP.md)
   - Template: [docs/cloudformation/shipsec-integration.yaml](./cloudformation/shipsec-integration.yaml)
   - Creates: SNS topic, EventBridge rule, IAM role

3. **Test the connection**

   ```bash
   # Manual webhook test (no AWS account needed)
   curl -X POST http://localhost:3211/webhooks/inbound/$WEBHOOK_PATH \
     -H 'Content-Type: application/json' \
     -d '{
       "Message": "{\"detail\": {\"type\": \"Recon:EC2/PortProbeUnprotectedPort\", ...}}"
     }'
   ```

4. **Monitor in Temporal UI**
   - http://localhost:8081
   - View agent execution, trace, logs

---

## How to Make It Easy for Cloud Platform Users

### 1. **Dashboard UI: One-Click AWS Setup**

Path: Settings → Integrations → AWS

```
┌─────────────────────────────────────────────────┐
│ AWS Integration Setup                           │
├─────────────────────────────────────────────────┤
│                                                 │
│ Step 1: Grant Permissions                      │
│  [Copy IAM Trust Role] → AWS Console           │
│                                                 │
│ Step 2: Configure GuardDuty                    │
│  Region: [us-east-1 ▼]                        │
│  Severity: [> 4.0]                            │
│                                                 │
│ Step 3: Create Webhook                        │
│  [Auto-create webhook] → wh_abc123xyz         │
│                                                 │
│ Step 4: Deploy to AWS                         │
│  [Open CloudFormation →]                       │
│  Webhook URL: https://api.shipsec.ai/...      │
│                                                 │
│ Step 5: Confirm SNS Subscription              │
│  ⏳ Pending confirmation...                    │
│  [Check Email / Manual Confirm]                │
│                                                 │
│ Step 6: Test                                  │
│  [Send Test Finding] ✅ Received              │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 2. **CloudFormation Stack (One-Click Deploy)**

Use: [docs/cloudformation/shipsec-integration.yaml](./cloudformation/shipsec-integration.yaml)

Pre-filled parameters:

- `ShipSecWebhookPath`: From Step 1
- `ShipSecWebhookDomain`: `api.shipsec.ai`

Creates in customer AWS account:

- SNS topic
- EventBridge rule (GuardDuty → SNS)
- IAM role

### 3. **Setup Script (CLI Alternative)**

For users who prefer CLI:

```bash
shipsec aws setup \
  --region us-east-1 \
  --webhook-path wh_abc123 \
  --webhook-domain api.shipsec.ai
```

### 4. **Automatic Workflow Creation**

When AWS integration is enabled, automatically create:

```json
{
  "name": "AWS GuardDuty Triage",
  "description": "Auto-triage GuardDuty findings with OpenCode",
  "nodes": [
    {
      "id": "start",
      "type": "core.workflow.entrypoint",
      "data": {
        "config": {
          "params": {
            "runtimeInputs": [
              { "id": "alert", "label": "GuardDuty Finding", "type": "json", "required": true }
            ]
          }
        }
      }
    },
    {
      "id": "agent",
      "type": "core.ai.opencode",
      "data": {
        "config": {
          "params": {
            "systemPrompt": "You are a security triage agent. Analyze the GuardDuty finding and recommend actions.",
            "autoApprove": true
          },
          "inputOverrides": {
            "task": "Investigate GuardDuty finding",
            "context": { "finding": "{{alert}}" },
            "model": { "provider": "openai", "modelId": "gpt-4o" }
          }
        }
      }
    }
  ]
}
```

### 5. **Documentation**

- **Quick Start**: [WEBHOOK-GUARDDUTY-SETUP.md](./WEBHOOK-GUARDDUTY-SETUP.md)
  - Copy-paste commands
  - 5-minute setup
- **Full Guide**: [E2E-TESTING-REAL-WORLD.md](./E2E-TESTING-REAL-WORLD.md)
  - Architecture diagram
  - Testing scenarios
  - Troubleshooting
- **Dashboard Help**: In-app tooltips + links to docs

### 6. **Observability**

Show users:

- **Webhook Deliveries**: API endpoint lists all incoming payloads

  ```bash
  GET /webhooks/configurations/{id}/deliveries
  ```

- **Workflow Trace**: See each step of agent execution

  ```bash
  GET /workflows/runs/{runId}/trace
  ```

- **Agent Logs**: Real-time agent output in Temporal UI
  ```
  Workflow → Task → Activity → Logs
  ```

---

## File Structure

```
docs/
├── E2E-TESTING-REAL-WORLD.md        ← Full guide (this you need to read)
├── WEBHOOK-GUARDDUTY-SETUP.md        ← Quick reference for AWS setup
├── TESTING-SUMMARY.md                ← This file
└── cloudformation/
    └── shipsec-integration.yaml       ← One-click AWS deployment

scripts/
└── e2e-local-test.sh                 ← Local test runner

backend/
├── src/webhooks/
│   ├── inbound-webhook.controller.ts ← Public /webhooks/inbound/{path}
│   ├── webhooks.service.ts           ← Core webhook logic
│   └── webhooks.controller.ts        ← Admin /webhooks/* endpoints
└── src/testing/
    └── testing-webhook.controller.ts ← Test webhook sink

worker/
├── src/components/ai/
│   ├── opencode.ts                   ← OpenCode agent component
│   └── agent-stream-recorder.ts      ← Stream handling
└── src/temporal/
    └── activities/
        └── webhook-parsing.activity.ts ← Sandbox script execution

e2e-tests/
├── alert-investigation.test.ts       ← Full E2E with agent
├── webhooks.test.ts                  ← Webhook creation + triggering
└── scripts/
    └── setup-eng-104-env.ts          ← Interactive env setup
```

---

## Next Steps

### Immediate (Today)

- [ ] Run local E2E test:
  ```bash
  ./scripts/e2e-local-test.sh alert-investigation
  ```
- [ ] Create test webhook manually via API
- [ ] Verify webhook → workflow → agent → output flow in Temporal UI

### Short Term (This Week)

- [ ] Test with real AWS account (if available)
  - Deploy CloudFormation stack
  - Enable real GuardDuty
  - Trigger actual finding
- [ ] Build dashboard UI for AWS integration setup

### Medium Term (This Month)

- [ ] Automate workflow creation on AWS integration
- [ ] Create dashboard webhooks management UI
- [ ] Add observability: webhook delivery logs, agent execution dashboard
- [ ] Write customer docs + video walkthrough

---

## Key Takeaways

| Aspect                   | Status            | How to Use                                                 |
| ------------------------ | ----------------- | ---------------------------------------------------------- |
| **Local Testing**        | ✅ Ready          | `./scripts/e2e-local-test.sh`                              |
| **Real AWS Integration** | ✅ Ready (Manual) | [WEBHOOK-GUARDDUTY-SETUP.md](./WEBHOOK-GUARDDUTY-SETUP.md) |
| **Cloud Platform UI**    | ⬜ Design + Build | Use dashboard mockup in guide                              |
| **Documentation**        | ✅ Complete       | [E2E-TESTING-REAL-WORLD.md](./E2E-TESTING-REAL-WORLD.md)   |

---

**TL;DR:**

- Run `./scripts/e2e-local-test.sh alert-investigation` to validate everything works locally
- Use [WEBHOOK-GUARDDUTY-SETUP.md](./WEBHOOK-GUARDDUTY-SETUP.md) + CloudFormation to connect real AWS
- Build dashboard UI using the 5-step flow outlined above for cloud users
