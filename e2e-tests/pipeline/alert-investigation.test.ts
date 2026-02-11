import { expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HEADERS,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  createWorkflow,
  runWorkflow,
  createOrRotateSecret,
} from '../helpers/e2e-harness';

const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ABUSEIPDB_API_KEY = process.env.ABUSEIPDB_API_KEY;
const VIRUSTOTAL_API_KEY = process.env.VIRUSTOTAL_API_KEY;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const requiredSecretsReady =
  typeof ZAI_API_KEY === 'string' &&
  ZAI_API_KEY.length > 0 &&
  typeof ABUSEIPDB_API_KEY === 'string' &&
  ABUSEIPDB_API_KEY.length > 0 &&
  typeof VIRUSTOTAL_API_KEY === 'string' &&
  VIRUSTOTAL_API_KEY.length > 0 &&
  typeof AWS_ACCESS_KEY_ID === 'string' &&
  AWS_ACCESS_KEY_ID.length > 0 &&
  typeof AWS_SECRET_ACCESS_KEY === 'string' &&
  AWS_SECRET_ACCESS_KEY.length > 0;

function loadGuardDutySample() {
  const filePath = join(process.cwd(), 'e2e-tests', 'fixtures', 'guardduty-alert.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

import { getApiBaseUrl } from '../helpers/api-base';
const API_BASE = getApiBaseUrl();

e2eDescribe('Alert Investigation: End-to-End Workflow', () => {
  beforeAll(() => {
    if (!requiredSecretsReady) {
      throw new Error('Missing required ENV vars. Copy e2e-tests/.env.e2e.example to .env.e2e and fill secrets.');
    }
  });

  e2eTest('triage workflow runs end-to-end with MCP tools + OpenCode agent', { timeout: 480000 }, async () => {
    const now = Date.now();

    const abuseSecretName = `E2E_ALERT_ABUSE_${now}`;
    const vtSecretName = `E2E_ALERT_VT_${now}`;
    const zaiSecretName = `E2E_ALERT_ZAI_${now}`;
    const awsAccessKeyName = `E2E_ALERT_AWS_ACCESS_${now}`;
    const awsSecretKeyName = `E2E_ALERT_AWS_SECRET_${now}`;

    await createOrRotateSecret(abuseSecretName, ABUSEIPDB_API_KEY!);
    await createOrRotateSecret(vtSecretName, VIRUSTOTAL_API_KEY!);
    await createOrRotateSecret(zaiSecretName, ZAI_API_KEY!);
    await createOrRotateSecret(awsAccessKeyName, AWS_ACCESS_KEY_ID!);
    await createOrRotateSecret(awsSecretKeyName, AWS_SECRET_ACCESS_KEY!);

    const guardDutyAlert = loadGuardDutySample();

    const workflow = {
      name: `E2E: Alert Investigation ${now}`,
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
          position: { x: 520, y: 200 },
          data: {
            label: 'AWS MCP Group',
            config: {
              mode: 'tool',
              params: {
                enabledServers: [
                  'aws-cloudtrail',
                  'aws-cloudwatch',
                  'aws-iam'
                ]
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
                  'You are a security triage agent. Use the available tools to analyze the suspicious IP and public IP, then summarize the alert and recommend next actions. Produce a short markdown report with headings: Summary, Findings, Actions.',
                autoApprove: true,
              },
              inputOverrides: {
                task: 'Investigate the GuardDuty alert. Use tools to enrich IPs and summarize findings.',
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
        { id: 'e2', source: 'start', target: 'agent' },

        { id: 't1', source: 'abuseipdb', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
        { id: 't2', source: 'virustotal', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
        { id: 't3', source: 'aws-mcp-group', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },

        { id: 'a1', source: 'aws-creds', target: 'aws-mcp-group', sourceHandle: 'credentials', targetHandle: 'credentials' },
      ],
    };

    const workflowId = await createWorkflow(workflow);
    const runId = await runWorkflow(workflowId, { alert: guardDutyAlert });

    const result = await pollRunStatus(runId, 480000);
    expect(result.status).toBe('COMPLETED');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
    const trace = await traceRes.json();

    const agentCompleted = trace.events.find(
      (e: any) => e.nodeId === 'agent' && e.type === 'COMPLETED',
    );
    expect(agentCompleted).toBeDefined();
    if (agentCompleted) {
      const report = agentCompleted.outputSummary?.report as string | undefined;
      expect(report).toBeDefined();
      if (report) {
        expect(report.toLowerCase()).toContain('summary');
        expect(report.toLowerCase()).toContain('findings');
        expect(report.toLowerCase()).toContain('actions');
      }
    }
  });
});
