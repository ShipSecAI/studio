import { describe, test, expect, beforeAll } from 'bun:test';

const API_BASE = 'http://127.0.0.1:3211/api/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const hasOpenRouterKey = typeof OPENROUTER_KEY === 'string' && OPENROUTER_KEY.length > 0;
const MODEL_ID = 'openai/gpt-5-mini';

async function pollRunStatus(runId: string, timeoutMs = 120000): Promise<{ status: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
        const s = await res.json();
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) return s;
        await new Promise(resolve => setTimeout(resolve, 2000));
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

e2eDescribe('Agent Tool Mode Orchestration E2E', () => {
    beforeAll(() => {
        if (!hasOpenRouterKey) {
            throw new Error('Missing OPENROUTER_API_KEY env var for agent E2E tests.');
        }
    });

    test('Agent can run with no tools', async () => {
        const workflow = {
            name: 'E2E: Agent No Tools',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'agent',
                    type: 'core.ai.agent',
                    position: { x: 400, y: 0 },
                    data: {
                        label: 'Security Agent',
                        config: {
                            params: {
                                systemPrompt: 'Say hello.',
                            },
                            inputOverrides: {
                                userInput: 'Hi',
                                modelApiKey: OPENROUTER_KEY,
                                chatModel: {
                                    provider: 'openai',
                                    modelId: MODEL_ID,
                                    baseUrl: 'https://openrouter.ai/api/v1',
                                    apiKey: OPENROUTER_KEY
                                }
                            }
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'agent' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);
        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');
    }, 60000);

    test('Agent discovers and calls a tool connected via graph edge', async () => {
        const workflow = {
            name: 'E2E: Agent Tool Discovery',
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
                    position: { x: 200, y: -50 },
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
                {
                    id: 'agent',
                    type: 'core.ai.agent',
                    position: { x: 400, y: 0 },
                    data: {
                        label: 'Security Agent',
                        config: {
                            params: {
                                systemPrompt: 'You are a security assistant. Call ip_tool exactly once and report the IP address.',
                            },
                            inputOverrides: {
                                userInput: 'What is my current IP?',
                                modelApiKey: OPENROUTER_KEY,
                                chatModel: {
                                    provider: 'openai',
                                    modelId: MODEL_ID,
                                    baseUrl: 'https://openrouter.ai/api/v1',
                                    apiKey: OPENROUTER_KEY
                                }
                            }
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ip_tool' },
                { id: 'e2', source: 'start', target: 'agent' },
                { id: 't1', source: 'ip_tool', target: 'agent', sourceHandle: 'tools', targetHandle: 'tools' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        console.log(`[Test] Started run ${runId}`);

        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
        const trace = await traceRes.json();

        // Verify tool-mode node executed
        const toolCompleted = trace.events.find((e: any) => e.nodeId === 'ip_tool' && e.type === 'COMPLETED');
        expect(toolCompleted).toBeDefined();

        const agentCompleted = trace.events.find((e: any) => e.nodeId === 'agent' && e.type === 'COMPLETED');
        expect(agentCompleted).toBeDefined();
        if (!agentCompleted) {
            throw new Error('Agent node did not complete');
        }
        const responseText = agentCompleted.outputSummary.responseText;
        console.log(`[Test] Agent Response: ${responseText}`);
        // Agent should see the tool and either call it or describe it
        const hasTool = responseText.toLowerCase().includes('tool');
        const hasIp = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(responseText);
        expect(hasTool || hasIp).toBe(true);
    }, 120000);

    test('Multiple agents have isolated tool sets based on graph connections', async () => {
        const workflow = {
            name: 'E2E: Agent Tool Isolation',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'tool_a',
                    type: 'core.http.request',
                    position: { x: 200, y: -100 },
                    data: {
                        label: 'Tool A',
                        config: {
                            mode: 'tool',
                            params: { method: 'GET' },
                            inputOverrides: { url: 'https://httpbin.org/get?source=tool_a' }
                        },
                    },
                },
                {
                    id: 'tool_b',
                    type: 'core.http.request',
                    position: { x: 200, y: 100 },
                    data: {
                        label: 'Tool B',
                        config: {
                            mode: 'tool',
                            params: { method: 'GET' },
                            inputOverrides: { url: 'https://httpbin.org/get?source=tool_b' }
                        },
                    },
                },
                {
                    id: 'agent_a',
                    type: 'core.ai.agent',
                    position: { x: 400, y: -100 },
                    data: {
                        label: 'Agent A',
                        config: {
                            params: { systemPrompt: 'List the available tools by name only.' },
                            inputOverrides: {
                                userInput: 'List your available tools.',
                                modelApiKey: OPENROUTER_KEY,
                                chatModel: {
                                    provider: 'openai',
                                    modelId: MODEL_ID,
                                    baseUrl: 'https://openrouter.ai/api/v1',
                                    apiKey: OPENROUTER_KEY
                                }
                            }
                        },
                    },
                },
                {
                    id: 'agent_b',
                    type: 'core.ai.agent',
                    position: { x: 400, y: 100 },
                    data: {
                        label: 'Agent B',
                        config: {
                            params: { systemPrompt: 'List the available tools by name only.' },
                            inputOverrides: {
                                userInput: 'List your available tools.',
                                modelApiKey: OPENROUTER_KEY,
                                chatModel: {
                                    provider: 'openai',
                                    modelId: MODEL_ID,
                                    baseUrl: 'https://openrouter.ai/api/v1',
                                    apiKey: OPENROUTER_KEY
                                }
                            }
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'tool_a' },
                { id: 'e2', source: 'start', target: 'tool_b' },
                { id: 'e3', source: 'start', target: 'agent_a' },
                { id: 'e4', source: 'start', target: 'agent_b' },
                { id: 't_a', source: 'tool_a', target: 'agent_a', sourceHandle: 'tools', targetHandle: 'tools' },
                { id: 't_b', source: 'tool_b', target: 'agent_b', sourceHandle: 'tools', targetHandle: 'tools' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        const result = await pollRunStatus(runId);
        expect(result.status).toBe('COMPLETED');

        const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
        const trace = await traceRes.json();

        const agentA = trace.events.find((e: any) => e.nodeId === 'agent_a' && e.type === 'COMPLETED');
        const agentB = trace.events.find((e: any) => e.nodeId === 'agent_b' && e.type === 'COMPLETED');
        if (!agentA || !agentB) {
            throw new Error('Agent runs did not complete');
        }

        console.log(`[Test] Agent A Response: ${agentA.outputSummary.responseText}`);
        console.log(`[Test] Agent B Response: ${agentB.outputSummary.responseText}`);

        expect(agentA.outputSummary.responseText.toLowerCase()).toContain('tool_a');
        expect(agentA.outputSummary.responseText.toLowerCase()).not.toContain('tool_b');

        expect(agentB.outputSummary.responseText.toLowerCase()).toContain('tool_b');
        expect(agentB.outputSummary.responseText.toLowerCase()).not.toContain('tool_a');
    }, 180000);

});
