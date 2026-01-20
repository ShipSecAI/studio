/**
 * E2E Tests - MCP Tool Mode
 * 
 * Validates that an MCP server can be started in Docker, registered in the tool registry,
 * and cleaned up properly.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

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

});
