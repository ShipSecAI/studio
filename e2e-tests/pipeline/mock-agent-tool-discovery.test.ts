import { expect, beforeAll } from 'bun:test';

import {
  HEADERS,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  createWorkflow,
  runWorkflow,
  createOrRotateSecret,
} from '../helpers/e2e-harness';

import { getApiBaseUrl } from '../helpers/api-base';

const API_BASE = getApiBaseUrl();

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

e2eDescribe('Mock Agent: Tool Discovery E2E', () => {
  beforeAll(() => {
    if (!requiredSecretsReady) {
      throw new Error(
        'Missing required ENV vars. Copy e2e-tests/.env.e2e.example to .env.e2e and fill secrets.',
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
          { id: 'e1', source: 'start', target: 'mock-agent' },
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

      const result = await pollRunStatus(runId, 300000);
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
      const toolCallResultsCount = mockAgentCompleted?.outputSummary?.toolCallResultsCount as number | undefined;
      const discoveredToolsCount = mockAgentCompleted?.outputSummary?.discoveredToolsCount as number | undefined;

      console.log(`[e2e] Mock agent discovered ${toolCount} tools (discoveredToolsCount=${discoveredToolsCount})`);
      console.log(`[e2e] Mock agent made ${toolCallResultsCount} tool calls`);
      console.log(`[e2e] Full outputSummary: ${JSON.stringify(mockAgentCompleted?.outputSummary, null, 2)}`);

      expect(toolCount).toBeDefined();
      expect(toolCount).toBeGreaterThan(0);
      expect(toolCount).toBeGreaterThan(2);

      console.log('[e2e] All expected tools discovered successfully!');

      expect(toolCallResultsCount).toBeDefined();
      expect(toolCallResultsCount).toBeGreaterThanOrEqual(2);
    },
  );
});
