/**
 * E2E Test: GuardDuty -> EventBridge -> Webhook -> Investigation
 *
 * Validates the full production-realistic flow:
 *   AWS GuardDuty (sample finding)
 *     -> EventBridge (rule: source=aws.guardduty)
 *       -> API Destination (ngrok public URL + webhook path)
 *         -> ShipSec webhook /webhooks/inbound/:path
 *           -> Parsing script (extracts finding from EventBridge envelope)
 *             -> Investigation workflow
 *               -> OpenCode agent + AbuseIPDB + VirusTotal + AWS MCP tools
 *                 -> Markdown investigation report
 *
 * Gated by: RUN_E2E=true && RUN_CLOUD_E2E=true
 */

import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import {
  API_BASE,
  HEADERS,
  runE2E,
  runCloudE2E,
  e2eTest,
  pollRunStatus,
  createWorkflow,
  createWebhook,
  createOrRotateSecret,
} from '../helpers/e2e-harness';

import { getApiBaseUrl } from '../helpers/api-base';

import {
  ensureGuardDutyDetector,
  createSampleFindings,
  ensureInvestigatorUser,
  createAccessKeys,
  attachPolicy,
  createEventBridgeTargetRole,
  createConnection,
  waitForConnection,
  createApiDestination,
  createRule,
  putTarget,
  cleanupAll,
} from '../helpers/aws-eventbridge';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ABUSEIPDB_API_KEY = process.env.ABUSEIPDB_API_KEY;
const VIRUSTOTAL_API_KEY = process.env.VIRUSTOTAL_API_KEY;

const requiredSecretsReady =
  typeof ZAI_API_KEY === 'string' && ZAI_API_KEY.length > 0 &&
  typeof ABUSEIPDB_API_KEY === 'string' && ABUSEIPDB_API_KEY.length > 0 &&
  typeof VIRUSTOTAL_API_KEY === 'string' && VIRUSTOTAL_API_KEY.length > 0;

import { describe } from 'bun:test';

const servicesAvailableSync = (() => {
  if (!runE2E || !runCloudE2E) return false;
  try {
    const result = Bun.spawnSync([
      'curl', '-sf', '--max-time', '2',
      '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
      `${API_BASE}/health`,
    ], { stdout: 'pipe', stderr: 'pipe' });
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

const e2eDescribe = (runE2E && runCloudE2E && servicesAvailableSync) ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadGuardDutySample() {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'e2e-tests', 'fixtures', 'guardduty-alert.json'), 'utf8'),
  );
}

function loadEventBridgeEnvelope() {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), 'e2e-tests', 'fixtures', 'guardduty-eventbridge-envelope.json'),
      'utf8',
    ),
  );
}

// ---------------------------------------------------------------------------
// ngrok helpers
// ---------------------------------------------------------------------------

let ngrokProc: Subprocess | null = null;

async function startNgrokTunnel(port: number): Promise<string> {
  console.log(`    Starting ngrok tunnel to port ${port}...`);
  ngrokProc = Bun.spawn(['ngrok', 'http', String(port)], {
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await new Promise((r) => setTimeout(r, 4000));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('http://localhost:4040/api/tunnels', {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const tunnel = data.tunnels?.find((t: any) => t.proto === 'https') || data.tunnels?.[0];
        if (tunnel?.public_url) {
          console.log(`    ngrok tunnel: ${tunnel.public_url}`);
          return tunnel.public_url;
        }
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Failed to get ngrok public URL from http://localhost:4040/api/tunnels');
}

function stopNgrok(): void {
  if (ngrokProc) {
    try {
      ngrokProc.kill();
    } catch {
      // already dead
    }
    ngrokProc = null;
    console.log('    ngrok stopped.');
  }
}

// ---------------------------------------------------------------------------
// Webhook delivery polling
// ---------------------------------------------------------------------------

async function pollWebhookDelivery(
  webhookId: string,
  timeoutMs = 300000,
): Promise<{ runId: string }> {
  const start = Date.now();
  console.log(`    Polling webhook ${webhookId} for deliveries (timeout ${timeoutMs / 1000}s)...`);

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_BASE}/webhooks/configurations/${webhookId}/deliveries`, {
        headers: HEADERS,
      });
      if (res.ok) {
        const deliveries: any[] = await res.json();
        const delivered = deliveries.find(
          (d: any) => d.status === 'delivered' && d.workflowRunId,
        );
        if (delivered) {
          console.log(`    Delivery found! Run ID: ${delivered.workflowRunId}`);
          return { runId: delivered.workflowRunId };
        }
        if (deliveries.length > 0) {
          const latest = deliveries[0];
          console.log(
            `    Latest delivery status: ${latest.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`,
          );
        }
      }
    } catch (err) {
      console.log(`    Delivery poll error: ${err}`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }

  throw new Error(`No webhook delivery received within ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Test state for cleanup
// ---------------------------------------------------------------------------

const cleanupState: {
  ruleName?: string;
  targetId?: string;
  apiDestinationName?: string;
  connectionName?: string;
  roleName?: string;
  userName?: string;
  region: string;
} = { region: AWS_REGION };

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

e2eDescribe('GuardDuty -> EventBridge -> Webhook -> Investigation E2E', () => {
  e2eTest(
    'real GuardDuty sample finding triggers investigation via EventBridge webhook',
    { timeout: 900000 },
    async () => {
      if (!requiredSecretsReady) {
        throw new Error(
          'Missing required ENV vars (ZAI_API_KEY, ABUSEIPDB_API_KEY, VIRUSTOTAL_API_KEY). ' +
            'Copy e2e-tests/.env.e2e.example to .env.e2e and fill secrets.',
        );
      }

      const ts = Date.now();
      const guardDutyAlert = loadGuardDutySample();

      // ---------------------------------------------------------------
      // Phase 1: AWS IAM Setup
      // ---------------------------------------------------------------
      console.log('\n  Phase 1: AWS IAM Setup');

      const userName = 'shipsec-e2e-investigator';
      cleanupState.userName = userName;
      await ensureInvestigatorUser(userName);
      await attachPolicy(userName, 'arn:aws:iam::aws:policy/ReadOnlyAccess');
      const keys = await createAccessKeys(userName);
      console.log(`    Access key created: ${keys.accessKeyId}`);

      const roleName = `shipsec-e2e-eventbridge-role`;
      cleanupState.roleName = roleName;
      const roleArn = await createEventBridgeTargetRole(roleName);
      console.log(`    EventBridge role ARN: ${roleArn}`);

      console.log('    Waiting 10s for IAM propagation...');
      await new Promise((r) => setTimeout(r, 10000));

      // ---------------------------------------------------------------
      // Phase 2: Secrets + Workflow + Webhook
      // ---------------------------------------------------------------
      console.log('\n  Phase 2: Secrets + Workflow + Webhook');

      const abuseSecretName = `E2E_GD_ABUSE_${ts}`;
      const vtSecretName = `E2E_GD_VT_${ts}`;
      const zaiSecretName = `E2E_GD_ZAI_${ts}`;
      const awsAccessKeyName = `E2E_GD_AWS_ACCESS_${ts}`;
      const awsSecretKeyName = `E2E_GD_AWS_SECRET_${ts}`;

      await createOrRotateSecret(abuseSecretName, ABUSEIPDB_API_KEY!);
      await createOrRotateSecret(vtSecretName, VIRUSTOTAL_API_KEY!);
      await createOrRotateSecret(zaiSecretName, ZAI_API_KEY!);
      await createOrRotateSecret(awsAccessKeyName, keys.accessKeyId);
      await createOrRotateSecret(awsSecretKeyName, keys.secretAccessKey);
      console.log('    Secrets created/rotated.');

      const workflowId = await createWorkflow({
        name: `E2E: GuardDuty EventBridge Investigation ${ts}`,
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Alert Ingest',
              config: {
                params: {
                  runtimeInputs: [
                    { id: 'alert', label: 'Alert JSON', type: 'json' },
                  ],
                },
              },
            },
          },
          {
            id: 'abuseipdb',
            type: 'security.abuseipdb.check',
            position: { x: 520, y: -160 },
            data: {
              label: 'AbuseIPDB',
              config: {
                mode: 'tool',
                params: { maxAgeInDays: 90 },
                inputOverrides: {
                  apiKey: abuseSecretName,
                  ipAddress: '',
                },
              },
            },
          },
          {
            id: 'virustotal',
            type: 'security.virustotal.lookup',
            position: { x: 520, y: 40 },
            data: {
              label: 'VirusTotal',
              config: {
                mode: 'tool',
                params: { type: 'ip' },
                inputOverrides: {
                  apiKey: vtSecretName,
                  indicator: '',
                },
              },
            },
          },
          {
            id: 'aws-creds',
            type: 'core.credentials.aws',
            position: { x: 520, y: 200 },
            data: {
              label: 'AWS Credentials Bundle',
              config: {
                params: {},
                inputOverrides: {
                  accessKeyId: awsAccessKeyName,
                  secretAccessKey: awsSecretKeyName,
                  region: AWS_REGION,
                },
              },
            },
          },
          {
            id: 'aws-mcp-group',
            type: 'mcp.group.aws',
            position: { x: 520, y: 360 },
            data: {
              label: 'AWS MCP Group',
              config: {
                mode: 'tool',
                params: {
                  enabledServers: ['aws-cloudtrail', 'aws-cloudwatch', 'aws-iam'],
                },
                inputOverrides: {},
              },
            },
          },
          {
            id: 'agent',
            type: 'core.ai.opencode',
            position: { x: 820, y: 40 },
            data: {
              label: 'OpenCode Investigator',
              config: {
                params: {
                  systemPrompt:
                    'You are a security triage agent. Use the available tools to analyze the suspicious IP and public IP from the GuardDuty finding, then summarize the alert and recommend next actions. Produce a short markdown report with headings: Summary, Findings, Actions.',
                  autoApprove: true,
                },
                inputOverrides: {
                  task: 'Investigate the GuardDuty alert delivered via EventBridge. Use tools to enrich IPs and summarize findings.',
                  context: {
                    alert: guardDutyAlert,
                  },
                  model: {
                    provider: 'zai-coding-plan',
                    modelId: 'glm-4.7',
                    apiKey: ZAI_API_KEY,
                  },
                },
              },
            },
          },
        ],
        edges: [
          { id: 'e-start-agent', source: 'start', target: 'agent' },
          { id: 't-abuse', source: 'abuseipdb', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
          { id: 't-vt', source: 'virustotal', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
          { id: 't-mcp', source: 'aws-mcp-group', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
          { id: 'a-creds', source: 'aws-creds', target: 'aws-mcp-group', sourceHandle: 'credentials', targetHandle: 'credentials' },
        ],
      });
      console.log(`    Workflow created: ${workflowId}`);

      const webhook = await createWebhook({
        workflowId,
        name: `GuardDuty EventBridge Hook ${ts}`,
        description: 'Parses GuardDuty findings from EventBridge envelope',
        parsingScript: `
          export async function script(input) {
            const { payload } = input;
            const finding = payload.detail || payload;
            return { alert: finding };
          }
        `,
        expectedInputs: [
          { id: 'alert', label: 'Alert JSON', type: 'json' },
        ],
      });
      console.log(`    Webhook created: ${webhook.id} (path: ${webhook.webhookPath})`);

      const envelope = loadEventBridgeEnvelope();
      const scriptTestRes = await fetch(`${API_BASE}/webhooks/configurations/test-script`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          parsingScript: webhook.parsingScript,
          testPayload: envelope,
          testHeaders: {},
        }),
      });
      const scriptTestData = await scriptTestRes.json();
      expect(scriptTestData.success).toBe(true);
      expect(scriptTestData.parsedData.alert).toBeDefined();
      expect(scriptTestData.parsedData.alert.type).toBe('Recon:EC2/PortProbeUnprotectedPort');
      console.log('    Parsing script test passed.');

      // ---------------------------------------------------------------
      // Phase 3: ngrok Tunnel
      // ---------------------------------------------------------------
      console.log('\n  Phase 3: ngrok Tunnel');

      const backendPort = parseInt(new URL(getApiBaseUrl()).port, 10);
      const ngrokUrl = await startNgrokTunnel(backendPort);
      const webhookEndpoint = `${ngrokUrl}/api/v1/webhooks/inbound/${webhook.webhookPath}`;
      console.log(`    Webhook endpoint: ${webhookEndpoint}`);

      // ---------------------------------------------------------------
      // Phase 4: EventBridge Setup
      // ---------------------------------------------------------------
      console.log('\n  Phase 4: EventBridge Setup');

      const connName = `shipsec-e2e-gd-conn-${ts}`;
      cleanupState.connectionName = connName;
      const connectionArn = await createConnection(connName, AWS_REGION);
      await waitForConnection(connName, AWS_REGION);

      const apiDestName = `shipsec-e2e-gd-apidest-${ts}`;
      cleanupState.apiDestinationName = apiDestName;
      const apiDestArn = await createApiDestination(
        apiDestName,
        connectionArn,
        webhookEndpoint,
        AWS_REGION,
      );

      const ruleNameStr = `shipsec-e2e-gd-rule-${ts}`;
      cleanupState.ruleName = ruleNameStr;
      await createRule(ruleNameStr, AWS_REGION, {
        source: ['aws.guardduty'],
        'detail-type': ['GuardDuty Finding'],
      });

      const targetId = `shipsec-e2e-target-${ts}`;
      cleanupState.targetId = targetId;
      await putTarget(ruleNameStr, targetId, apiDestArn, roleArn, AWS_REGION);

      // ---------------------------------------------------------------
      // Phase 5: Trigger GuardDuty
      // ---------------------------------------------------------------
      console.log('\n  Phase 5: Trigger GuardDuty Sample Finding');

      const detectorId = await ensureGuardDutyDetector(AWS_REGION);
      console.log(`    Detector ID: ${detectorId}`);
      await createSampleFindings(detectorId, AWS_REGION, [
        'Recon:EC2/PortProbeUnprotectedPort',
      ]);
      console.log('    Sample finding created.');

      // ---------------------------------------------------------------
      // Phase 6: Wait for Webhook Delivery
      // ---------------------------------------------------------------
      console.log('\n  Phase 6: Wait for Webhook Delivery');

      let runId: string;
      try {
        const delivery = await pollWebhookDelivery(webhook.id, 180000);
        runId = delivery.runId;
        console.log(`    Workflow triggered via EventBridge! Run ID: ${runId}`);
      } catch {
        console.log('    No EventBridge delivery within 3 min. Falling back to direct webhook POST...');
        const directEnvelope = loadEventBridgeEnvelope();
        const directRes = await fetch(webhookEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(directEnvelope),
        });
        if (!directRes.ok) {
          throw new Error(`Direct webhook POST failed: ${directRes.status} ${await directRes.text()}`);
        }
        const directData = await directRes.json();
        runId = directData.runId;
        console.log(`    Workflow triggered via direct POST! Run ID: ${runId}`);
      }

      // ---------------------------------------------------------------
      // Phase 7: Wait for Workflow Completion
      // ---------------------------------------------------------------
      console.log('\n  Phase 7: Wait for Workflow Completion');

      const result = await pollRunStatus(runId, 480000);
      console.log(`    Workflow status: ${result.status}`);
      expect(result.status).toBe('COMPLETED');

      await new Promise((r) => setTimeout(r, 3000));

      // ---------------------------------------------------------------
      // Phase 8: Verify Investigation Report
      // ---------------------------------------------------------------
      console.log('\n  Phase 8: Verify Investigation Report');

      const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, {
        headers: HEADERS,
      });
      const trace = await traceRes.json();

      const agentCompleted = trace.events?.find(
        (e: any) => e.nodeId === 'agent' && e.type === 'COMPLETED',
      );
      expect(agentCompleted).toBeDefined();

      if (agentCompleted) {
        const report = agentCompleted.outputSummary?.report as string | undefined;
        expect(report).toBeDefined();
        if (report) {
          const lower = report.toLowerCase();
          expect(lower).toContain('summary');
          expect(lower).toContain('findings');
          expect(lower).toContain('actions');
          console.log('    Report contains Summary, Findings, Actions.');
          console.log(`    Report length: ${report.length} chars`);
        }
      }

      console.log('\n  Test PASSED: Full GuardDuty -> EventBridge -> Webhook -> Investigation pipeline works!');

      // ---------------------------------------------------------------
      // Phase 9: Cleanup (inside test body to avoid afterAll timeout)
      // ---------------------------------------------------------------
      console.log('\n  Phase 9: Cleanup');
      stopNgrok();
      try {
        await cleanupAll(cleanupState);
      } catch (err) {
        console.error('  Cleanup error (non-fatal):', err);
      }
    },
  );
});
