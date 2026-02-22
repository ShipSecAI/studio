import { describe, expect, it } from 'bun:test';
import { transformCloudScanFindingsResponse } from '../useCloudScanQueries';

describe('transformCloudScanFindingsResponse', () => {
  it('parses findings, severity counts, and truncation flag', () => {
    const result = transformCloudScanFindingsResponse({
      total: 5,
      hits: [
        {
          _id: 'f-1',
          _source: {
            severity: 'critical',
            status: 'FAILED',
            title: 'Critical issue',
            shipsec: { run_id: 'run-1' },
            '@timestamp': '2026-02-19T12:00:00.000Z',
          },
        },
        {
          _id: 'f-2',
          _source: {
            severity: 'high',
            status: 'OPEN',
            title: 'High issue',
            shipsec: { run_id: 'run-1' },
            '@timestamp': '2026-02-19T11:00:00.000Z',
          },
        },
      ],
      aggregations: {
        severity_counts: {
          buckets: [
            { key: 'critical', doc_count: 2 },
            { key: 'high', doc_count: 2 },
            { key: 'medium', doc_count: 1 },
          ],
        },
      },
    });

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]._id).toBe('f-1');
    expect(result.severityCounts).toEqual({
      critical: 2,
      high: 2,
      medium: 1,
      low: 0,
    });
    expect(result.total).toBe(5);
    expect(result.isTruncated).toBe(true);
  });

  it('marks non-truncated when returned hits match total', () => {
    const result = transformCloudScanFindingsResponse({
      total: 1,
      hits: [
        {
          _id: 'f-1',
          _source: {
            severity: 'low',
            status: 'OPEN',
            title: 'Low issue',
            shipsec: { run_id: 'run-2' },
            '@timestamp': '2026-02-19T10:00:00.000Z',
          },
        },
      ],
      aggregations: {
        severity_counts: { buckets: [{ key: 'low', doc_count: 1 }] },
      },
    });

    expect(result.total).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.isTruncated).toBe(false);
  });
});
