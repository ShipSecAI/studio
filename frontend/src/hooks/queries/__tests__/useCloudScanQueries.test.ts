import { describe, expect, it } from 'bun:test';
import { transformCloudScanFindingsResponse } from '../useCloudScanQueries';

describe('transformCloudScanFindingsResponse', () => {
  it('parses findings, severity counts, and truncation flag', () => {
    const result = transformCloudScanFindingsResponse({
      total: 5,
      results: [
        {
          id: 'f-1',
          severity: 'critical',
          status: 'FAILED',
          title: 'Critical issue',
          run_id: 'run-1',
          timestamp: '2026-02-19T12:00:00.000Z',
        },
        {
          id: 'f-2',
          severity: 'high',
          status: 'OPEN',
          title: 'High issue',
          run_id: 'run-1',
          timestamp: '2026-02-19T11:00:00.000Z',
        },
      ],
      aggregations: {
        severity_counts: [
          { key: 'critical', count: 2 },
          { key: 'high', count: 2 },
          { key: 'medium', count: 1 },
        ],
      },
    });

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].id).toBe('f-1');
    expect(result.severityCounts).toEqual({
      critical: 2,
      high: 2,
      medium: 1,
      low: 0,
      info: 0,
    });
    expect(result.total).toBe(5);
    expect(result.isTruncated).toBe(true);
  });

  it('marks non-truncated when returned results match total', () => {
    const result = transformCloudScanFindingsResponse({
      total: 1,
      results: [
        {
          id: 'f-1',
          severity: 'low',
          status: 'OPEN',
          title: 'Low issue',
          run_id: 'run-2',
          timestamp: '2026-02-19T10:00:00.000Z',
        },
      ],
      aggregations: {
        severity_counts: [{ key: 'low', count: 1 }],
      },
    });

    expect(result.total).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.isTruncated).toBe(false);
  });
});
