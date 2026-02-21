import { expect, beforeAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { API_BASE, HEADERS, e2eDescribe, e2eTest, createWorkflow } from '../helpers/e2e-harness';

interface ApiKeyResponse {
    id: string;
    plainKey: string;
    name: string;
}

e2eDescribe('Studio MCP: Task API Integration', () => {
    let plainKey: string | null = null;
    let workflowId: string | null = null;

    beforeAll(async () => {
        // Create an API key with workflow permissions
        const keyRes = await fetch(`${API_BASE}/api-keys`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                name: `e2e-mcp-tasks-${Date.now()}`,
                permissions: {
                    workflows: { run: true, list: true, read: true },
                    runs: { read: true, cancel: true },
                    audit: { read: true },
                },
            }),
        });

        if (!keyRes.ok) {
            throw new Error(`Failed to create API key: ${keyRes.status} ${await keyRes.text()}`);
        }

        const keyData = (await keyRes.json()) as ApiKeyResponse;
        plainKey = keyData.plainKey;

        // Create a minimal workflow (entry point only — runs and completes immediately)
        workflowId = await createWorkflow({
            name: `E2E Task API Test ${Date.now()}`,
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
        });
    });

    e2eTest(
        'run_workflow via Task API streams taskCreated and result messages',
        { timeout: 60000 },
        async () => {
            expect(plainKey).toBeDefined();
            expect(workflowId).toBeDefined();

            const transport = new StreamableHTTPClientTransport(new URL(`${API_BASE}/studio-mcp`), {
                requestInit: {
                    headers: { Authorization: `Bearer ${plainKey}` },
                },
            });

            const client = new Client(
                { name: 'e2e-task-client', version: '1.0.0' },
                {
                    capabilities: {
                        tasks: {
                            requests: {
                                tasks: { get: {}, list: {}, result: {}, cancel: {} },
                            },
                        },
                    },
                },
            );

            await client.connect(transport);

            try {
                // Cache tool metadata (required to detect task-capable tools)
                await client.listTools();

                const messages: any[] = [];

                const stream = client.experimental.tasks.callToolStream({
                    name: 'run_workflow',
                    arguments: {
                        workflowId,
                        inputs: { message: 'hello from task api test' },
                    },
                });

                for await (const message of stream) {
                    messages.push(message);
                    console.log('[task stream]', JSON.stringify(message));
                    if (message.type === 'result' || message.type === 'error') {
                        break;
                    }
                }

                // Must have gotten at least a taskCreated and a result message
                expect(messages.length).toBeGreaterThanOrEqual(2);

                // Verify taskCreated
                const taskCreated = messages.find((m) => m.type === 'taskCreated');
                expect(taskCreated).toBeDefined();
                expect(typeof taskCreated.task.taskId).toBe('string');
                expect(taskCreated.task.status).toBe('working');

                // Verify final result (not an error)
                const result = messages.find((m) => m.type === 'result');
                expect(result).toBeDefined();
                expect(result.result.isError).toBeFalsy();
                expect(result.result.content).toBeArray();
                expect(result.result.content.length).toBeGreaterThan(0);
            } finally {
                await client.close();
            }
        },
    );
});
