import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'path';
import { SecurityAnalyticsService } from '../security-analytics.service';

// Skip by default — requires Docker. Run with: INTEGRATION=1 bun test __tests__/security-analytics
describe.skipIf(!process.env.INTEGRATION)('SecurityAnalyticsService integration', () => {
  let container: any;
  let client: any;
  let service: SecurityAnalyticsService;

  const DEFAULT_META = {
    workflowId: 'wf-test',
    workflowName: 'integration-test',
    runId: 'run-default',
    nodeRef: 'node1',
    componentId: 'comp1',
  };

  beforeAll(async () => {
    // Dynamic imports to avoid WASM load when tests are skipped
    const { ClickHouseContainer } = await import('@testcontainers/clickhouse');
    const { createClient } = await import('@clickhouse/client');

    // 1. Start ClickHouse container
    container = await new ClickHouseContainer('clickhouse/clickhouse-server:latest-alpine')
      .withDatabase('test_shipsec')
      .withCopyFilesToContainer([
        {
          source: resolve(__dirname, '../../../../docker/clickhouse/init-schema.sql'),
          target: '/docker-entrypoint-initdb.d/01-init-schema.sql',
        },
      ])
      .start();

    // 2. Connect with @clickhouse/client
    client = createClient({
      ...container.getClientOptions(),
    });

    // 3. Create service with mock ClickHouseClientService
    const mockClickHouseClientService = {
      getClient: () => client,
      isClientEnabled: () => true,
    } as any;

    service = new SecurityAnalyticsService(mockClickHouseClientService);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('indexDocument and query — basic CRUD', async () => {
    const orgId = 'org-crud';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-crud-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'Test finding',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-crud' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      filters: [{ field: 'scanner', op: 'eq', value: 'prowler' }],
      size: 10,
      useLatest: false,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results[0].scanner).toBe('prowler');
  }, 30_000);

  it('query with severity filter', async () => {
    const orgId = 'org-severity';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-sev-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'critical',
          title: 'Critical vuln',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-sev-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'high',
          title: 'High vuln',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-sev-3',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'medium',
          title: 'Medium vuln',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-severity' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      filters: [{ field: 'severity', op: 'eq', value: 'critical' }],
      size: 10,
      useLatest: false,
    });

    expect(result.total).toBe(1);
    expect(result.results.every((r) => r.severity === 'critical')).toBe(true);
  }, 30_000);

  it('query with search text', async () => {
    const orgId = 'org-search';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-search-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'semgrep',
          severity: 'high',
          title: 'SQL Injection vulnerability',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-search' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      search: 'SQL Injection',
      size: 10,
      useLatest: false,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.title.includes('SQL Injection'))).toBe(true);
  }, 30_000);

  it('aggregations', async () => {
    const orgId = 'org-aggs';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-agg-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'Agg test 1',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-agg-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'critical',
          title: 'Agg test 2',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-agg-3',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'medium',
          title: 'Agg test 3',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-agg-4',
          '@timestamp': new Date().toISOString(),
          scanner: 'semgrep',
          severity: 'high',
          title: 'Agg test 4',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-aggs' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      aggs: [
        { name: 'by_scanner', field: 'scanner' },
        { name: 'by_severity', field: 'severity' },
      ],
      size: 0,
      useLatest: false,
    });

    expect(result.aggregations).toBeDefined();
    expect(result.aggregations!.by_scanner.length).toBeGreaterThanOrEqual(2);
    expect(result.aggregations!.by_severity.length).toBeGreaterThanOrEqual(2);

    const scannerKeys = result.aggregations!.by_scanner.map((b) => b.key);
    expect(scannerKeys).toContain('prowler');
    expect(scannerKeys).toContain('trivy');
  }, 30_000);

  it('timeSeries', async () => {
    const orgId = 'org-timeseries';
    const now = Date.now();

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-ts-1',
          '@timestamp': new Date(now - 1 * 86_400_000).toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'TS 1',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-ts-2',
          '@timestamp': new Date(now - 3 * 86_400_000).toISOString(),
          scanner: 'prowler',
          severity: 'medium',
          title: 'TS 2',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-ts-3',
          '@timestamp': new Date(now - 7 * 86_400_000).toISOString(),
          scanner: 'prowler',
          severity: 'critical',
          title: 'TS 3',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-ts' },
    );

    await delay(2000);

    const result = await service.timeSeries(orgId, { days: 30, interval: 'day' });

    expect(result.buckets.length).toBeGreaterThanOrEqual(1);
    expect(result.buckets[0]).toHaveProperty('date');
    expect(result.buckets[0]).toHaveProperty('severity');
    expect(result.buckets[0]).toHaveProperty('count');
  }, 30_000);

  it('lifecycle', async () => {
    const orgId = 'org-lifecycle';
    const hash = 'hash-lifecycle';
    const now = Date.now();

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: hash,
          '@timestamp': new Date(now - 5 * 86_400_000).toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'LC finding',
          status: 'FAIL',
        },
        {
          finding_hash: hash,
          '@timestamp': new Date(now - 2 * 86_400_000).toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'LC finding',
          status: 'FAIL',
        },
        {
          finding_hash: hash,
          '@timestamp': new Date(now).toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'LC finding',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-lifecycle' },
    );

    await delay(2000);

    const result = await service.lifecycle(orgId, [hash]);

    expect(result[hash]).toBeDefined();
    expect(result[hash].occurrences).toBeGreaterThanOrEqual(2);
    expect(new Date(result[hash].firstSeen).getTime()).toBeLessThan(
      new Date(result[hash].lastSeen).getTime(),
    );
  }, 30_000);

  it('batchRunSeverityCounts', async () => {
    const orgId = 'org-batch';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-ba-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'critical',
          title: 'Batch A',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-ba-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'Batch A',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-a' },
    );

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-bb-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'medium',
          title: 'Batch B',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-bb-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'low',
          title: 'Batch B',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-bb-3',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'low',
          title: 'Batch B',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-b' },
    );

    await delay(2000);

    const result = await service.batchRunSeverityCounts(orgId, ['run-a', 'run-b']);

    expect(result['run-a'].critical).toBe(1);
    expect(result['run-a'].high).toBe(1);
    expect(result['run-b'].medium).toBe(1);
    expect(result['run-b'].low).toBe(2);
  }, 30_000);

  it('purgeOrgData', async () => {
    const orgId = 'purge-test-org';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-purge-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'Purge test',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-purge-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'medium',
          title: 'Purge test 2',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-purge' },
    );

    await delay(2000);

    // Verify data exists
    const before = await service.query(orgId, { size: 10, useLatest: false });
    expect(before.total).toBeGreaterThanOrEqual(1);

    // Purge
    await service.purgeOrgData(orgId);

    // ClickHouse lightweight DELETE is async — wait for mutations to process
    await delay(3000);

    const after = await service.query(orgId, { size: 10, useLatest: false });
    expect(after.total).toBe(0);
  }, 45_000);

  it('distinct query with LIMIT 1 BY', async () => {
    const orgId = 'org-distinct';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-d-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'Distinct 1',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-d-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'medium',
          title: 'Distinct 2',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-d-3',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'high',
          title: 'Distinct 3',
          status: 'FAIL',
        },
        {
          finding_hash: 'hash-d-4',
          '@timestamp': new Date().toISOString(),
          scanner: 'trivy',
          severity: 'low',
          title: 'Distinct 4',
          status: 'FAIL',
        },
      ],
      { ...DEFAULT_META, runId: 'run-distinct' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      distinct: 'scanner',
      size: 10,
      useLatest: false,
    });

    // Should have at most one result per unique scanner value
    const scanners = result.results.map((r) => r.scanner);
    const uniqueScanners = new Set(scanners);
    expect(scanners.length).toBe(uniqueScanners.size);
    expect(uniqueScanners.size).toBe(2); // prowler and trivy
  }, 30_000);

  it('countDistinct', async () => {
    const orgId = 'org-countdistinct';

    await service.bulkIndex(
      orgId,
      [
        {
          finding_hash: 'hash-cd-1',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'CD 1',
          status: 'FAIL',
          asset_key: 'asset-a',
        },
        {
          finding_hash: 'hash-cd-2',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'CD 2',
          status: 'FAIL',
          asset_key: 'asset-b',
        },
        {
          finding_hash: 'hash-cd-3',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'CD 3',
          status: 'FAIL',
          asset_key: 'asset-a',
        },
        {
          finding_hash: 'hash-cd-4',
          '@timestamp': new Date().toISOString(),
          scanner: 'prowler',
          severity: 'high',
          title: 'CD 4',
          status: 'FAIL',
          asset_key: 'asset-c',
        },
      ],
      { ...DEFAULT_META, runId: 'run-cd' },
    );

    await delay(2000);

    const result = await service.query(orgId, {
      countDistinct: 'asset_key',
      size: 0,
      useLatest: false,
    });

    expect(result.distinctCount).toBe(3); // asset-a, asset-b, asset-c
  }, 30_000);
});
