# AWS GuardDuty → ShipSec Webhook Setup

Quick reference for connecting real AWS GuardDuty findings to ShipSec.

## Quick Start (5 minutes)

### 1. Create ShipSec Webhook (Backend)

```bash
# Make sure backend is running
just dev start

# Create a workflow (or use existing triage workflow)
WORKFLOW_ID="<your-workflow-id>"

# Create webhook via API
WEBHOOK_RESPONSE=$(curl -s -X POST http://localhost:3211/webhooks/configurations \
  -H 'Content-Type: application/json' \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "workflowId": "'$WORKFLOW_ID'",
    "name": "GuardDuty to ShipSec",
    "description": "Ingest AWS GuardDuty findings",
    "parsingScript": "export async function script(input) { const msg = JSON.parse(input.payload.Message || input.payload); return { alert: msg.detail || msg }; }",
    "expectedInputs": [{"id": "alert", "label": "Finding", "type": "json", "required": true}]
  }')

WEBHOOK_PATH=$(echo $WEBHOOK_RESPONSE | jq -r '.webhookPath')
WEBHOOK_ID=$(echo $WEBHOOK_RESPONSE | jq -r '.id')

echo "✅ Webhook created!"
echo "Path: $WEBHOOK_PATH"
echo "ID: $WEBHOOK_ID"
```

### 2. Create AWS Resources (One-Time Setup)

#### Option A: CloudFormation (Easiest)

```bash
# Use the template from docs/cloudformation/shipsec-integration.yaml
# Or create manually below:

aws cloudformation deploy \
  --template-file docs/cloudformation/shipsec-integration.yaml \
  --stack-name shipsec-guardduty \
  --parameter-overrides \
    ShipSecWebhookPath=$WEBHOOK_PATH \
    ShipSecWebhookDomain=api.shipsec.ai
```

#### Option B: Manual AWS Setup

```bash
# 1. Create IAM role for EventBridge → SNS
aws iam create-role \
  --role-name GuardDutyToShipSecRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "events.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam put-role-policy \
  --role-name GuardDutyToShipSecRole \
  --policy-name AllowSNSPublish \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:*:*:shipsec-*"
    }]
  }'

# 2. Create SNS topic
TOPIC_ARN=$(aws sns create-topic \
  --name shipsec-guardduty-findings \
  --region us-east-1 \
  --query 'TopicArn' --output text)

echo "Topic: $TOPIC_ARN"

# 3. Subscribe webhook endpoint
aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol https \
  --notification-endpoint "https://api.shipsec.ai/webhooks/inbound/$WEBHOOK_PATH" \
  --region us-east-1

# 4. Create EventBridge rule (catches GuardDuty findings)
aws events put-rule \
  --name guardduty-to-shipsec \
  --event-pattern '{
    "source": ["aws.guardduty"],
    "detail-type": ["GuardDuty Finding"],
    "detail": {"severity": [{"numeric": [">", 4]}]}
  }' \
  --state ENABLED \
  --region us-east-1

# 5. Set SNS as target
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws events put-targets \
  --rule guardduty-to-shipsec \
  --targets "Id"="1","Arn"="$TOPIC_ARN","RoleArn"="arn:aws:iam::$ACCOUNT_ID:role/GuardDutyToShipSecRole" \
  --region us-east-1
```

### 3. Confirm SNS Subscription

```bash
# Check AWS console: SNS → Topics → shipsec-guardduty-findings → Subscriptions
# Status should be "Confirmed" or "PendingConfirmation"

# If pending, AWS sent email - check inbox and confirm link
# Or auto-confirm via API (not recommended for production):
aws sns set-subscription-attributes \
  --subscription-arn "arn:aws:sns:us-east-1:ACCOUNT:shipsec-guardduty-findings:SUBSCRIPTION_ID" \
  --attribute-name RawMessageDelivery \
  --attribute-value "true"
```

### 4. Test the Connection

```bash
# Option A: Manual webhook POST (safest)
curl -X POST "http://localhost:3211/webhooks/inbound/$WEBHOOK_PATH" \
  -H 'Content-Type: application/json' \
  -d '{
    "Message": "{\"detail\": {\"id\": \"finding-1\", \"type\": \"Recon:EC2/PortProbeUnprotectedPort\", \"severity\": 5.3, \"resource\": {\"instanceDetails\": {\"publicIp\": \"1.2.3.4\"}}, \"service\": {\"action\": {\"portProbeAction\": {\"portProbeDetails\": [{\"localPort\": 22, \"remoteIpDetails\": {\"ipAddressV4\": \"8.8.8.8\"}}]}}}}}"
  }'

# Response: { "status": "delivered", "runId": "..." }

# Option B: Trigger real GuardDuty finding (requires test instance or actual attack)
# See: https://docs.aws.amazon.com/guardduty/latest/ug/guardduty-findings.html
```

### 5. Monitor Execution

```bash
# Poll workflow status
RUN_ID="<from-test-response>"
curl -s "http://localhost:3211/workflows/runs/$RUN_ID/status" \
  -H 'x-internal-token: local-internal-token'

# View execution trace
curl -s "http://localhost:3211/workflows/runs/$RUN_ID/trace" \
  -H 'x-internal-token: local-internal-token' | jq '.events'

# Open Temporal UI
open http://localhost:8081
```

## Local Testing (No AWS Account Required)

Use the fixture data instead:

```bash
# E2E test with sample GuardDuty alert
RUN_E2E=true bun run test:e2e -- alert-investigation.test.ts

# Or manually:
bun run e2e-tests/scripts/setup-eng-104-env.ts
./scripts/e2e-local-test.sh alert-investigation
```

## Testing with Real AWS (With Real Account)

### Prerequisites

- AWS account with GuardDuty enabled
- IAM user with permissions (see below)
- Real AWS credentials in `.env.eng-104`

### Permissions Needed

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:SetSubscriptionAttributes",
        "sns:PublishBatch",
        "events:PutRule",
        "events:PutTargets",
        "events:ListRules"
      ],
      "Resource": "*"
    }
  ]
}
```

### Trigger Real Finding

```bash
# From an EC2 instance, run a port scan (generates GuardDuty finding):
nmap 10.0.0.0/8

# Or use AWS CLI to generate sample finding:
aws guardduty create-sample-findings \
  --detector-id <DETECTOR_ID> \
  --finding-types "Recon:EC2/PortProbeUnprotectedPort" \
  --region us-east-1

# Monitor in AWS Console:
# GuardDuty → Findings → Look for "Recon:EC2/PortProbeUnprotectedPort"

# Monitor in ShipSec:
# Check backend logs: just dev logs
# Check Temporal UI: http://localhost:8081
```

## Troubleshooting

| Symptom                                      | Cause                                       | Fix                                                                    |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Webhook returns 404                          | Path typo or not created                    | Copy exact path from webhook creation response                         |
| SNS says "PendingConfirmation"               | AWS waiting for confirmation                | Check email inbox for SNS confirmation link                            |
| Webhook POST succeeds but no workflow starts | Parsing script error                        | Test script via `/webhooks/configurations/test-script` endpoint        |
| EventBridge rule not firing                  | GuardDuty not enabled or rule pattern wrong | Check GuardDuty console; adjust event-pattern severity threshold       |
| Agent not receiving MCP tools                | Gateway connection issue                    | Check if `localhost` is reachable from Docker; verify token generation |

## AWS Integration Dashboard (Cloud Platform)

For ShipSec cloud users, the setup is automated:

1. **Dashboard**: Settings → Integrations → AWS
2. **Step 1**: Grant ShipSec permissions (IAM role + trust)
3. **Step 2**: Enable GuardDuty
4. **Step 3**: [Auto-create webhook]
5. **Done**: Findings auto-triage

Internally, this:

- Assumes IAM role with cross-account access
- Creates SNS topic in customer account
- Subscribes to GuardDuty findings
- Deploys triage workflow
- Returns webhook URL for customer's EventBridge

## API Reference

### List Webhooks

```bash
curl http://localhost:3211/webhooks/configurations \
  -H 'x-internal-token: local-internal-token'
```

### Get Webhook Deliveries

```bash
curl "http://localhost:3211/webhooks/configurations/$WEBHOOK_ID/deliveries" \
  -H 'x-internal-token: local-internal-token'
```

### Test Parsing Script

```bash
curl -X POST http://localhost:3211/webhooks/configurations/test-script \
  -H 'Content-Type: application/json' \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "parsingScript": "export async function script(input) { return { test: true }; }",
    "testPayload": {"foo": "bar"},
    "testHeaders": {"x-github-event": "push"}
  }'
```

## Next Steps

- ✅ Webhook created
- ✅ AWS resources deployed
- ⬜ Configure triage workflow (agent, tools, prompts)
- ⬜ Set up monitoring/alerting on triage results
- ⬜ Document findings for compliance

---

**Questions?** Check full guide: [E2E-TESTING-REAL-WORLD.md](./E2E-TESTING-REAL-WORLD.md)
