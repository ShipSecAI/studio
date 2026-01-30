/**
 * E2E Tests - MCP Tool Mode
 * 
 * Validates that an MCP server can be started in Docker, registered in the tool registry,
 * and cleaned up properly.
 */

import { describe, test, expect } from 'bun:test';
import { createMCPClient } from '@ai-sdk/mcp';

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Timeout while waiting for ${label} (${ms}ms)`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
}

async function readSseSample(response: Response, timeoutMs = 2000): Promise<string> {
    if (!response.body) {
        return '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        const result = await withTimeout(reader.read(), timeoutMs, 'SSE sample');
        if (!result || result.done || !result.value) {
            return '';
        }
        return decoder.decode(result.value);
    } finally {
        reader.releaseLock();
        await response.body.cancel().catch(() => undefined);
    }
}

async function generateGatewayToken(runId: string, allowedNodeIds: string[]): Promise<string> {
    const res = await fetch(`${API_BASE}/internal/mcp/generate-token`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
            runId,
            allowedNodeIds,
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to generate gateway token: ${res.status} ${text}`);
    }
    const payload = await res.json();
    if (!isRecord(payload) || typeof payload.token !== 'string') {
        throw new Error('Gateway token response missing token');
    }
    return payload.token;
}

async function probeGateway(token: string, label: string): Promise<void> {
    const initPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'shipsec-e2e', version: '0.1.0' },
        },
    };

    const initRes = await fetch(`${API_BASE}/mcp/gateway`, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(initPayload),
    });

    const initSample = await readSseSample(initRes);
    const initSessionId = initRes.headers.get('mcp-session-id');
    console.log(`  [Debug][${label}] init status=${initRes.status} content-type=${initRes.headers.get('content-type')}`);
    console.log(`  [Debug][${label}] init sessionId=${initSessionId ?? 'none'}`);
    console.log(`  [Debug][${label}] init sample=${initSample.trim() || '<empty>'}`);

    if (!initSessionId) {
        return;
    }

    const toolsPayload = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
    };

    const toolsRes = await fetch(`${API_BASE}/mcp/gateway`, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Mcp-Session-Id': initSessionId,
            'Mcp-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify(toolsPayload),
    });

    const toolsSample = await readSseSample(toolsRes);
    console.log(`  [Debug][${label}] tools status=${toolsRes.status} content-type=${toolsRes.headers.get('content-type')}`);
    console.log(`  [Debug][${label}] tools sample=${toolsSample.trim() || '<empty>'}`);
}

const e2eDescribe = runE2E ? describe : describe.skip;

e2eDescribe('MCP Tool Mode E2E', () => {

    test('starts an MCP server in Docker and registers it', async () => {
        // We use a simple alpine image as a mock MCP server that just stays alive
        // In a real scenario, this would be mcp/server-everything or similar.
        const workflow = {
            name: 'Test: MCP Docker Registration',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'mcp',
                    type: 'core.mcp.server',
                    // Set tool mode
                    mode: 'tool',
                    position: { x: 200, y: 0 },
                    data: {
                        label: 'MCP Server',
                        config: {
                            params: {
                                image: 'alpine',
                                command: ['sh', '-c', 'sleep 3600'], // Just stay alive
                                port: 8080,
                            },
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mcp' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        // Verify registration in backend internal API (or check Redis if we had access)
        // We can use the internal health/debug endpoint if it exists, 
        // but for now we'll check if the trace event has the registration info.
        const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
        const trace = await traceRes.json();

        // Check for COMPLETED (mapped from NODE_COMPLETED) event for 'mcp' node
        console.log('  [Debug] Fetched trace events:', trace.events.map((e: any) => `${e.nodeId}:${e.type}`));
        const mcpEvent = trace.events.find((e: any) => e.nodeId === 'mcp' && e.type === 'COMPLETED');
        expect(mcpEvent).toBeDefined();

        if (mcpEvent) {
            console.log('  [Debug] MCP Node Output:', JSON.stringify(mcpEvent.outputSummary, null, 2));
            expect(mcpEvent.outputSummary.endpoint).toBeDefined();
            expect(mcpEvent.outputSummary.containerId).toBeDefined();
        }

        // Cleanup: Kill the container after the test
        const { execSync } = require('child_process');
        try {
            console.log(`  [Cleanup] Killing container for run ${runId}...`);
            execSync(`docker rm -f $(docker ps -aq --filter "label=shipsec.runId=${runId}")`, { stdio: 'inherit' });
            console.log('  [Cleanup] Done.');
        } catch (e: any) {
            console.warn('  [Cleanup] Failed to kill container (it might have already been removed):', e.message);
        }
    }, 120000);

    test('lists tool-mode nodes via MCP gateway (streamable HTTP)', async () => {
        const workflow = {
            name: 'Test: MCP Gateway Tool Listing',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'ip_tool',
                    type: 'core.http.request',
                    position: { x: 200, y: 0 },
                    data: {
                        label: 'IP Lookup Tool',
                        config: {
                            mode: 'tool',
                            params: {
                                method: 'GET',
                            },
                            inputOverrides: {
                                url: 'https://httpbin.org/ip',
                            }
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ip_tool' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        const result = await pollRunStatus(runId, 120000);
        expect(result.status).toBe('COMPLETED');

        const token = await generateGatewayToken(runId, ['ip_tool']);
        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

        try {
            mcpClient = await withTimeout(
                createMCPClient({
                    transport: {
                        type: 'http',
                        url: `${API_BASE}/mcp/gateway`,
                        headers: { Authorization: `Bearer ${token}` },
                    },
                }),
                15000,
                'createMCPClient',
            );

            const tools = await withTimeout(mcpClient.tools(), 15000, 'mcpClient.tools');
            const toolNames = Object.keys(tools);
            console.log('  [Debug] Gateway tools:', toolNames);
            expect(toolNames).toContain('ip_tool');
        } catch (error) {
            console.log('  [Debug] MCP client failed, running manual probe...');
            try {
                await probeGateway(token, 'mcpClient.tools');
            } catch (probeError) {
                console.log('  [Debug] MCP probe failed:', probeError);
            }
            throw error;
        } finally {
            if (mcpClient) {
                await mcpClient.close();
            }
        }
    }, 120000);

});
