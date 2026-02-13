import { expect, beforeAll, afterAll } from 'bun:test';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { generateText, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  createWorkflow,
} from '../helpers/e2e-harness';

interface ApiKeyResponse {
  id: string;
  plainKey: string;
  name: string;
  permissions: {
    workflows: { run: boolean; list: boolean; read: boolean };
    runs: { read: boolean; cancel: boolean };
  };
}

e2eDescribe('Studio MCP: AI SDK Integration', () => {
  let apiKeyId: string | null = null;
  let plainKey: string | null = null;
  let mcpClient: MCPClient | null = null;
  let workflowId: string | null = null;

  beforeAll(async () => {
    // Create API key for MCP authentication
    const res = await fetch(`${API_BASE}/api-keys`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `e2e-studio-mcp-ai-sdk-${Date.now()}`,
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: true },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create API key: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as ApiKeyResponse;
    apiKeyId = data.id;
    plainKey = data.plainKey;

    expect(plainKey).toBeDefined();
    expect(plainKey).toMatch(/^sk_live_/);
  });

  afterAll(async () => {
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (error) {
        console.warn('Error closing MCP client:', error);
      }
    }

    if (workflowId) {
      try {
        await fetch(`${API_BASE}/workflows/${workflowId}`, {
          method: 'DELETE',
          headers: HEADERS,
        });
      } catch (error) {
        console.warn('Error deleting workflow:', error);
      }
    }

    if (apiKeyId) {
      try {
        await fetch(`${API_BASE}/api-keys/${apiKeyId}`, {
          method: 'DELETE',
          headers: HEADERS,
        });
      } catch (error) {
        console.warn('Error deleting API key:', error);
      }
    }
  });

  e2eTest('AI SDK MCP client connects and discovers tools', { timeout: 60000 }, async () => {
    expect(plainKey).toBeDefined();

    mcpClient = await createMCPClient({
      transport: {
        type: 'http',
        url: `${API_BASE}/studio-mcp`,
        headers: {
          Authorization: `Bearer ${plainKey}`,
        },
      },
    });

    expect(mcpClient).toBeDefined();

    const tools = await mcpClient!.tools();
    expect(tools).toBeDefined();

    const toolNames = Object.keys(tools);
    expect(toolNames.length).toBeGreaterThanOrEqual(9);

    const expectedTools = [
      'list_workflows',
      'get_workflow',
      'run_workflow',
      'list_components',
      'get_component',
      'list_runs',
      'get_run_status',
      'get_run_result',
      'cancel_run',
    ];

    for (const expectedTool of expectedTools) {
      expect(toolNames).toContain(expectedTool);
    }
  });

  e2eTest(
    'AI SDK agent can use Studio MCP tools via generateText',
    { timeout: 120000 },
    async () => {
      const ZAI_API_KEY = process.env.ZAI_API_KEY;

      if (!ZAI_API_KEY) {
        console.warn('Skipping AI agent test: ZAI_API_KEY not set');
        return;
      }

      expect(plainKey).toBeDefined();

      const client = await createMCPClient({
        transport: {
          type: 'http',
          url: `${API_BASE}/studio-mcp`,
          headers: {
            Authorization: `Bearer ${plainKey}`,
          },
        },
      });

      try {
        const tools = await client.tools();

        const openai = createOpenAI({
          baseURL: 'https://api.z.ai/api/coding/paas/v4',
          apiKey: ZAI_API_KEY,
        });

        const model = openai.chat('glm-4.7');

        const response = await generateText({
          model,
          tools,
          stopWhen: stepCountIs(3),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'List all available components using the list_components tool and tell me how many there are.',
                },
              ],
            },
          ],
        });

        expect(response.steps).toBeDefined();
        expect(response.steps.length).toBeGreaterThan(0);

        const hasToolCalls = response.steps.some(
          (step) => step.toolCalls && step.toolCalls.length > 0,
        );
        expect(hasToolCalls).toBe(true);

        expect(response.text).toBeDefined();
        expect(response.text.length).toBeGreaterThan(0);

        const lowerText = response.text.toLowerCase();
        const mentionsComponents = lowerText.includes('component') || /\d+/.test(response.text);
        expect(mentionsComponents).toBe(true);
      } finally {
        await client.close();
      }
    },
  );

  e2eTest('AI SDK agent can execute workflow operations', { timeout: 120000 }, async () => {
    const ZAI_API_KEY = process.env.ZAI_API_KEY;

    if (!ZAI_API_KEY) {
      console.warn('Skipping workflow operations test: ZAI_API_KEY not set');
      return;
    }

    expect(plainKey).toBeDefined();

    const workflow = {
      name: `E2E AI SDK MCP Test ${Date.now()}`,
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: {
              params: {
                runtimeInputs: [{ id: 'message', label: 'Message', type: 'text' }],
              },
            },
          },
        },
      ],
      edges: [],
    };

    workflowId = await createWorkflow(workflow);
    expect(workflowId).toBeDefined();

    const client = await createMCPClient({
      transport: {
        type: 'http',
        url: `${API_BASE}/studio-mcp`,
        headers: {
          Authorization: `Bearer ${plainKey}`,
        },
      },
    });

    try {
      const tools = await client.tools();

      const openai = createOpenAI({
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
        apiKey: ZAI_API_KEY,
      });

      const model = openai.chat('glm-4.7');

      const response = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(5),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Run the workflow with ID "${workflowId}" using the input message "Hello from AI SDK test". Then check its status.`,
              },
            ],
          },
        ],
      });

      expect(response.steps).toBeDefined();
      expect(response.steps.length).toBeGreaterThan(0);

      const allToolCalls = response.steps.flatMap((step) => step.toolCalls || []);
      const toolCallNames = allToolCalls.map((call) => call.toolName);

      expect(toolCallNames).toContain('run_workflow');

      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});
