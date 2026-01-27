import { describe, test, expect, beforeAll } from 'bun:test';

const API_BASE = 'http://127.0.0.1:3211/api/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const hasZaiKey = typeof ZAI_API_KEY === 'string' && ZAI_API_KEY.length > 0;

async function pollRunStatus(runId: string, timeoutMs = 300000): Promise<{ status: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
        const s = await res.json();
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) return s;
        await new Promise(resolve => setTimeout(resolve, 5000));
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

e2eDescribe('OpenCode Agent E2E', () => {
    beforeAll(() => {
        if (!hasZaiKey) {
            throw new Error('Missing ZAI_API_KEY env var for OpenCode E2E tests.');
        }
    });

    test('OpenCode agent runs with Z.AI GLM-4.7', async () => {
        const workflow = {
            name: 'E2E: OpenCode Agent Basic',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'opencode',
                    type: 'core.ai.opencode',
                    position: { x: 400, y: 0 },
                    data: {
                        label: 'OpenCode Agent',
                        config: {
                            params: {
                                systemPrompt: 'You are a helpful coding assistant. Respond briefly.',
                                autoApprove: true,
                            },
                            inputOverrides: {
                                task: 'Write a hello world function in Python. Return only the code.',
                                model: {
                                    provider: 'zai-coding-plan',
                                    modelId: 'glm-4.7',
                                    apiKey: ZAI_API_KEY,
                                },
                            },
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'opencode' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        console.log(`[Test] Started OpenCode run ${runId}`);

        const result = await pollRunStatus(runId, 300000);
        expect(result.status).toBe('COMPLETED');

        // Give a moment for logs to flush
        await new Promise(resolve => setTimeout(resolve, 2000));

        const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
        const trace = await traceRes.json();

        const opencodeCompleted = trace.events.find((e: any) => e.nodeId === 'opencode' && e.type === 'COMPLETED');
        expect(opencodeCompleted).toBeDefined();

        if (opencodeCompleted) {
            const report = opencodeCompleted.output?.report;
            console.log(`[Test] OpenCode Report: ${report?.substring(0, 200)}...`);
            expect(report).toBeDefined();
            expect(typeof report).toBe('string');
            expect(report.length).toBeGreaterThan(0);
        }
    }, 300000);

    test('OpenCode agent uses context from input', async () => {
        const workflow = {
            name: 'E2E: OpenCode Agent with Context',
            nodes: [
                {
                    id: 'start',
                    type: 'core.workflow.entrypoint',
                    position: { x: 0, y: 0 },
                    data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
                },
                {
                    id: 'opencode',
                    type: 'core.ai.opencode',
                    position: { x: 400, y: 0 },
                    data: {
                        label: 'OpenCode Agent',
                        config: {
                            params: {
                                systemPrompt: 'Analyze the security alert in the context and provide brief recommendations.',
                                autoApprove: true,
                            },
                            inputOverrides: {
                                task: 'Review the security alert and provide recommendations.',
                                context: {
                                    alert: {
                                        type: 'SQL Injection Attempt',
                                        severity: 'high',
                                        source_ip: '192.168.1.100',
                                        payload: "'; DROP TABLE users; --",
                                    },
                                },
                                model: {
                                    provider: 'zai-coding-plan',
                                    modelId: 'glm-4.7',
                                    apiKey: ZAI_API_KEY,
                                },
                            },
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'opencode' },
            ],
        };

        const workflowId = await createWorkflow(workflow);
        const runId = await runWorkflow(workflowId);

        console.log(`[Test] Started OpenCode with context run ${runId}`);

        const result = await pollRunStatus(runId, 300000);
        expect(result.status).toBe('COMPLETED');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const traceRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
        const trace = await traceRes.json();

        const opencodeCompleted = trace.events.find((e: any) => e.nodeId === 'opencode' && e.type === 'COMPLETED');
        expect(opencodeCompleted).toBeDefined();

        if (opencodeCompleted) {
            const report = opencodeCompleted.output?.report;
            console.log(`[Test] Security Analysis Report: ${report?.substring(0, 300)}...`);
            expect(report).toBeDefined();
            expect(typeof report).toBe('string');
            // Should mention SQL injection or security-related terms
            const reportLower = report.toLowerCase();
            const hasSecurityTerms = reportLower.includes('sql') ||
                                   reportLower.includes('injection') ||
                                   reportLower.includes('security') ||
                                   reportLower.includes('recommend');
            expect(hasSecurityTerms).toBe(true);
        }
    }, 300000);
});
