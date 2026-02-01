import { describe, test, expect, beforeAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_BASE = 'http://127.0.0.1:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ABUSEIPDB_API_KEY = process.env.ABUSEIPDB_API_KEY;
const VIRUSTOTAL_API_KEY = process.env.VIRUSTOTAL_API_KEY;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const AWS_CLOUDTRAIL_MCP_IMAGE =
  process.env.AWS_CLOUDTRAIL_MCP_IMAGE || 'shipsec/mcp-aws-cloudtrail:latest';
const AWS_CLOUDWATCH_MCP_IMAGE =
  process.env.AWS_CLOUDWATCH_MCP_IMAGE || 'shipsec/mcp-aws-cloudwatch:latest';

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

const servicesAvailableSync = (() => {
  if (!runE2E) return false;
  try {
    const result = spawnSync('curl', [
      '-sf',
      '--max-time',
      '1',
      '-H',
      `x-internal-token: ${HEADERS['x-internal-token']}`,
      `${API_BASE}/health`,
    ]);
    return result.status === 0;
  } catch {
    return false;
  }
})();

const e2eDescribe = runE2E && servicesAvailableSync ? describe : describe.skip;

function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>,
): void {
  if (runE2E && servicesAvailableSync) {
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      (test as any)(name, optionsOrFn, fn);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

async function pollRunStatus(runId: string, timeoutMs = 480000): Promise<{ status: string }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) return s;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Workflow run ${runId} timed out`);
}

async function createWorkflow(workflow: any): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create workflow: ${res.status} ${text}`);
  }
  const { id } = await res.json();
  return id;
}

async function runWorkflow(workflowId: string, inputs: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to run workflow: ${res.status} ${text}`);
  }
  const { runId } = await res.json();
  return runId;
}

async function listSecrets(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${API_BASE}/secrets`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list secrets: ${res.status} ${text}`);
  }
  return res.json();
}

async function createOrRotateSecret(name: string, value: string): Promise<string> {
  const secrets = await listSecrets();
  const existing = secrets.find((s) => s.name === name);
  if (!existing) {
    const res = await fetch(`${API_BASE}/secrets`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name, value }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create secret: ${res.status} ${text}`);
    }
    const secret = await res.json();
    return secret.id as string;
  }

  const res = await fetch(`${API_BASE}/secrets/${existing.id}/rotate`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rotate secret: ${res.status} ${text}`);
  }
  return existing.id;
}

function loadGuardDutySample() {
  const filePath = join(process.cwd(), 'e2e-tests', 'fixtures', 'guardduty-alert.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

e2eDescribe('ENG-104: End-to-End Alert Investigation Workflow', () => {
  beforeAll(() => {
    if (!requiredSecretsReady) {
      throw new Error('Missing required ENV vars. Copy e2e-tests/.env.eng-104.example to .env.eng-104 and fill secrets.');
    }
  });

  e2eTest('triage workflow runs end-to-end with MCP tools + OpenCode agent', { timeout: 480000 }, async () => {
    const now = Date.now();

    const abuseSecretName = `ENG104_ABUSE_${now}`;
    const vtSecretName = `ENG104_VT_${now}`;
    const zaiSecretName = `ENG104_ZAI_${now}`;
    const awsAccessKeyName = `ENG104_AWS_ACCESS_${now}`;
    const awsSecretKeyName = `ENG104_AWS_SECRET_${now}`;

    await createOrRotateSecret(abuseSecretName, ABUSEIPDB_API_KEY!);
    await createOrRotateSecret(vtSecretName, VIRUSTOTAL_API_KEY!);
    await createOrRotateSecret(zaiSecretName, ZAI_API_KEY!);
    await createOrRotateSecret(awsAccessKeyName, AWS_ACCESS_KEY_ID!);
    await createOrRotateSecret(awsSecretKeyName, AWS_SECRET_ACCESS_KEY!);

    const guardDutyAlert = loadGuardDutySample();

    const workflow = {
      name: `E2E: ENG-104 Alert Investigation ${now}`,
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
          id: 'cloudtrail',
          type: 'security.aws-cloudtrail-mcp',
          position: { x: 520, y: 220 },
          data: {
            label: 'CloudTrail MCP',
            config: {
              mode: 'tool',
              params: {
                image: AWS_CLOUDTRAIL_MCP_IMAGE,
                region: AWS_REGION,
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'cloudwatch',
          type: 'security.aws-cloudwatch-mcp',
          position: { x: 520, y: 400 },
          data: {
            label: 'CloudWatch MCP',
            config: {
              mode: 'tool',
              params: {
                image: AWS_CLOUDWATCH_MCP_IMAGE,
                region: AWS_REGION,
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
        { id: 't3', source: 'cloudtrail', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
        { id: 't4', source: 'cloudwatch', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },

        { id: 'a1', source: 'aws-creds', target: 'cloudtrail', sourceHandle: 'credentials', targetHandle: 'credentials' },
        { id: 'a2', source: 'aws-creds', target: 'cloudwatch', sourceHandle: 'credentials', targetHandle: 'credentials' },
      ],
    };

    const workflowId = await createWorkflow(workflow);
    const runId = await runWorkflow(workflowId, { alert: guardDutyAlert });

    const result = await pollRunStatus(runId);
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

    // Leave secrets for reuse across runs; rotation already updated values.
  });
});
