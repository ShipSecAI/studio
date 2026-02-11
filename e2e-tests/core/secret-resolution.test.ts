/**
 * E2E Tests - Secret Resolution
 *
 * Validates that secret references in component inputs and parameters
 * are resolved to their actual values at runtime by the worker.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  runE2E,
  pollRunStatus,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

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

        const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ inputs: {} }),
        });
        const { runId } = await runRes.json();
        console.log(`    Run ID: ${runId}`);

        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        const nodeIORes = await fetch(`${API_BASE}/workflows/runs/${runId}/node-io`, { headers: HEADERS });
        const nodeIO = await nodeIORes.json();
        const scriptNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'script');

        expect(scriptNode).toBeDefined();
        console.log(`    Script node IO: ${JSON.stringify(scriptNode.outputs)}`);

        expect(scriptNode.outputs.echoedSecret).toBe('resolved-secret-value-xyz-789');
        expect(scriptNode.outputs.echoedSecret).not.toBe(secretId);

        console.log('    SUCCESS: Secret reference was correctly resolved to value');
    });

    test('Secret Loader (core.secret.fetch) resolved value flows to downstream components', async () => {
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

        const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ inputs: {} }),
        });
        const { runId } = await runRes.json();
        console.log(`    Run ID: ${runId}`);

        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        const nodeIORes = await fetch(`${API_BASE}/workflows/runs/${runId}/node-io`, { headers: HEADERS });
        const nodeIO = await nodeIORes.json();

        const loaderNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'loader');
        const echoNode = nodeIO?.nodes?.find((n: any) => n.nodeRef === 'echo');

        console.log(`    Loader node IO (Expected Masked): ${JSON.stringify(loaderNode.outputs)}`);
        console.log(`    Echo node IO (Expected Plaintext): ${JSON.stringify(echoNode.outputs)}`);

        expect(loaderNode.outputs.secret).toBe('***');
        expect(echoNode.outputs.echoed).toBe('resolved-secret-value-xyz-789');

        console.log('    SUCCESS: Secret Loader value correctly flowed and was verified via Echo');
    });
});
