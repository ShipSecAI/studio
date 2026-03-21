import { describe, expect, it } from 'bun:test';
import { buildBaseFilter, parseFinding, INITIAL_FILTERS } from '../securityQueryHelpers';

describe('buildBaseFilter — status filter', () => {
  const base = { ...INITIAL_FILTERS };

  it('uses simple in filter for cloud-only view', () => {
    const result = buildBaseFilter({ ...base, status: ['FAILED'] }, { scannerTerms: ['prowler'] });
    const statusFilter = result.filters.find((f) => f.field === 'status');
    expect(statusFilter).toEqual({ field: 'status', op: 'in', value: ['FAILED'] });
  });

  it('uses in filter with empty string for mixed/all-findings view (no viewFilter)', () => {
    const result = buildBaseFilter({ ...base, status: ['FAILED'] });
    const statusFilter = result.filters.find((f) => f.field === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.op).toBe('in');
    expect(statusFilter!.value).toEqual(['FAILED', '']);
  });

  it('uses in filter with empty string for code-security view', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED'] },
      { scannerTerms: ['opengrep', 'trufflehog'] },
    );
    const statusFilter = result.filters.find((f) => f.field === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.value).toEqual(['FAILED', '']);
  });

  it('uses simple in filter for supabase-scanner only view', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED'] },
      { scannerTerms: ['supabase-scanner'] },
    );
    const statusFilter = result.filters.find((f) => f.field === 'status');
    expect(statusFilter).toEqual({ field: 'status', op: 'in', value: ['FAILED'] });
  });

  it('does not add status filter when status array is empty', () => {
    const result = buildBaseFilter({ ...base, status: [] });
    const hasStatus = result.filters.some((f) => f.field === 'status');
    expect(hasStatus).toBe(false);
  });

  it('passes multiple status values through in filter', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED', 'PASSED'] },
      { scannerTerms: ['prowler', 'opengrep'] },
    );
    const statusFilter = result.filters.find((f) => f.field === 'status');
    expect(statusFilter!.value).toEqual(['FAILED', 'PASSED', '']);
  });

  it('emits compliance filter for array column', () => {
    const result = buildBaseFilter({ ...base, compliance: ['cis-aws'] });
    const complianceFilter = result.filters.find((f) => f.field === 'compliance');
    expect(complianceFilter).toEqual({ field: 'compliance', op: 'in', value: ['cis-aws'] });
  });
});

describe('parseFinding', () => {
  it('humanizes OpenGrep title when title is the raw rule id', () => {
    const finding = parseFinding({
      id: 'finding-1',
      scanner: 'opengrep',
      rule_id: 'php.lang.security.md5-loose-equality.md5-loose-equality',
      title: 'php.lang.security.md5-loose-equality.md5-loose-equality',
    });

    expect(finding.title).toBe('MD5 Loose Equality');
  });

  it('returns null status for non-status-aware scanners', () => {
    const finding = parseFinding({
      id: 'finding-httpx',
      scanner: 'httpx',
      title: 'HTTP probe result',
    });

    expect(finding.status).toBeNull();
  });

  it('preserves status for status-aware scanners', () => {
    const finding = parseFinding({
      id: 'finding-prowler',
      scanner: 'prowler',
      status: 'FAILED',
      title: 'S3 bucket public',
    });

    expect(finding.status).toBe('FAILED');
  });

  it('keeps existing human-readable title', () => {
    const finding = parseFinding({
      id: 'finding-2',
      scanner: 'opengrep',
      rule_id: 'php.lang.security.injection.tainted-filename.tainted-filename',
      title: 'Potential path traversal via user-controlled filename',
    });

    expect(finding.title).toBe('Potential path traversal via user-controlled filename');
  });
});
