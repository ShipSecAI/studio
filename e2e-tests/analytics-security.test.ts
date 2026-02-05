/**
 * E2E Security Tests - Analytics Multi-Tenant Data Isolation
 *
 * Validates that:
 * 1. One organization cannot access another organization's analytics data
 * 2. Analytics queries are scoped to the requesting org's index pattern
 * 3. Settings endpoints enforce org isolation and admin-only access
 * 4. Unauthenticated requests are rejected
 *
 * Requirements:
 * - Backend API running on http://localhost:3211
 * - OpenSearch running on http://localhost:9200
 * - RUN_E2E=true environment variable
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? 'http://localhost:9200';

// Internal token for local dev testing
const INTERNAL_TOKEN = 'local-internal-token';

// Two simulated orgs for cross-tenant tests
const ORG_A = 'security-test-org-a';
const ORG_B = 'security-test-org-b';

// Unique markers to identify each org's documents
const ORG_A_MARKER = `org-a-marker-${Date.now()}`;
const ORG_B_MARKER = `org-b-marker-${Date.now()}`;

function headersForOrg(orgId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-internal-token': INTERNAL_TOKEN,
    'x-organization-id': orgId,
  };
}

const HEADERS_NO_ORG = {
  'Content-Type': 'application/json',
  'x-internal-token': INTERNAL_TOKEN,
};

const runE2E = process.env.RUN_E2E === 'true';

const servicesAvailableSync = (() => {
  if (!runE2E) return false;
  try {
    const backend = Bun.spawnSync(
      ['curl', '-sf', '--max-time', '2', '-H', `x-internal-token: ${INTERNAL_TOKEN}`, `${API_BASE}/health`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    if (backend.exitCode !== 0) return false;

    const opensearch = Bun.spawnSync(
      ['curl', '-sf', '--max-time', '2', `${OPENSEARCH_URL}/_cluster/health`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return opensearch.exitCode === 0;
  } catch {
    return false;
  }
})();

async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) return false;
  try {
    const [healthRes, osRes] = await Promise.all([
      fetch(`${API_BASE}/health`, {
        headers: { 'x-internal-token': INTERNAL_TOKEN },
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`${OPENSEARCH_URL}/_cluster/health`, {
        signal: AbortSignal.timeout(3000),
      }),
    ]);
    return healthRes.ok && osRes.ok;
  } catch {
    return false;
  }
}

const e2eDescribe = runE2E && servicesAvailableSync ? describe : describe.skip;

function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>,
): void {
  if (runE2E && servicesAvailableSync) {
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      (test as any)(name, optionsOrFn, fn);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// ---------------------------------------------------------------------------
// Helpers: Seed data directly into OpenSearch for deterministic testing
// ---------------------------------------------------------------------------

/** Index a document directly into OpenSearch under a specific org's index */
async function seedDocument(
  orgId: string,
  document: Record<string, any>,
): Promise<void> {
  const date = new Date();
  const suffix = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  const indexName = `security-findings-${orgId}-${suffix}`;

  const res = await fetch(`${OPENSEARCH_URL}/${indexName}/_doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...document,
      '@timestamp': new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to seed document into ${indexName}: ${res.status} - ${text}`);
  }
}

/** Wait for OpenSearch to make seeded documents searchable */
async function refreshIndices(): Promise<void> {
  await fetch(`${OPENSEARCH_URL}/security-findings-*/_refresh`, {
    method: 'POST',
  });
}

/** Clean up test indices after tests */
async function deleteTestIndices(): Promise<void> {
  await Promise.allSettled([
    fetch(`${OPENSEARCH_URL}/security-findings-${ORG_A}-*`, { method: 'DELETE' }),
    fetch(`${OPENSEARCH_URL}/security-findings-${ORG_B}-*`, { method: 'DELETE' }),
  ]);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let servicesAvailable = false;

beforeAll(async () => {
  if (!runE2E) {
    console.log('\n  Analytics Security E2E: Skipping (RUN_E2E not set)');
    return;
  }

  console.log('\n  Analytics Security E2E: Verifying services...');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('    Required services not available. Tests will be skipped.');
    return;
  }
  console.log('    Backend API and OpenSearch are running');

  // Seed test data for both orgs
  console.log('    Seeding test data for Org A and Org B...');

  const orgADocs = [
    { host: 'app-a.example.com', severity: 'high', finding: 'SQLi', test_marker: ORG_A_MARKER, shipsec: { organization_id: ORG_A, run_id: 'run-a-1', workflow_id: 'wf-a-1', workflow_name: 'Org A Scan', component_id: 'nuclei', node_ref: 'scan-a' } },
    { host: 'api-a.example.com', severity: 'medium', finding: 'XSS', test_marker: ORG_A_MARKER, shipsec: { organization_id: ORG_A, run_id: 'run-a-1', workflow_id: 'wf-a-1', workflow_name: 'Org A Scan', component_id: 'nuclei', node_ref: 'scan-a' } },
    { host: 'db-a.example.com', severity: 'critical', finding: 'RCE', test_marker: ORG_A_MARKER, shipsec: { organization_id: ORG_A, run_id: 'run-a-2', workflow_id: 'wf-a-1', workflow_name: 'Org A Scan', component_id: 'nuclei', node_ref: 'scan-a' } },
  ];

  const orgBDocs = [
    { host: 'app-b.example.com', severity: 'low', finding: 'Info Disclosure', test_marker: ORG_B_MARKER, shipsec: { organization_id: ORG_B, run_id: 'run-b-1', workflow_id: 'wf-b-1', workflow_name: 'Org B Scan', component_id: 'httpx', node_ref: 'scan-b' } },
    { host: 'cdn-b.example.com', severity: 'high', finding: 'SSRF', test_marker: ORG_B_MARKER, shipsec: { organization_id: ORG_B, run_id: 'run-b-1', workflow_id: 'wf-b-1', workflow_name: 'Org B Scan', component_id: 'httpx', node_ref: 'scan-b' } },
  ];

  await Promise.all([
    ...orgADocs.map((doc) => seedDocument(ORG_A, doc)),
    ...orgBDocs.map((doc) => seedDocument(ORG_B, doc)),
  ]);

  await refreshIndices();
  console.log(`    Seeded ${orgADocs.length} docs for Org A, ${orgBDocs.length} docs for Org B`);
});

afterAll(async () => {
  if (servicesAvailable) {
    console.log('\n  Cleaning up test indices...');
    await deleteTestIndices();
    console.log('    Test indices deleted');
  }
});

// ===========================
// 1. Cross-Org Data Isolation
// ===========================

e2eDescribe('Analytics Cross-Org Data Isolation', () => {
  e2eTest('Org A can only see its own data', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { term: { test_marker: ORG_A_MARKER } },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // Org A should see its 3 documents
    expect(body.total).toBe(3);

    // All returned docs should belong to Org A
    for (const hit of body.hits) {
      expect(hit._source.shipsec.organization_id).toBe(ORG_A);
      expect(hit._source.test_marker).toBe(ORG_A_MARKER);
    }
  });

  e2eTest('Org B can only see its own data', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_B),
      body: JSON.stringify({
        query: { term: { test_marker: ORG_B_MARKER } },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // Org B should see its 2 documents
    expect(body.total).toBe(2);

    // All returned docs should belong to Org B
    for (const hit of body.hits) {
      expect(hit._source.shipsec.organization_id).toBe(ORG_B);
      expect(hit._source.test_marker).toBe(ORG_B_MARKER);
    }
  });

  e2eTest('Org A cannot see Org B data via match_all', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 1000,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // None of Org A's results should contain Org B's marker
    for (const hit of body.hits) {
      expect(hit._source.test_marker).not.toBe(ORG_B_MARKER);
      expect(hit._source.shipsec?.organization_id).not.toBe(ORG_B);
    }
  });

  e2eTest('Org B cannot see Org A data via match_all', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_B),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 1000,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // None of Org B's results should contain Org A's marker
    for (const hit of body.hits) {
      expect(hit._source.test_marker).not.toBe(ORG_A_MARKER);
      expect(hit._source.shipsec?.organization_id).not.toBe(ORG_A);
    }
  });

  e2eTest('Org A cannot query Org B data by searching for Org B marker', { timeout: 30000 }, async () => {
    // Attempt to search for Org B's marker while authenticated as Org A
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { term: { test_marker: ORG_B_MARKER } },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // Should return 0 results - Org A's index doesn't contain Org B's data
    expect(body.total).toBe(0);
    expect(body.hits).toHaveLength(0);
  });

  e2eTest('Org B cannot query Org A data by searching for Org A marker', { timeout: 30000 }, async () => {
    // Attempt to search for Org A's marker while authenticated as Org B
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_B),
      body: JSON.stringify({
        query: { term: { test_marker: ORG_A_MARKER } },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // Should return 0 results
    expect(body.total).toBe(0);
    expect(body.hits).toHaveLength(0);
  });
});

// ===========================
// 2. Aggregation Isolation
// ===========================

e2eDescribe('Analytics Aggregation Isolation', () => {
  e2eTest('Aggregations only reflect the requesting org data', { timeout: 30000 }, async () => {
    // Org A aggregation by severity
    const resA = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 0,
        aggs: {
          severity_counts: { terms: { field: 'severity.keyword' } },
          component_counts: { terms: { field: 'shipsec.component_id.keyword' } },
        },
      }),
    });

    expect(resA.ok).toBe(true);
    const bodyA = await resA.json();

    // Org A should only see nuclei component (that's what we seeded)
    const componentBuckets = bodyA.aggregations?.component_counts?.buckets ?? [];
    const componentIds = componentBuckets.map((b: any) => b.key);
    expect(componentIds).toContain('nuclei');
    expect(componentIds).not.toContain('httpx'); // httpx is Org B's component

    // Org B aggregation
    const resB = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_B),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 0,
        aggs: {
          component_counts: { terms: { field: 'shipsec.component_id.keyword' } },
        },
      }),
    });

    expect(resB.ok).toBe(true);
    const bodyB = await resB.json();

    const componentBucketsB = bodyB.aggregations?.component_counts?.buckets ?? [];
    const componentIdsB = componentBucketsB.map((b: any) => b.key);
    expect(componentIdsB).toContain('httpx');
    expect(componentIdsB).not.toContain('nuclei'); // nuclei is Org A's component
  });
});

// ===========================
// 3. Authentication & Authorization
// ===========================

e2eDescribe('Analytics Authentication Requirements', () => {
  e2eTest('Unauthenticated query request returns 401', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { match_all: {} } }),
    });

    expect(res.status).toBe(401);
  });

  e2eTest('Unauthenticated settings request returns 401', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/settings`, {
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(401);
  });

  e2eTest('Invalid internal token returns 401', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': 'wrong-token',
        'x-organization-id': ORG_A,
      },
      body: JSON.stringify({ query: { match_all: {} } }),
    });

    expect(res.status).toBe(401);
  });
});

// ===========================
// 4. Settings Isolation
// ===========================

e2eDescribe('Analytics Settings Isolation', () => {
  e2eTest('Org A settings are independent of Org B', { timeout: 30000 }, async () => {
    // Get Org A settings
    const resA = await fetch(`${API_BASE}/analytics/settings`, {
      headers: headersForOrg(ORG_A),
    });
    expect(resA.ok).toBe(true);
    const settingsA = await resA.json();
    expect(settingsA.organizationId).toBe(ORG_A);

    // Get Org B settings
    const resB = await fetch(`${API_BASE}/analytics/settings`, {
      headers: headersForOrg(ORG_B),
    });
    expect(resB.ok).toBe(true);
    const settingsB = await resB.json();
    expect(settingsB.organizationId).toBe(ORG_B);

    // Each org sees only its own settings
    expect(settingsA.organizationId).not.toBe(settingsB.organizationId);
  });

  e2eTest('Updating Org A settings does not affect Org B', { timeout: 30000 }, async () => {
    // Update Org A retention to 15 days
    const updateRes = await fetch(`${API_BASE}/analytics/settings`, {
      method: 'PUT',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({ analyticsRetentionDays: 15 }),
    });
    expect(updateRes.ok).toBe(true);
    const updatedA = await updateRes.json();
    expect(updatedA.analyticsRetentionDays).toBe(15);

    // Verify Org B is unaffected (should have default 30 days)
    const resB = await fetch(`${API_BASE}/analytics/settings`, {
      headers: headersForOrg(ORG_B),
    });
    expect(resB.ok).toBe(true);
    const settingsB = await resB.json();
    expect(settingsB.analyticsRetentionDays).toBe(30);
  });

  e2eTest('Settings update rejects retention beyond tier limit', { timeout: 10000 }, async () => {
    // Free tier max is 30 days - try to set 365
    const res = await fetch(`${API_BASE}/analytics/settings`, {
      method: 'PUT',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({ analyticsRetentionDays: 365 }),
    });

    expect(res.status).toBe(400);
  });
});

// ===========================
// 5. Query Input Validation
// ===========================

e2eDescribe('Analytics Query Validation', () => {
  e2eTest('Query with invalid size rejects', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 5000, // exceeds MAX_QUERY_SIZE of 1000
      }),
    });

    expect(res.status).toBe(400);
  });

  e2eTest('Query with negative from rejects', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { match_all: {} },
        from: -1,
      }),
    });

    expect(res.status).toBe(400);
  });

  e2eTest('Query with from exceeding max rejects', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: { match_all: {} },
        from: 20000, // exceeds MAX_QUERY_FROM of 10000
      }),
    });

    expect(res.status).toBe(400);
  });

  e2eTest('Query with non-object query rejects', { timeout: 10000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg(ORG_A),
      body: JSON.stringify({
        query: 'not an object',
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ===========================
// 6. Non-Existent Org Returns Empty
// ===========================

e2eDescribe('Analytics Non-Existent Org', () => {
  e2eTest('Query for a non-existent org returns empty results', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: headersForOrg('org-that-does-not-exist'),
      body: JSON.stringify({
        query: { match_all: {} },
        size: 10,
      }),
    });

    // Should succeed but return 0 results (not leak data or error out)
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.hits).toHaveLength(0);
  });
});

// ===========================
// 7. Index Pattern Isolation (Direct OpenSearch Verification)
// ===========================

e2eDescribe('OpenSearch Index Pattern Isolation', () => {
  e2eTest('Org A index contains only Org A documents', { timeout: 30000 }, async () => {
    // Query OpenSearch directly to verify index-level isolation
    const res = await fetch(`${OPENSEARCH_URL}/security-findings-${ORG_A}-*/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { match_all: {} },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    const total = typeof body.hits.total === 'object' ? body.hits.total.value : body.hits.total;

    // Should have exactly the 3 docs we seeded for Org A
    expect(total).toBe(3);

    // Verify none of the docs have Org B's marker
    for (const hit of body.hits.hits) {
      expect(hit._source.test_marker).toBe(ORG_A_MARKER);
      expect(hit._source.shipsec?.organization_id).toBe(ORG_A);
    }
  });

  e2eTest('Org B index contains only Org B documents', { timeout: 30000 }, async () => {
    const res = await fetch(`${OPENSEARCH_URL}/security-findings-${ORG_B}-*/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { match_all: {} },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    const total = typeof body.hits.total === 'object' ? body.hits.total.value : body.hits.total;

    // Should have exactly the 2 docs we seeded for Org B
    expect(total).toBe(2);

    for (const hit of body.hits.hits) {
      expect(hit._source.test_marker).toBe(ORG_B_MARKER);
      expect(hit._source.shipsec?.organization_id).toBe(ORG_B);
    }
  });

  e2eTest('Wildcard index search across all orgs shows all docs (backend prevents this)', { timeout: 30000 }, async () => {
    // This verifies that OpenSearch itself allows wildcard access - the security
    // boundary is at the API layer, not OpenSearch. The API scopes the index
    // pattern per org so this wildcard is never exposed to users.
    const res = await fetch(`${OPENSEARCH_URL}/security-findings-*/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          bool: {
            should: [
              { term: { test_marker: ORG_A_MARKER } },
              { term: { test_marker: ORG_B_MARKER } },
            ],
            minimum_should_match: 1,
          },
        },
        size: 100,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    const total = typeof body.hits.total === 'object' ? body.hits.total.value : body.hits.total;

    // Direct OpenSearch access sees ALL orgs' data (5 total)
    // This is expected - the API layer is what enforces isolation
    expect(total).toBe(5);
  });
});
