/**
 * E2E Tests - Secret Resolution
 *
 * Validates that secret references in component inputs and parameters
 * are resolved to their actual values at runtime by the worker.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

async function checkServicesAvailable(): Promise<boolean> {
    if (!runE2E) return false;
    try {
        const healthRes = await fetch(`${API_BASE}/health`, {
            headers: HEADERS,
            signal: AbortSignal.timeout(2000),
        });
        return healthRes.ok;
    } catch {
        return false;
    }
}

// Helper to poll workflow run status
async function pollRunStatus(runId: string, timeoutMs = 60000): Promise<{ status: string }> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
        const s = await res.json();
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) {
            return s;
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

// Helper to get trace events
async function getTraceEvents(runId: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
    if (!res.ok) return [];
    const trace = await res.json();
    return trace?.events ?? [];
}

const e2eDescribe = runE2E ? describe : describe.skip;

e2eDescribe('Secret Resolution E2E Tests', () => {
    let secretId: string;

    beforeAll(async () => {
        const servicesAvailable = await checkServicesAvailable();
        if (!servicesAvailable) {
            console.log('    Backend API is not available. Skipping Secret Resolution E2E tests.');
            return;
        }

        // Create a test secret
        const secretRes = await fetch(`${API_BASE}/secrets`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                name: `E2E_TEST_SECRET_${Date.now()}`,
                value: 'resolved-secret-value-xyz-789',
                description: 'E2E test secret for resolution check'
            }),
        });

        if (!secretRes.ok) {
            const err = await secretRes.text();
            throw new Error(`Failed to create test secret: ${err}`);
        }

        const secret = await secretRes.json();
        secretId = secret.id;
        console.log(`    Created test secret: ${secretId}`);
    });

    afterAll(async () => {
        if (secretId) {
            await fetch(`${API_BASE}/secrets/${secretId}`, {
                method: 'DELETE',
                headers: HEADERS
            });
            console.log(`    Deleted test secret: ${secretId}`);
        }
    });

    test('Secret ID in inputOverrides is resolved to actual value', async () => {
        // Create a workflow with core.logic.script
        // We define an input variable 'mySecret' of type 'secret'
        const workflow = {
            name: 'Test: Secret Resolution',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'script',
                    type: 'core.logic.script',
                    position: { x: 200, y: 0 },
                    data: {
                        label: 'Echo Secret',
                        config: {
                            params: {
                                variables: [
                                    { name: 'mySecret', type: 'secret' },
                                ],
                                returns: [
                                    { name: 'echoedSecret', type: 'string' },
                                ],
                                code: `export async function script(input: Input): Promise<Output> {
  return {
    echoedSecret: String(input.mySecret || 'not-found')
  };
}`,
                            },
                            inputOverrides: {
                                // Pass the secret ID here. 
                                // Because 'mySecret' is type 'secret', the activity should resolve this ID.
                                mySecret: secretId,
                            },
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'script' },
            ],
        };

        const createRes = await fetch(`${API_BASE}/workflows`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(workflow),
        });
        const { id: workflowId } = await createRes.json();
        console.log(`    Created workflow: ${workflowId}`);

        // Run the workflow
        const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ inputs: {} }),
        });
        const { runId } = await runRes.json();
        console.log(`    Run ID: ${runId}`);

        // Wait for completion
        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        // Fetch full node-io to verify outputs (trace might be truncated)
        const nodeIORes = await fetch(`${API_BASE}/workflows/runs/${runId}/node-io`, { headers: HEADERS });
        const nodeIO = await nodeIORes.json();
        const scriptNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'script');

        expect(scriptNode).toBeDefined();
        console.log(`    Script node IO: ${JSON.stringify(scriptNode.outputs)}`);

        // The echoedSecret should be the ACTUAL VALUE, not the secretId
        expect(scriptNode.outputs.echoedSecret).toBe('resolved-secret-value-xyz-789');
        expect(scriptNode.outputs.echoedSecret).not.toBe(secretId);

        console.log('    SUCCESS: Secret reference was correctly resolved to value');
    });

    test('Secret Loader (core.secret.fetch) resolved value flows to downstream components', async () => {
        // This test pipes a Secret Loader into a Script node.
        // Secret Loader output 'secret' is masked in the API.
        // Script node then echoes it to a 'string' port which is NOT masked.
        const workflow = {
            name: 'Test: Secret Loader Flow',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'loader',
                    type: 'core.secret.fetch',
                    position: { x: 200, y: 0 },
                    data: {
                        label: 'Load Secret',
                        config: {
                            params: {
                                secretId: secretId,
                                outputFormat: 'raw'
                            }
                        },
                    },
                },
                {
                    id: 'echo',
                    type: 'core.logic.script',
                    position: { x: 400, y: 0 },
                    data: {
                        label: 'Echo',
                        config: {
                            params: {
                                variables: [{ name: 'val', type: 'secret' }],
                                returns: [{ name: 'echoed', type: 'string' }],
                                code: `export async function script(input: Input): Promise<Output> {
  return { echoed: String(input.val) };
}`,
                            }
                        }
                    }
                }
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'loader' },
                { id: 'e2', source: 'loader', target: 'echo', sourceHandle: 'secret', targetHandle: 'val' },
            ],
        };

        const createRes = await fetch(`${API_BASE}/workflows`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(workflow),
        });
        const { id: workflowId } = await createRes.json();
        console.log(`    Created workflow: ${workflowId}`);

        // Run the workflow
        const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ inputs: {} }),
        });
        const { runId } = await runRes.json();
        console.log(`    Run ID: ${runId}`);

        // Wait for completion
        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        // Fetch node-io
        const nodeIORes = await fetch(`${API_BASE}/workflows/runs/${runId}/node-io`, { headers: HEADERS });
        const nodeIO = await nodeIORes.json();

        const loaderNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'loader');
        const echoNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'echo');

        console.log(`    Loader node IO (Expected Masked): ${JSON.stringify(loaderNode.outputs)}`);
        console.log(`    Echo node IO (Expected Plaintext): ${JSON.stringify(echoNode.outputs)}`);

        // 1. Loader's output 'secret' should be masked in the API
        expect(loaderNode.outputs.secret).toBe('***');

        // 2. Echo node's output 'echoed' (string) should be the ACTUAL SECRET VALUE
        // This proves that even though the API masks 'secret' ports, the values 
        // were correctly resolved and passed between components in the worker.
        expect(echoNode.outputs.echoed).toBe('resolved-secret-value-xyz-789');

        console.log('    SUCCESS: Secret Loader value correctly flowed and was verified via Echo');
    });
});
