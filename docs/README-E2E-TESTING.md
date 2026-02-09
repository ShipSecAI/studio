# E2E Testing & AWS Integration: Complete Guide

## 📋 Document Index

Read in this order:

### Quick Start (5 min)

📄 [TESTING-QUICK-START.md](../TESTING-QUICK-START.md)

- 30-second overview
- Run E2E test in 5 minutes
- Core endpoints
- Troubleshooting table

### Architecture & Usage (20 min)

📄 [TESTING-SUMMARY.md](../docs/TESTING-SUMMARY.md)

- What you have now
- How to use locally
- Real AWS integration overview
- File structure

### AWS Setup Reference (10 min)

📄 [WEBHOOK-GUARDDUTY-SETUP.md](../docs/WEBHOOK-GUARDDUTY-SETUP.md)

- Copy-paste AWS commands
- Manual webhook test
- Real vs. local testing
- Troubleshooting

### Deep Dive (30 min)

📄 [E2E-TESTING-REAL-WORLD.md](../docs/E2E-TESTING-REAL-WORLD.md)

- Full architecture
- Step-by-step local setup
- AWS integration guide
- Testing scenarios
- Cloud platform design

### Cloud Platform Feature (20 min)

📄 [CLOUD-PLATFORM-AWS-INTEGRATION.md](../docs/CLOUD-PLATFORM-AWS-INTEGRATION.md)

- User journey (wizard flow)
- Implementation plan
- Backend APIs
- Frontend components
- Database schema
- Security considerations

---

## 🚀 Quick Start (Copy-Paste)

### Test Locally (5 minutes)

```bash
# 1. Setup environment
bun run e2e-tests/scripts/setup-eng-104-env.ts

# 2. Start backend + worker
just dev start

# 3. Run E2E test
./scripts/e2e-local-test.sh alert-investigation

# 4. View results
# - Logs: just dev logs
# - Temporal UI: http://localhost:8081
# - Frontend: http://localhost:5173
```

### Connect Real AWS (10 minutes)

```bash
# 1. Create webhook
WORKFLOW_ID="<your-workflow-id>"
WEBHOOK=$(curl -s -X POST http://localhost:3211/webhooks/configurations \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "workflowId": "'$WORKFLOW_ID'",
    "name": "GuardDuty Hook",
    "parsingScript": "export async function script(input) { const msg = JSON.parse(input.payload.Message); return { alert: msg.detail }; }",
    "expectedInputs": [{"id": "alert", "label": "Finding", "type": "json", "required": true}]
  }' | jq -r '.webhookPath')

# 2. Deploy AWS resources
aws cloudformation create-stack \
  --stack-name shipsec \
  --template-body file://docs/cloudformation/shipsec-integration.yaml \
  --parameters \
    ParameterKey=ShipSecWebhookPath,ParameterValue=$WEBHOOK \
    ParameterKey=ShipSecWebhookDomain,ParameterValue=api.shipsec.ai

# 3. Confirm SNS (check email or click [Manual Confirm] in AWS console)

# 4. Test
aws guardduty create-sample-findings \
  --detector-id <ID> \
  --finding-types "Recon:EC2/PortProbeUnprotectedPort" \
  --region us-east-1

# 5. Monitor in Temporal UI: http://localhost:8081
```

---

## 📦 What You Have

### Locally Ready to Test ✅

- **E2E Test Suite**: alert-investigation.test.ts + webhooks.test.ts
- **Test Runner**: `./scripts/e2e-local-test.sh`
- **OpenCode Agent**: Docker component with MCP tool gateway
- **Smart Webhooks**: Public ingestion + parsing + workflow trigger
- **Sample Data**: GuardDuty alert fixture

### AWS-Ready (Manual Setup) ✅

- **Webhook System**: Unguessable paths, no auth needed
- **CloudFormation Template**: One-click SNS + EventBridge + IAM
- **Parsing Scripts**: User-defined TypeScript sandbox
- **Workflow Execution**: Full trace + agent logs

### Cloud Platform (Design Ready) ⬜

- **UI Wizard**: 8-step setup flow designed
- **API Endpoints**: Specifications ready
- **Database Schema**: Schema defined
- **Security**: Cross-account trust + webhook security

---

## 🎯 What to Do Next

### Immediate (Today)

- [ ] Run local E2E test: `./scripts/e2e-local-test.sh alert-investigation`
- [ ] Verify webhook → agent → report flow in Temporal UI
- [ ] Read [TESTING-QUICK-START.md](../TESTING-QUICK-START.md)

### This Week

- [ ] Test with real AWS account (CloudFormation + real GuardDuty)
- [ ] Verify MCP tools work with real IPs/domains
- [ ] Read [WEBHOOK-GUARDDUTY-SETUP.md](../docs/WEBHOOK-GUARDDUTY-SETUP.md)

### This Month

- [ ] Start building cloud platform UI (use design in [CLOUD-PLATFORM-AWS-INTEGRATION.md](../docs/CLOUD-PLATFORM-AWS-INTEGRATION.md))
- [ ] Add new API endpoints for integration management
- [ ] Implement dashboard UI for webhook management
- [ ] Write customer documentation

---

## 📁 File Structure

```
docs/
├── README-E2E-TESTING.md                      ← You are here
├── TESTING-QUICK-START.md                     ← Start here (5 min)
├── TESTING-SUMMARY.md                         ← Architecture overview (20 min)
├── WEBHOOK-GUARDDUTY-SETUP.md                 ← AWS reference (10 min)
├── E2E-TESTING-REAL-WORLD.md                  ← Deep dive (30 min)
├── CLOUD-PLATFORM-AWS-INTEGRATION.md          ← Feature design (20 min)
└── cloudformation/
    └── shipsec-integration.yaml                ← One-click AWS deploy

scripts/
└── e2e-local-test.sh                           ← Test runner

e2e-tests/
├── alert-investigation.test.ts                ← OpenCode agent E2E
├── webhooks.test.ts                           ← Webhook E2E
├── fixtures/
│   └── guardduty-alert.json                   ← Sample data
└── scripts/
    └── setup-eng-104-env.ts                   ← Env setup wizard

backend/src/webhooks/
├── inbound-webhook.controller.ts              ← Public /webhooks/inbound/{path}
├── webhooks.service.ts                        ← Core logic
├── webhooks.controller.ts                     ← Admin endpoints
└── __tests__/                                 ← Unit tests

worker/src/components/ai/
├── opencode.ts                                ← Agent component
└── agent-stream-recorder.ts                   ← Stream handling
```

---

## 🔧 Key Concepts

### Smart Webhooks

**What**: Public HTTP endpoint that ingests JSON + runs custom parsing script + triggers workflow

**How**:

1. `POST /webhooks/inbound/wh_abc123...` receives JSON
2. Custom TypeScript parsingScript extracts fields
3. Temporal workflow triggered with parsed inputs
4. Workflow executes (agent, tools, etc.)
5. Results stored in webhook_deliveries table

**Why**: Decouples alert format from workflow input shape

### OpenCode Agent

**What**: Autonomous coding + security investigation agent (runs in Docker)

**Capabilities**:

- Lists available MCP tools
- Calls tools to gather info (AbuseIPDB, VirusTotal, AWS APIs)
- Reasons about findings
- Generates markdown report

**Integration**: Part of workflow as a node component

### MCP Tools

**What**: Tool protocol for agents (Claude's MCP standard)

**In ShipSec**:

- AbuseIPDB: Check IP reputation
- VirusTotal: Check files/URLs/IPs
- AWS CloudTrail: Query API activity
- AWS CloudWatch: Query logs
- Custom tools: User-defined

**How Agent Sees Them**: Via localhost gateway on host network

---

## 📊 Testing Scenarios

### Scenario 1: Local Unit Test

**Setup**: None needed (sample data fixture)
**Command**: `bun run test`
**Speed**: 2 seconds
**Coverage**: Webhook parsing, component execution

### Scenario 2: Local E2E Test

**Setup**: `bun run e2e-tests/scripts/setup-eng-104-env.ts` + `just dev start`
**Command**: `./scripts/e2e-local-test.sh alert-investigation`
**Speed**: 5-10 minutes
**Coverage**: Full workflow + agent execution with real LLM

### Scenario 3: Real AWS Integration

**Setup**: CloudFormation + real AWS credentials
**Command**: Trigger GuardDuty finding in AWS
**Speed**: 1-3 minutes per finding
**Coverage**: End-to-end with real alerts

### Scenario 4: Cloud Platform Testing

**Setup**: Deploy to staging environment
**Command**: Use dashboard UI to create integration
**Speed**: Click-based, 10 minutes setup
**Coverage**: User experience validation

---

## 🐛 Troubleshooting Quick Reference

| Symptom                  | Command                      | Fix                                                      |
| ------------------------ | ---------------------------- | -------------------------------------------------------- |
| Backend not responding   | `just dev logs`              | Check logs, restart with `just dev start`                |
| Webhook returns 404      | Copy webhook path            | Use exact `wh_abc123...` from creation response          |
| Agent doesn't execute    | Check Temporal UI            | View workflow trace at http://localhost:8081             |
| MCP tools unavailable    | Check INTERNAL_SERVICE_TOKEN | Verify env var in backend + worker                       |
| AWS credentials fail     | Check .env.eng-104           | Run `setup-eng-104-env.ts` again                         |
| SNS pending confirmation | Check AWS console            | Click confirmation link in email or use [Manual Confirm] |
| CloudFormation fails     | Check stack events in AWS    | Review error in AWS CloudFormation console               |

---

## 🎓 Learning Path

1. **Understand the flow**: Read [TESTING-QUICK-START.md](../TESTING-QUICK-START.md)
2. **Run locally**: Execute `./scripts/e2e-local-test.sh alert-investigation`
3. **Watch it work**: Open Temporal UI at http://localhost:8081
4. **Deep dive**: Read [E2E-TESTING-REAL-WORLD.md](../docs/E2E-TESTING-REAL-WORLD.md)
5. **Build cloud feature**: Use [CLOUD-PLATFORM-AWS-INTEGRATION.md](../docs/CLOUD-PLATFORM-AWS-INTEGRATION.md)

---

## 💡 Key Takeaways

✅ **Local testing works**: E2E tests pass, agents generate reports, everything is functional

✅ **Real AWS integration is ready**: CloudFormation template + API endpoints exist

✅ **Cloud platform is designed**: 8-step wizard flow, API specs, database schema all documented

⬜ **Next step**: Build dashboard UI for cloud customers (use design document)

---

## 📞 Support Resources

- **Architecture Questions**: Check [E2E-TESTING-REAL-WORLD.md](../docs/E2E-TESTING-REAL-WORLD.md) → Architecture section
- **AWS Setup Help**: Check [WEBHOOK-GUARDDUTY-SETUP.md](../docs/WEBHOOK-GUARDDUTY-SETUP.md) → Troubleshooting
- **Cloud Platform Design**: Check [CLOUD-PLATFORM-AWS-INTEGRATION.md](../docs/CLOUD-PLATFORM-AWS-INTEGRATION.md) → User Journey
- **Code References**: Each document has clickable file links

---

## 🚦 Status Summary

| Component            | Status            | Ready For         |
| -------------------- | ----------------- | ----------------- |
| Local E2E Testing    | ✅ Complete       | Testing now       |
| Real AWS Integration | ✅ Ready (Manual) | Self-hosted users |
| Cloud Platform UI    | ⬜ Design Ready   | Build this week   |
| Documentation        | ✅ Complete       | Reference         |
| Test Coverage        | ✅ Full           | Deployment        |

---

**Ready to get started?**

```bash
# This will take 5 minutes and show you everything works:
./scripts/e2e-local-test.sh alert-investigation
```

Then read [TESTING-QUICK-START.md](../TESTING-QUICK-START.md) for the full picture.
