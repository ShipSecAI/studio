# Testing Quick Start

## 30-Second Overview

You have a **Smart Webhook System** that:

1. **Receives** GuardDuty alerts (or any JSON via HTTP)
2. **Parses** them with user-defined TypeScript script
3. **Triggers** a Temporal workflow
4. **Runs** OpenCode agent with MCP tools
5. **Returns** markdown report

## Run Local E2E Test (5 min)

```bash
# 1. Setup (one-time)
bun run e2e-tests/scripts/setup-eng-104-env.ts

# 2. Start services
just dev start

# 3. Run test
./scripts/e2e-local-test.sh alert-investigation
```

**What it does:**

- Creates workflow + OpenCode agent
- Injects sample GuardDuty alert
- Runs agent with real MCP tools
- Validates markdown report output

**Where to watch:**

- Logs: `just dev logs`
- Temporal UI: http://localhost:8081
- Frontend: http://localhost:5173

---

## Connect Real AWS (10 min)

### Option A: Manual API (No Infrastructure)

```bash
# 1. Create webhook
WEBHOOK=$(curl -s -X POST http://localhost:3211/webhooks/configurations \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "workflowId": "YOUR_WORKFLOW_ID",
    "name": "GuardDuty Hook",
    "parsingScript": "export async function script(input) { const msg = JSON.parse(input.payload.Message); return { alert: msg.detail }; }",
    "expectedInputs": [{"id": "alert", "label": "Finding", "type": "json", "required": true}]
  }' | jq -r '.webhookPath')

# 2. Test it
curl -X POST "http://localhost:3211/webhooks/inbound/$WEBHOOK" \
  -d '{"Message":"{\"detail\": {...GuardDuty JSON...}}"}'

# 3. View execution
# Temporal UI → http://localhost:8081
```

### Option B: AWS CloudFormation (Auto-Deploy)

```bash
# 1. Create webhook (get $WEBHOOK_PATH from API response above)

# 2. Deploy stack to AWS
aws cloudformation create-stack \
  --stack-name shipsec \
  --template-body file://docs/cloudformation/shipsec-integration.yaml \
  --parameters \
    ParameterKey=ShipSecWebhookPath,ParameterValue=$WEBHOOK_PATH \
    ParameterKey=ShipSecWebhookDomain,ParameterValue=api.shipsec.ai

# 3. Confirm SNS subscription (check AWS SNS console → Subscriptions)

# 4. Trigger finding in AWS
aws guardduty create-sample-findings \
  --detector-id <ID> \
  --finding-types "Recon:EC2/PortProbeUnprotectedPort" \
  --region us-east-1
```

---

## Core Endpoints

| Endpoint                                   | Method | Purpose                           |
| ------------------------------------------ | ------ | --------------------------------- |
| `/webhooks/inbound/{path}`                 | `POST` | Receive alert (public, no auth)   |
| `/webhooks/configurations`                 | `POST` | Create webhook (admin)            |
| `/webhooks/configurations/{id}/deliveries` | `GET`  | View webhook history (admin)      |
| `/webhooks/configurations/test-script`     | `POST` | Test parsing script (admin)       |
| `/workflows/runs/{id}/status`              | `GET`  | Check workflow status             |
| `/workflows/runs/{id}/trace`               | `GET`  | View execution trace + agent logs |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  AWS Account                                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ GuardDuty Finding                                    │   │
│  │ ↓                                                    │   │
│  │ EventBridge Rule                                     │   │
│  │ ↓                                                    │   │
│  │ SNS Topic                                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓ HTTPS POST                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
                  ShipSec Backend
                  ┌──────────────────────────────────┐
                  │ POST /webhooks/inbound/wh_abc... │
                  │ (public, no auth)                │
                  └──────────────────────────────────┘
                            ↓
                  Smart Webhook Service
                  ┌──────────────────────────────────┐
                  │ 1. Receive webhook               │
                  │ 2. Run parsing script (sandbox)  │
                  │ 3. Extract: alert, severity, ... │
                  └──────────────────────────────────┘
                            ↓
                   Temporal Workflow Trigger
                  ┌──────────────────────────────────┐
                  │ Workflow: GuardDuty Triage       │
                  │ Inputs: { alert, context }       │
                  └──────────────────────────────────┘
                            ↓
                  Parallel Execution
                  ┌──────────────────────────────────┐
                  │ • MCP Tools (AbuseIPDB, VT, AWS) │
                  │ • OpenCode Agent (Docker)        │
                  │   - Lists MCP tools              │
                  │   - Runs investigation           │
                  │   - Generates report             │
                  └──────────────────────────────────┘
                            ↓
                      Result Output
                  ┌──────────────────────────────────┐
                  │ • Report (markdown)              │
                  │ • Raw logs                       │
                  │ • MCP tool calls                 │
                  │ • Agent trace                    │
                  └──────────────────────────────────┘
                            ↓
                   Frontend Dashboard
                  ┌──────────────────────────────────┐
                  │ http://localhost:5173            │
                  │ → Workflows → Recent Runs        │
                  │ → View report + traces           │
                  └──────────────────────────────────┘
```

---

## Files to Read (In Order)

1. **This file** (you are here) - 2 min overview
2. [docs/TESTING-SUMMARY.md](./docs/TESTING-SUMMARY.md) - Architecture + how to use (10 min)
3. [docs/WEBHOOK-GUARDDUTY-SETUP.md](./docs/WEBHOOK-GUARDDUTY-SETUP.md) - AWS setup reference (5 min)
4. [docs/E2E-TESTING-REAL-WORLD.md](./docs/E2E-TESTING-REAL-WORLD.md) - Deep dive + troubleshooting (20 min)

---

## Troubleshooting

| Issue                              | Quick Fix                                    |
| ---------------------------------- | -------------------------------------------- |
| Test fails: backend not responding | `just dev start` (from workspace root)       |
| Webhook returns 404                | Copy exact `wh_` path from creation response |
| Agent doesn't run                  | Check Temporal UI for workflow errors        |
| MCP tools unavailable              | Verify `INTERNAL_SERVICE_TOKEN` in backend   |
| AWS credentials failing            | Update `.env.eng-104` with valid keys        |

---

## What's Under the Hood

- **Webhook Component**: [backend/src/webhooks/](./backend/src/webhooks)
- **OpenCode Agent**: [worker/src/components/ai/opencode.ts](./worker/src/components/ai/opencode.ts)
- **E2E Tests**: [e2e-tests/](./e2e-tests/)
- **Database**: PostgreSQL `webhook_configurations` + `webhook_deliveries` tables

---

## For Cloud Platform

To make this easy for SaaS customers, we need:

1. **Dashboard UI** - 5-step AWS integration wizard
2. **One-click CloudFormation** - Pre-filled template with webhook path
3. **Webhook Management** - Create, test, view deliveries
4. **Workflow Templates** - Auto-create triage workflows
5. **Help & Docs** - In-app guidance + links to guides

See [docs/E2E-TESTING-REAL-WORLD.md](./docs/E2E-TESTING-REAL-WORLD.md) → "Cloud Platform: Making It Easy for Users" for detailed design.

---

**Ready?** Run this:

```bash
./scripts/e2e-local-test.sh alert-investigation
```

Then check out the report in Temporal UI or frontend dashboard.

Questions? Check [docs/TESTING-SUMMARY.md](./docs/TESTING-SUMMARY.md) or [docs/E2E-TESTING-REAL-WORLD.md](./docs/E2E-TESTING-REAL-WORLD.md).
