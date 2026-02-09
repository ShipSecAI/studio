# End-to-End Testing: Real-World AWS Integration

This guide covers testing the OpenCode Agent with real AWS services, webhooks, and actual security triage workflows.

## Architecture Overview

```
Real AWS Account
  ├── GuardDuty (generates findings)
  └── EventBridge → SNS/Webhook → ShipSec Backend
        ↓
    Webhook Ingestion (inbound-webhook.controller)
        ↓
    Smart Webhook Parser (TypeScript sandbox)
        ↓
    Temporal Workflow
        ├── MCP Tools (AbuseIPDB, VirusTotal, AWS APIs)
        ├── OpenCode Agent Docker
        └── Result Aggregation
        ↓
    ShipSec Cloud Dashboard
```

## Local Testing Setup

### 1. Prerequisites

You have:

- **OpenCode Agent Component**: `ghcr.io/shipsecai/opencode:1.1.53`
- **E2E Test**: `e2e-tests/alert-investigation.test.ts`
- **Smart Webhook System**: For custom parsing + workflow triggering
- **MCP Tools**: AWS CloudTrail, CloudWatch, AbuseIPDB, VirusTotal

### 2. Configure Environment

Create/update `.env.eng-104`:

```bash
# Required API Keys
ZAI_API_KEY=<your-z.ai-api-key>
ABUSEIPDB_API_KEY=<your-abuseipdb-key>
VIRUSTOTAL_API_KEY=<your-virustotal-key>

# AWS Credentials (choose one approach)
# Option A: Permanent IAM user credentials
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Option B: Temporary STS credentials (recommended)
AWS_ACCESS_KEY_ID=ASIA...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...

# AWS Configuration
AWS_REGION=us-east-1

# Optional: Override MCP images
# AWS_CLOUDTRAIL_MCP_IMAGE=shipsec/mcp-aws-cloudtrail:latest
# AWS_CLOUDWATCH_MCP_IMAGE=shipsec/mcp-aws-cloudwatch:latest

# Run E2E tests
RUN_E2E=true
```

**To generate credentials interactively:**

```bash
cd /Users/betterclever/shipsec/shipsec-studio
bun run e2e-tests/scripts/setup-eng-104-env.ts
```

### 3. Start Infrastructure

```bash
just instance show          # Confirm instance (default: 0)
just dev stop all           # Clean slate
just dev start              # Start instance 0
```

**URLs:**

- Frontend: http://localhost:5173
- Backend: http://localhost:3211
- Temporal UI: http://localhost:8081

### 4. Run E2E Tests

```bash
# Test with sample GuardDuty alert
RUN_E2E=true bun run test:e2e -- alert-investigation.test.ts

# Or just webhook tests
RUN_E2E=true bun run test:e2e -- webhooks.test.ts
```

## Integration: AWS GuardDuty → ShipSec

### Step 1: Create AWS IAM Role for GuardDuty Event Delivery

In your AWS account:

```bash
# Create trust relationship JSON
cat > trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
  --role-name GuardDutyToShipSecRole \
  --assume-role-policy-document file://trust-policy.json

# Attach policy to allow SNS publish
aws iam put-role-policy \
  --role-name GuardDutyToShipSecRole \
  --policy-name GuardDutyToShipSecPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "sns:Publish",
        "Resource": "arn:aws:sns:*:*:*"
      }
    ]
  }'
```

### Step 2: Create SNS Topic

```bash
# Create SNS topic for GuardDuty findings
TOPIC_ARN=$(aws sns create-topic \
  --name shipsec-guardduty-findings \
  --query 'TopicArn' --output text)

echo "Topic ARN: $TOPIC_ARN"

# Create HTTP subscription (point to your webhook endpoint)
# For local testing with ngrok:
WEBHOOK_URL="https://<your-ngrok-domain>.ngrok.io/webhooks/inbound/<webhook-path>"

aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol https \
  --notification-endpoint "$WEBHOOK_URL"
```

### Step 3: Create EventBridge Rule for GuardDuty

```bash
# Create EventBridge rule
aws events put-rule \
  --name guardduty-to-shipsec \
  --event-pattern '{
    "source": ["aws.guardduty"],
    "detail-type": ["GuardDuty Finding"],
    "detail": {
      "type": ["Recon:EC2/PortProbeUnprotectedPort", "UnauthorizedAccess:EC2/RDPBruteForce"]
    }
  }' \
  --state ENABLED

# Set SNS topic as target
aws events put-targets \
  --rule guardduty-to-shipsec \
  --targets "Id"="1","Arn"="$TOPIC_ARN","RoleArn"="arn:aws:iam::<ACCOUNT_ID>:role/GuardDutyToShipSecRole"
```

### Step 4: Create ShipSec Smart Webhook

Create a webhook configuration via the API:

```bash
# Define the workflow first (alert investigation)
WORKFLOW_ID=$(curl -s -X POST http://localhost:3211/workflows \
  -H 'Content-Type: application/json' \
  -H 'x-internal-token: local-internal-token' \
  -d @workflow-definition.json | jq -r '.id')

# Create smart webhook with GuardDuty parsing script
curl -X POST http://localhost:3211/webhooks/configurations \
  -H 'Content-Type: application/json' \
  -H 'x-internal-token: local-internal-token' \
  -d '{
    "workflowId": "'$WORKFLOW_ID'",
    "name": "GuardDuty Alert Parser",
    "description": "Ingests GuardDuty findings and triggers triage workflow",
    "parsingScript": "
      export async function script(input) {
        const { payload, headers } = input;

        // Parse SNS message (GuardDuty sends via SNS wrapper)
        let finding;
        try {
          const message = JSON.parse(payload.Message || payload);
          finding = message.detail || message;
        } catch {
          finding = payload;
        }

        return {
          alert: finding,
          severity: finding.severity || 0,
          type: finding.type || \"Unknown\",
          timestamp: finding.createdAt || new Date().toISOString()
        };
      }
    ",
    "expectedInputs": [
      { "id": "alert", "label": "Finding", "type": "json", "required": true },
      { "id": "severity", "label": "Severity", "type": "number", "required": false },
      { "id": "type", "label": "Finding Type", "type": "text", "required": false }
    ]
  }'
```

Response includes `webhookPath` (e.g., `wh_abc123...`).

### Step 5: Local Testing with ngrok

For local testing without public AWS account access:

```bash
# Terminal 1: Start ShipSec
just dev start

# Terminal 2: Expose webhook via ngrok
ngrok http 3211

# Copy ngrok URL, e.g., https://abc-123-def.ngrok.io

# Terminal 3: Update SNS subscription
WEBHOOK_PATH="wh_your-webhook-path"
NGROK_URL="https://abc-123-def.ngrok.io"

aws sns set-subscription-attributes \
  --subscription-arn "arn:aws:sns:us-east-1:ACCOUNT:shipsec-guardduty-findings:..." \
  --attribute-name Endpoint \
  --attribute-value "$NGROK_URL/webhooks/inbound/$WEBHOOK_PATH"

# Confirm subscription (check SNS in AWS console)

# Terminal 4: Simulate GuardDuty finding or trigger one manually
aws events put-events --entries file://test-event.json
```

## Testing Scenarios

### Scenario 1: Manual Webhook Test (No AWS Required)

```bash
# Get webhook path from creation response
WEBHOOK_PATH="wh_xyz123"
BACKEND_URL="http://localhost:3211"

# Send GuardDuty-like payload
curl -X POST "$BACKEND_URL/webhooks/inbound/$WEBHOOK_PATH" \
  -H 'Content-Type: application/json' \
  -d '{
    "Message": "{\"detail\": {\"id\": \"arn:aws:guardduty:us-east-1:123456789012:detector/.../finding/abc123\", \"type\": \"Recon:EC2/PortProbeUnprotectedPort\", \"severity\": 5.3, \"resource\": {\"instanceDetails\": {\"publicIp\": \"3.91.22.11\"}}, \"service\": {\"action\": {\"portProbeAction\": {\"portProbeDetails\": [{\"localPort\": 22, \"remoteIpDetails\": {\"ipAddressV4\": \"198.51.100.23\"}}]}}}}}"
  }'

# Returns: { "status": "delivered", "runId": "..." }

# Poll workflow execution
RUN_ID="..."
curl -s "$BACKEND_URL/workflows/runs/$RUN_ID/status" \
  -H 'x-internal-token: local-internal-token' | jq .

# View agent trace/logs
curl -s "$BACKEND_URL/workflows/runs/$RUN_ID/trace" \
  -H 'x-internal-token: local-internal-token' | jq .
```

### Scenario 2: E2E Test (Full Stack)

```bash
# Runs complete workflow with all tools connected
RUN_E2E=true bun run test:e2e -- alert-investigation.test.ts

# Test runs:
# 1. Creates secrets for API keys
# 2. Creates workflow with tools + OpenCode agent
# 3. Injects GuardDuty sample alert
# 4. Polls execution (8 min timeout)
# 5. Verifies agent output (report with Summary/Findings/Actions)
```

### Scenario 3: Real AWS Account + Live GuardDuty

1. **Trigger an actual GuardDuty finding** (port scan test):

   ```bash
   # From an EC2 instance, run a port scan
   # Or use: https://docs.aws.amazon.com/guardduty/latest/ug/sample-findings.html
   ```

2. **Monitor workflow execution**:
   - Frontend: http://localhost:5173 → Workflows → Recent Runs
   - Temporal UI: http://localhost:8081 → Check agent traces

3. **Validate results**:
   - Check workflow trace for agent execution
   - Verify MCP tools were called (AbuseIPDB, VirusTotal, CloudTrail)
   - Confirm agent generated markdown report

## AWS Permissions Required

For the E2E test to work with real AWS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "guardduty:GetFindings",
        "guardduty:ListFindings",
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeNetworkInterfaces",
        "cloudtrail:LookupEvents",
        "logs:FilterLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ],
      "Resource": "*"
    }
  ]
}
```

## Cloud Platform: Making It Easy for Users

### For ShipSec Cloud Users

**Goal**: Customers can set up real AWS integration in 5 minutes.

#### 1. CloudFormation Template (One-Click Setup)

Create `docs/cloudformation/shipsec-integration.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'ShipSec AWS Integration - Enables GuardDuty → ShipSec triage'

Parameters:
  ShipSecWebhookPath:
    Type: String
    Description: 'Webhook path from ShipSec dashboard (e.g., wh_xyz123)'
  ShipSecWebhookDomain:
    Type: String
    Default: 'api.shipsec.ai'
    Description: 'ShipSec API domain'

Resources:
  GuardDutyRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: events.amazonaws.com
            Action: 'sts:AssumeRole'
      Policies:
        - PolicyName: GuardDutyToShipSec
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: 'sns:Publish'
                Resource: !GetAtt ShipSecTopic.TopicArn

  ShipSecTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: shipsec-guardduty-findings

  ShipSecSubscription:
    Type: AWS::SNS::Subscription
    Properties:
      TopicArn: !GetAtt ShipSecTopic.TopicArn
      Protocol: https
      Endpoint: !Sub 'https://${ShipSecWebhookDomain}/webhooks/inbound/${ShipSecWebhookPath}'

  GuardDutyRule:
    Type: AWS::Events::Rule
    Properties:
      Description: 'Forward GuardDuty findings to ShipSec'
      EventPattern:
        source:
          - aws.guardduty
        detail-type:
          - GuardDuty Finding
      State: ENABLED
      Targets:
        - Arn: !GetAtt ShipSecTopic.TopicArn
          RoleArn: !GetAtt GuardDutyRole.Arn

Outputs:
  TopicArn:
    Value: !GetAtt ShipSecTopic.TopicArn
  RuleName:
    Value: !Ref GuardDutyRule
```

#### 2. Dashboard Integration

In the ShipSec dashboard (Frontend):

```
Settings → Integrations → AWS
  ├── Step 1: Enter AWS Account ID & Region
  ├── Step 2: [Deploy CloudFormation] button
  │   → Opens AWS console with pre-filled template
  │   → User clicks "Create Stack"
  │   → Polls for stack completion
  ├── Step 3: Create webhook configuration
  │   → Generates unique webhook path
  │   → Shows: https://api.shipsec.ai/webhooks/inbound/wh_XYZ
  ├── Step 4: Test connection
  │   → Sends test GuardDuty payload
  │   → Verifies workflow execution
  └── Step 5: Done! Findings auto-triage
```

#### 3. Webhook Configuration UI

```
Workflows → [Select Triage Workflow] → Create Webhook
  ├── Name: "GuardDuty Triage"
  ├── Parsing Script: [Template] GuardDuty Alert Parser
  │   (auto-fills SNS message parsing)
  ├── Model Config: [Dropdown] Z.AI GLM-4.7 (recommended)
  ├── Auto Approve: [Toggle] ON
  └── Create Webhook
       → Returns unique path
       → Shows copy button for AWS setup
```

#### 4. Setup Script for Self-Hosted

For customers running self-hosted ShipSec:

```bash
#!/bin/bash
# shipsec-aws-setup.sh

set -e

echo "🔧 ShipSec AWS Integration Setup"
echo ""

# Get inputs
read -p "AWS Account ID: " AWS_ACCOUNT_ID
read -p "AWS Region (default: us-east-1): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

read -p "ShipSec API Domain (e.g., api.shipsec.ai or localhost:3211): " SHIPSEC_DOMAIN
read -p "Webhook Path (from ShipSec dashboard): " WEBHOOK_PATH

# Deploy CloudFormation
aws cloudformation create-stack \
  --stack-name shipsec-integration \
  --template-body file://shipsec-integration.yaml \
  --parameters \
    ParameterKey=ShipSecWebhookPath,ParameterValue=$WEBHOOK_PATH \
    ParameterKey=ShipSecWebhookDomain,ParameterValue=$SHIPSEC_DOMAIN \
  --region $AWS_REGION

echo "✅ Stack created! Waiting for completion..."
aws cloudformation wait stack-create-complete \
  --stack-name shipsec-integration \
  --region $AWS_REGION

echo "✅ AWS integration complete!"
```

#### 5. Documentation

Create `docs/guides/aws-integration.md`:

- Screenshots of each step
- Troubleshooting (SNS subscription confirmation, webhook testing)
- Example findings & auto-triage results
- API reference for advanced customization

## Monitoring & Debugging

### View Webhook Deliveries

```bash
curl -s http://localhost:3211/webhooks/configurations/<WEBHOOK_ID>/deliveries \
  -H 'x-internal-token: local-internal-token' | jq .
```

### Check MCP Tool Discovery

In Temporal UI, find the OpenCode agent execution:

```
Workflow: guardduty-triage
  ├── Task: run-component
  │   └── Activity: RunComponentActivity
  │       ├── Input: { componentRef: 'core.ai.opencode', ... }
  │       ├── Logs:
  │       │   [OpenCode] Listing MCP tools before run...
  │       │   shipsec-gateway:
  │       │   - abuseipdb.check (tool)
  │       │   - virustotal.lookup (tool)
  │       │   - aws.describe-instances (tool)
  │       └── Result: { report: "...", rawOutput: "..." }
```

### Real-Time Logs

```bash
# Terminal logs
just dev logs

# Temporal event stream
curl -s http://localhost:8081/api/v1/namespaces/default/workflows/WORKFLOW_ID/history
```

## Deployment Checklist

**Local Testing:**

- [ ] `.env.eng-104` configured with API keys
- [ ] `just dev start` running
- [ ] Webhook created via API
- [ ] Manual webhook POST succeeds
- [ ] Workflow trace shows agent output
- [ ] E2E test passes: `RUN_E2E=true bun run test:e2e`

**Cloud Deployment:**

- [ ] Dockerfile builds with OpenCode image
- [ ] Worker has network access to localhost gateway
- [ ] Secrets manager configured for API keys
- [ ] CloudFormation template tested in target AWS account
- [ ] Dashboard webhook creation UI works
- [ ] SNS subscriptions auto-confirmed (or manual check in cloud)

## Troubleshooting

| Issue                    | Solution                                                             |
| ------------------------ | -------------------------------------------------------------------- |
| Webhook POST returns 404 | Webhook path typo or not created yet                                 |
| Workflow doesn't start   | Check parsing script syntax in test endpoint first                   |
| MCP tools not available  | Verify gateway token generation; check firewall                      |
| Agent times out          | OpenCode image not available; check Docker registry                  |
| AWS credentials invalid  | Verify IAM user has required permissions; check session token expiry |

---

**Ready to test?** Start with:

```bash
just instance show
just dev start
RUN_E2E=true bun run test:e2e -- alert-investigation.test.ts
```
