#!/usr/bin/env bun
/**
 * Quick E2E script to validate GCS FUSE volumes work end-to-end in a real
 * security workflow on GKE. Runs a dnsx scan (fast DNS resolution) which
 * internally uses createIsolatedVolume() to pass domain lists to the container.
 *
 * Usage:
 *   BACKEND_URL=http://35.225.241.234:3211 bun run e2e-tests/scripts/test-k8s-volume-workflow.ts
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://35.225.241.234:3211';
const API_BASE = `${BACKEND_URL}/api/v1`;
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin';
const BASIC_AUTH = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Basic ${BASIC_AUTH}`,
};
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function pollRunStatus(runId: string, timeoutMs = 180_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await api('GET', `/workflows/runs/${runId}`);
    const status: string = run.status;
    process.stdout.write(`\r  ${INFO} Status: ${status}          `);
    if (['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(status)) {
      process.stdout.write('\n');
      return run;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs / 1000}s`);
}

async function testDnsxWorkflow() {
  console.log('\n── Test: dnsx scan via K8s job + GCS FUSE volume ──');
  const now = Date.now();

  // 1. Create workflow
  const workflow = {
    name: `E2E: K8s Volume Test dnsx ${now}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: {
            params: {
              runtimeInputs: [{ id: 'domains', label: 'Domains', type: 'array' }],
            },
          },
        },
      },
      {
        id: 'dnsx',
        type: 'shipsec.dnsx.run',
        position: { x: 300, y: 0 },
        data: {
          label: 'DNS Resolve',
          config: { params: { recordTypes: ['A'], rateLimit: 100 } },
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'start',
        target: 'dnsx',
        sourceHandle: 'domains',
        targetHandle: 'domains',
      },
    ],
  };

  const { id: workflowId } = await api('POST', '/workflows', workflow);
  console.log(`  ${PASS} Created workflow: ${workflowId}`);

  // 2. Trigger run with real domains
  const testDomains = ['github.com', 'google.com', 'cloudflare.com'];
  const { runId } = await api('POST', `/workflows/${workflowId}/run`, {
    inputs: { domains: testDomains },
  });
  console.log(`  ${PASS} Started run: ${runId}`);
  console.log(`  ${INFO} Domains: ${testDomains.join(', ')}`);

  // 3. Poll to completion
  const run = await pollRunStatus(runId);
  if (run.status !== 'COMPLETED') {
    console.error(`  ${FAIL} Run ended with status: ${run.status}`);
    process.exit(1);
  }
  console.log(`  ${PASS} Run completed: ${run.status}`);

  // 4. Fetch node outputs
  const nodeIO = await api('GET', `/workflows/runs/${runId}/node-io/dnsx`);
  const resolved = nodeIO?.outputs?.resolvedHosts ?? nodeIO?.outputs?.domains ?? [];
  console.log(`  ${PASS} Resolved ${resolved.length} host(s): ${resolved.slice(0, 5).join(', ')}`);

  if (resolved.length === 0) {
    console.error(`  ${FAIL} No resolved hosts — volume/job may not have worked`);
    process.exit(1);
  }

  // 5. Cleanup workflow
  await api('DELETE', `/workflows/${workflowId}`).catch(() => {});
  console.log(`  ${PASS} Cleaned up workflow`);
}

async function testSubfinderWorkflow() {
  console.log('\n── Test: subfinder scan via K8s job + GCS FUSE volume ──');
  const now = Date.now();

  const workflow = {
    name: `E2E: K8s Volume Test subfinder ${now}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: {
            params: {
              runtimeInputs: [{ id: 'domains', label: 'Domains', type: 'array' }],
            },
          },
        },
      },
      {
        id: 'subfinder',
        type: 'shipsec.subfinder.run',
        position: { x: 300, y: 0 },
        data: {
          label: 'Subfinder',
          config: { params: { timeoutSeconds: 60 } },
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'start',
        target: 'subfinder',
        sourceHandle: 'domains',
        targetHandle: 'domains',
      },
    ],
  };

  const { id: workflowId } = await api('POST', '/workflows', workflow);
  console.log(`  ${PASS} Created workflow: ${workflowId}`);

  const { runId } = await api('POST', `/workflows/${workflowId}/run`, {
    inputs: { domains: ['shipsec.ai'] },
  });
  console.log(`  ${PASS} Started run: ${runId} (target: shipsec.ai)`);

  const run = await pollRunStatus(runId, 120_000);
  if (run.status !== 'COMPLETED') {
    console.error(`  ${FAIL} Run ended with status: ${run.status}`);
    process.exit(1);
  }
  console.log(`  ${PASS} Run completed`);

  const nodeIO = await api('GET', `/workflows/runs/${runId}/node-io/subfinder`);
  const subdomains = nodeIO?.outputs?.subdomains ?? [];
  console.log(`  ${PASS} Found ${subdomains.length} subdomain(s): ${subdomains.slice(0, 5).join(', ')}`);

  await api('DELETE', `/workflows/${workflowId}`).catch(() => {});
  console.log(`  ${PASS} Cleaned up workflow`);
}

async function main() {
  console.log('🧪 K8s GCS FUSE Volume — Real Workflow E2E');
  console.log(`   Backend: ${API_BASE}`);

  // Health check
  const health = await api('GET', '/health');
  console.log(`   Health: ${health.status}`);

  await testDnsxWorkflow();
  await testSubfinderWorkflow();

  console.log('\n\x1b[32m✓ All workflow tests passed\x1b[0m\n');
}

main().catch((err) => {
  console.error(`\n${FAIL} Test failed:`, err.message);
  process.exit(1);
});
