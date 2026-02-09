# ShipSec Cloud Platform: AWS Integration Feature

How to make it seamless for SaaS customers to connect GuardDuty → ShipSec → Triage.

## User Journey

### For First-Time AWS Integration

```
1. Dashboard: Settings → Integrations
2. Click: "Connect AWS Account"
3. Wizard opens:

   Step 1: AWS Credentials
   ├─ Account ID: [input]
   ├─ Region: [us-east-1 ▼]
   └─ [Continue]

   Step 2: Create IAM Role (auto-generated trust)
   ├─ Copy IAM policy
   ├─ Go to AWS console → IAM → Roles
   ├─ Create role with name: ShipSecRole
   ├─ Paste policy
   └─ [Back / Continue]

   Step 3: Enable GuardDuty
   ├─ ☐ GuardDuty enabled in account
   ├─ [Go to AWS GuardDuty] → [Enable]
   └─ [Refresh / Continue]

   Step 4: Create Webhook
   ├─ Auto-generates: wh_abc123xyz...
   ├─ Shows: "Webhook created successfully"
   └─ [Continue]

   Step 5: Deploy to AWS
   ├─ [Deploy CloudFormation Stack]
   │  → Opens AWS in new tab
   │  → Stack name: shipsec-{org}-integration
   │  → Pre-filled parameters:
   │    • WebhookPath: wh_abc123xyz...
   │    • Domain: api.shipsec.ai
   ├─ User clicks [Create Stack] in AWS
   └─ [Poll / Close]

   Step 6: Confirm SNS
   ├─ Polling AWS SNS for subscription status...
   ├─ If pending:
   │  ├─ Show: "Check your email"
   │  ├─ Auto-retry every 10s
   │  └─ Or: [Manual Confirm] button
   └─ ✅ Confirmed!

   Step 7: Test Connection
   ├─ [Send Test Finding]
   │  └─ Creates sample GuardDuty finding in AWS
   ├─ Polling workflow status...
   └─ ✅ Success! Report generated

   Step 8: Finish
   ├─ Summary:
   │  • AWS Account: 123456789012
   │  • Region: us-east-1
   │  • Webhook: wh_abc123xyz...
   │  • Status: Active ✅
   ├─ [View Dashboard]
   └─ ✅ Integration Complete!
```

---

## Implementation Plan

### Phase 1: Backend APIs (Already Exist ✅)

**No changes needed.** We have:

- Webhook creation: `POST /webhooks/configurations`
- Webhook triggering: `POST /webhooks/inbound/{path}`
- Webhook management: `GET /webhooks/configurations`
- Workflow execution: Already via Temporal

**Add:**

- `POST /integrations/aws/test-finding` - Create sample GuardDuty finding
- `GET /integrations/aws/status` - Check if credentials valid + GuardDuty enabled

### Phase 2: Frontend UI (To Build)

**New Components:**

1. **IntegrationSetup.tsx**
   - Multi-step wizard
   - Step indicators
   - Progress tracking
   - Copy-to-clipboard for IAM policy

2. **AWSIntegrationWizard.tsx**
   - Handles each step
   - Shows prompts with links to AWS console
   - Auto-refreshes polling states

3. **WebhookManagement.tsx**
   - List created webhooks
   - Show webhook path (copy button)
   - View delivery history
   - Test webhook manually

4. **WorkflowTemplates.tsx**
   - "Deploy: AWS GuardDuty Triage" button
   - Auto-creates workflow with agent + tools

**Pages:**

- `Settings/Integrations/AWS` - Main UI
- `Webhooks` - Management dashboard
- `Workflows/Templates` - Pre-built triage workflow

### Phase 3: Automation (Backend Updates)

**When AWS integration enabled:**

```typescript
// Create webhook automatically
const webhook = await webhooksService.create({
  workflowId: automatedTriageWorkflowId,
  name: 'AWS GuardDuty Auto-Triage',
  description: 'Automatically triage GuardDuty findings',
  parsingScript: GUARDDUTY_PARSING_SCRIPT,
  expectedInputs: [{ id: 'alert', label: 'Finding', type: 'json', required: true }],
});

// Create triage workflow automatically
const workflow = await workflowsService.create({
  name: 'AWS GuardDuty Triage',
  description: 'Automated security triage for AWS GuardDuty',
  nodes: [
    ENTRYPOINT_NODE,
    ABUSEIPDB_TOOL_NODE,
    VIRUSTOTAL_TOOL_NODE,
    AWS_CLOUDTRAIL_NODE,
    AWS_CLOUDWATCH_NODE,
    OPENCODE_AGENT_NODE,
  ],
  edges: TOOL_CONNECTIONS,
});

// Return webhook path for CloudFormation
return {
  webhookId: webhook.id,
  webhookPath: webhook.webhookPath,
  workflowId: workflow.id,
  cloudFormationUrl: generateCloudFormationLink(webhook.webhookPath),
};
```

---

## CloudFormation Integration

### Current Stack

Located: `docs/cloudformation/shipsec-integration.yaml`

Creates in customer AWS:

- SNS topic
- EventBridge rule
- IAM role

### Improvements for Cloud Users

1. **Auto-generate CloudFormation link**

   ```typescript
   function generateCloudFormationLink(webhookPath: string): string {
     const template = encodeURIComponent(JSON.stringify(CLOUDFORMATION_TEMPLATE));
     const params = new URLSearchParams({
       ShipSecWebhookPath: webhookPath,
       ShipSecWebhookDomain: 'api.shipsec.ai',
     });
     return `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=...&${params}`;
   }
   ```

2. **Custom stack name**

   ```
   shipsec-org-{organizationId}-integration
   ```

3. **Add SNS auto-confirm for cloud**
   - We control SNS endpoint (api.shipsec.ai)
   - Can auto-confirm subscriptions
   - For self-hosted: user manually confirms

---

## Database Schema (Already Exists)

```sql
-- webhook_configurations
CREATE TABLE webhook_configurations (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  workflow_id UUID REFERENCES workflows(id),
  webhook_path VARCHAR(255) UNIQUE,
  parsing_script TEXT,
  status VARCHAR(20),
  created_at TIMESTAMP,
  created_by VARCHAR(255)
);

-- webhook_deliveries
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY,
  webhook_id UUID REFERENCES webhook_configurations(id),
  payload JSONB,
  response JSONB,
  status VARCHAR(20),
  workflow_run_id UUID,
  created_at TIMESTAMP
);

-- NEW: aws_integrations
CREATE TABLE aws_integrations (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  account_id VARCHAR(12),
  region VARCHAR(50),
  webhook_id UUID REFERENCES webhook_configurations(id),
  workflow_id UUID REFERENCES workflows(id),
  status VARCHAR(20), -- 'pending', 'active', 'error'
  cloudformation_stack_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## API Reference (New Endpoints)

### Create AWS Integration

```
POST /integrations/aws
Headers: Authorization: Bearer ...
Body: {
  accountId: "123456789012",
  region: "us-east-1"
}
Response: {
  integrationId: "int_xyz",
  webhookPath: "wh_abc123",
  cloudFormationUrl: "https://console.aws.amazon.com/cloudformation/...",
  steps: [
    { name: "Create IAM Role", status: "pending" },
    { name: "Enable GuardDuty", status: "pending" },
    { name: "Deploy CloudFormation", status: "pending" }
  ]
}
```

### Get Integration Status

```
GET /integrations/aws/{integrationId}
Response: {
  integrationId: "int_xyz",
  status: "active" | "pending" | "error",
  webhookPath: "wh_abc123",
  workflowId: "wf_xyz",
  cloudFormationStackStatus: "CREATE_IN_PROGRESS" | "CREATE_COMPLETE",
  snsSubscriptionStatus: "Confirmed" | "PendingConfirmation",
  lastTestAt: "2024-02-08T10:30:00Z",
  lastTestStatus: "success" | "failed"
}
```

### Test AWS Integration

```
POST /integrations/aws/{integrationId}/test
Response: {
  success: true,
  message: "Test finding created and workflow triggered",
  workflowRunId: "run_abc123"
}
```

### List AWS Integrations

```
GET /integrations/aws
Response: [
  {
    integrationId: "int_xyz",
    accountId: "123456789012",
    region: "us-east-1",
    status: "active",
    createdAt: "2024-02-08T10:00:00Z"
  }
]
```

---

## Email / Notifications

### SNS Confirmation Email

Subject: `AWS Notification - Subscription Confirmation`

Body:

```
You have chosen to subscribe to the topic:
arn:aws:sns:us-east-1:123456789012:shipsec-guardduty-findings

To confirm this subscription, click or paste the following link in your web browser:
https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&...
```

**UI Response:**

1. Show: "Check your email to confirm SNS subscription"
2. Provide: [Manual Confirm] button that directly confirms via SNS API
3. Auto-retry: Poll every 10 seconds for 5 minutes

### Integration Complete Email

Subject: `🎉 AWS Integration Setup Complete - ShipSec`

```
Hi [Name],

Your AWS GuardDuty integration is now active!

GuardDuty findings will automatically be triaged by the ShipSec OpenCode Agent.

Next steps:
1. View your triage workflow: [Link]
2. Configure alert rules: [Link]
3. Read the guide: [Link]

Questions? Check our AWS integration guide or contact support.

— ShipSec Team
```

---

## Observability for Users

### Dashboard: Integration Status Widget

```
┌─ AWS Integrations ──────────────────────────────┐
│                                                  │
│ Account: 123456789012 (us-east-1)              │
│ Status: ✅ Active                               │
│ Webhook: wh_abc123xyz... [Copy]                │
│                                                  │
│ Last Finding: 2 hours ago                       │
│ Processed This Week: 42 findings                │
│                                                  │
│ [View Triage Workflow] [Test] [Manage]         │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Webhook Deliveries Dashboard

```
┌─ Recent GuardDuty Findings ─────────────────────┐
│                                                  │
│ [Today, 2:30 PM]                               │
│ Recon:EC2/PortProbe...                         │
│ Severity: 5.3                                   │
│ Status: ✅ Triaged (3 min)                      │
│ Report: EC2 instance 1.2.3.4 probed 4 IPs      │
│                                                  │
│ [Today, 1:15 PM]                               │
│ UnauthorizedAccess:EC2/RDPBruteForce            │
│ Severity: 7.8                                   │
│ Status: ⚠️ Review Recommended                   │
│ Report: 1000+ failed RDP attempts from ...      │
│                                                  │
│ [View All] [Export]                            │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Workflow Execution Logs

From `/workflows/runs/{runId}/trace`:

```json
{
  "workflowId": "wf_guardduty_triage",
  "runId": "run_abc123",
  "triggeredBy": "webhook",
  "status": "COMPLETED",
  "startedAt": "2024-02-08T10:30:00Z",
  "completedAt": "2024-02-08T10:32:45Z",
  "events": [
    {
      "nodeId": "ingest",
      "type": "STARTED",
      "timestamp": "2024-02-08T10:30:00Z"
    },
    {
      "nodeId": "abuseipdb",
      "type": "COMPLETED",
      "timestamp": "2024-02-08T10:30:05Z",
      "output": {
        "ipAddress": "198.51.100.23",
        "abuseConfidence": 75,
        "usageType": "Data Center",
        "threats": ["Spamming", "Probing"]
      }
    },
    {
      "nodeId": "agent",
      "type": "STARTED",
      "timestamp": "2024-02-08T10:30:06Z"
    },
    {
      "nodeId": "agent",
      "type": "AGENT_TOOL_CALL",
      "timestamp": "2024-02-08T10:30:10Z",
      "tool": "abuseipdb.check",
      "input": {"ip": "198.51.100.23"},
      "output": {...}
    },
    {
      "nodeId": "agent",
      "type": "AGENT_MESSAGE",
      "timestamp": "2024-02-08T10:30:20Z",
      "message": "The IP 198.51.100.23 has an AbuseIPDB confidence of 75%, indicating high likelihood of malicious activity..."
    },
    {
      "nodeId": "agent",
      "type": "COMPLETED",
      "timestamp": "2024-02-08T10:32:45Z",
      "outputSummary": {
        "report": "# EC2 Port Probe Analysis\n\n## Summary\nEC2 instance i-0abc1234def567890 at 3.91.22.11 received port probes from 198.51.100.23\n\n## Findings\n- IP is data center with 75% abuse confidence\n- Probed SSH (port 22) and RDP (port 3389)\n- No successful intrusions detected\n\n## Recommendations\n1. Block 198.51.100.23 at security group level\n2. Review CloudTrail for other activity from this IP\n3. Monitor instance for suspicious activity"
      }
    }
  ]
}
```

---

## Security Considerations

### Cross-Account Trust

For cloud (multi-tenant), customers grant ShipSec cross-account role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::SHIPSEC_ACCOUNT:role/ShipSecWorker"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "org_xyz_1234567890"
        }
      }
    }
  ]
}
```

### Webhook Security

- **Path**: Unguessable (128-bit random string)
- **No authentication**: Security by obscurity
- **SNS signature validation**: Optional (SNS IP whitelist in AWS)
- **Rate limiting**: Per webhook + per organization

---

## Testing Checklist

- [ ] Webhook created via API
- [ ] Manual POST to webhook triggers workflow
- [ ] Workflow trace shows all nodes executing
- [ ] OpenCode agent receives MCP tools
- [ ] Agent generates report with markdown
- [ ] CloudFormation stack creates in AWS
- [ ] SNS subscription to webhook confirms
- [ ] Real GuardDuty finding triggers workflow
- [ ] Dashboard shows integration status
- [ ] Email notifications work
- [ ] Webhook delivery history visible

---

## Files Created for You

✅ [docs/TESTING-QUICK-START.md](../TESTING-QUICK-START.md) - 2-min overview
✅ [docs/TESTING-SUMMARY.md](../docs/TESTING-SUMMARY.md) - Full guide
✅ [docs/WEBHOOK-GUARDDUTY-SETUP.md](../docs/WEBHOOK-GUARDDUTY-SETUP.md) - AWS setup
✅ [docs/E2E-TESTING-REAL-WORLD.md](../docs/E2E-TESTING-REAL-WORLD.md) - Deep dive
✅ [docs/cloudformation/shipsec-integration.yaml](../docs/cloudformation/shipsec-integration.yaml) - One-click deploy
✅ [scripts/e2e-local-test.sh](../scripts/e2e-local-test.sh) - Local test runner

---

## Next Steps

1. **Test locally**: `./scripts/e2e-local-test.sh alert-investigation`
2. **Build dashboard UI** using wizard design above
3. **Add new API endpoints** for integration management
4. **Add cloud-specific features** (cross-account, auto-confirm SNS)
5. **Test end-to-end** with real AWS account
6. **Document for customers** (use guides above)

---

**Summary**: Everything is ready for local testing. The cloud platform feature is designed and documented. Build the dashboard UI following the wizard flow, add API endpoints, and you're done.
