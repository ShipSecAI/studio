import { describe, test, expect, beforeAll } from 'bun:test';
import { spawnSync } from 'node:child_process';

import { getApiBaseUrl } from './helpers/api-base';

const API_BASE = getApiBaseUrl();
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

const ABUSEIPDB_API_KEY = process.env.ABUSEIPDB_API_KEY;
const VIRUSTOTAL_API_KEY = process.env.VIRUSTOTAL_API_KEY;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const requiredSecretsReady =
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

async function pollRunStatus(runId: string, timeoutMs = 300000): Promise<{ status: string }> {
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

e2eDescribe('Mock Agent: Tool Discovery E2E', () => {
  beforeAll(() => {
    if (!requiredSecretsReady) {
      throw new Error(
        'Missing required ENV vars. Copy e2e-tests/.env.eng-104.example to .env.eng-104 and fill secrets.',
      );
    }
  });

  e2eTest(
    'mock.agent discovers abuseipdb, virustotal, and AWS MCP group tools',
    { timeout: 300000 },
    async () => {
      const now = Date.now();

      const abuseSecretName = `E2E_MOCK_ABUSE_${now}`;
      const vtSecretName = `E2E_MOCK_VT_${now}`;
      const awsAccessKeyName = `E2E_MOCK_AWS_ACCESS_${now}`;
      const awsSecretKeyName = `E2E_MOCK_AWS_SECRET_${now}`;

      await createOrRotateSecret(abuseSecretName, ABUSEIPDB_API_KEY!);
      await createOrRotateSecret(vtSecretName, VIRUSTOTAL_API_KEY!);
      await createOrRotateSecret(awsAccessKeyName, AWS_ACCESS_KEY_ID!);
      await createOrRotateSecret(awsSecretKeyName, AWS_SECRET_ACCESS_KEY!);

      const workflow = {
        name: `E2E: Mock Agent Tool Discovery ${now}`,
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: {
                params: {
                  runtimeInputs: [
                    { id: 'trigger', label: 'Trigger', type: 'string' },
                  ],
                },
              },
            },
          },
          {
            id: 'abuseipdb',
            type: 'security.abuseipdb.check',
            position: { x: 300, y: -100 },
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
            position: { x: 300, y: 0 },
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
            position: { x: 300, y: 100 },
            data: {
              label: 'AWS Credentials',
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
            position: { x: 500, y: 100 },
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
            id: 'mock-agent',
            type: 'mock.agent',
            position: { x: 700, y: 0 },
            data: {
              label: 'Mock Agent',
              config: {
                params: {
                  callTools: true,
                  maxToolCalls: 10,
                },
                inputOverrides: {},
              },
            },
          },
        ],
        edges: [
          // Start -> mock-agent
          { id: 'e1', source: 'start', target: 'mock-agent' },
          // Tools -> mock-agent (tool connections)
          {
            id: 't1',
            source: 'abuseipdb',
            target: 'mock-agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
          {
            id: 't2',
            source: 'virustotal',
            target: 'mock-agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
          {
            id: 't3',
            source: 'aws-mcp-group',
            target: 'mock-agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
          // AWS creds -> AWS MCP group
          {
            id: 'a1',
            source: 'aws-creds',
            target: 'aws-mcp-group',
            sourceHandle: 'credentials',
            targetHandle: 'credentials',
          },
        ],
      };

      const workflowId = await createWorkflow(workflow);
      console.log(`[e2e] Created workflow: ${workflowId}`);

      const runId = await runWorkflow(workflowId, { trigger: 'e2e-test' });
      console.log(`[e2e] Started run: ${runId}`);

      const result = await pollRunStatus(runId);
      console.log(`[e2e] Run completed with status: ${result.status}`);
      expect(result.status).toBe('COMPLETED');

      // Wait a moment for trace events to flush
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Fetch trace to inspect mock-agent output
      const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, {
        headers: HEADERS,
      });
      const trace = await traceRes.json();

      const mockAgentCompleted = trace.events.find(
        (e: any) => e.nodeId === 'mock-agent' && e.type === 'COMPLETED',
      );
      expect(mockAgentCompleted).toBeDefined();

      const toolCount = mockAgentCompleted?.outputSummary?.toolCount as number | undefined;
      // Note: outputSummary truncates arrays to `{keyCount: N}` via createLightweightSummary
      const toolCallResultsCount = mockAgentCompleted?.outputSummary?.toolCallResultsCount as number | undefined;
      const discoveredToolsCount = mockAgentCompleted?.outputSummary?.discoveredToolsCount as number | undefined;

      console.log(`[e2e] Mock agent discovered ${toolCount} tools (discoveredToolsCount=${discoveredToolsCount})`);
      console.log(`[e2e] Mock agent made ${toolCallResultsCount} tool calls`);
      console.log(`[e2e] Full outputSummary: ${JSON.stringify(mockAgentCompleted?.outputSummary, null, 2)}`);

      expect(toolCount).toBeDefined();
      expect(toolCount).toBeGreaterThan(0);
      // toolCount > 2 proves AWS MCP tools were discovered via the gateway
      // (2 = abuseipdb_check + virustotal_lookup, so >2 means AWS tools are present)
      expect(toolCount).toBeGreaterThan(2);

      console.log('[e2e] All expected tools discovered successfully!');

      // Verify tool calls were made (at least component tools: abuseipdb + virustotal)
      expect(toolCallResultsCount).toBeDefined();
      expect(toolCallResultsCount).toBeGreaterThanOrEqual(2);
    },
  );
});
