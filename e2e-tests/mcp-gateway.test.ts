import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const API_BASE = 'http://127.0.0.1:3211/api/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

// Helper function to poll workflow run status
async function pollRunStatus(runId: string, timeoutMs = 60000): Promise<{ status: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
        const s = await res.json();
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) return s;
        await new Promise(resolve => setTimeout(resolve, 1000));
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

async function runWorkflow(workflowId: string): Promise<string> {
    const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ inputs: {} }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to run workflow: ${res.status} ${text}`);
    }
    const { runId } = await res.json();
    return runId;
}

const e2eDescribe = runE2E ? describe : describe.skip;

e2eDescribe('MCP Gateway E2E', () => {

    test('Agent can connect via SSE, list tools, and call a component tool', async () => {
        // 1. Create a workflow that stays alive (using core.flow.delay)
        const workflow = {
            name: 'Test: MCP Gateway',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'wait',
                    type: 'core.logic.script',
                    position: { x: 200, y: 0 },
                    data: {
                        label: 'Wait',
                        config: {
                            params: {
                                code: 'async function script() { console.log("Waiting 60s..."); await new Promise(resolve => setTimeout(resolve, 60000)); return { done: true }; }',
                            },
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'wait' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        console.log(`[Test] Started run ${runId}`);

        // 2. Register a mock component tool via Internal API
        // We'll use 'core.transform.json' as a simple tool that returns what we give it (if configured)
        // Or just 'core.util.echo' if it exists.
        // Let's use 'core.util.uuid' if available, or just assume we can register ANY componentId.
        // The worker needs to be able to execute it. 
        // 'core.logic.script' is good for testing logic.
        const toolName = 'test_script';
        const componentId = 'core.logic.script';

        const regRes = await fetch(`${API_BASE}/internal/mcp/register-component`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                runId,
                nodeId: 'manual-tool-reg',
                toolName,
                componentId,
                description: 'Test Script Tool',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
                credentials: {},
                parameters: {
                    code: 'async function script() { return { result: { msg: "Hello from Tool" } }; }',
                    returns: [{ name: 'result', type: 'json' }]
                }
            }),
        });

        if (!regRes.ok) {
            const text = await regRes.text();
            throw new Error(`Failed to register tool: ${regRes.status} ${text}`);
        }

        console.log(`[Test] Registered tool ${toolName}`);

        // 2.5 Generate a session-specific MCP token
        const tokenRes = await fetch(`${API_BASE}/internal/mcp/generate-token`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                runId,
                organizationId: 'local-dev',
                agentId: 'test-agent'
            }),
        });

        if (!tokenRes.ok) {
            const text = await tokenRes.text();
            throw new Error(`Failed to generate token: ${tokenRes.status} ${text}`);
        }

        const { token } = await tokenRes.json();
        console.log(`[Test] Generated session token: ${token.substring(0, 10)}...`);

        // 3. Connect via MCP Client using the Session Token
        const transport = new StreamableHTTPClientTransport(new URL(`${API_BASE}/mcp/gateway`), {
            requestInit: {
                headers: {
                    ...HEADERS,
                    'Authorization': `Bearer ${token}`
                }
            }
        });

        const client = new Client(
            { name: 'test-agent', version: '1.0.0' },
            { capabilities: {} }
        );

        console.log(`[Test] Connecting to MCP Gateway...`);
        await client.connect(transport);

        // 4. List Tools
        const tools = await client.listTools();
        console.log(`[Test] Tools listed:`, tools.tools.map(t => t.name));

        expect(tools.tools).toBeDefined();
        const found = tools.tools.find(t => t.name === toolName);
        expect(found).toBeDefined();
        expect(found?.description).toBe('Test Script Tool');

        // 5. Call Tool
        console.log(`[Test] Calling tool ${toolName}...`);
        const result = await client.callTool({
            name: toolName,
            arguments: {},
        });

        console.log(`[Test] Tool result:`, result);

        // Expect successful execution
        expect(result.content).toBeDefined();
        // content is array of TextContent | ImageContent
        // core.logic.script returns output object. McpGateway wraps it in JSON string.
        const contentText = (result.content as any)[0].text;
        const output = JSON.parse(contentText);
        expect(output.result.msg).toBe('Hello from Tool');

        // Cleanup
        await client.close();

        // Terminate workflow (optional, but good)
        // API to cancel?
        await fetch(`${API_BASE}/workflows/runs/${runId}/cancel`, { method: 'POST', headers: HEADERS });
    }, 60000);

});
