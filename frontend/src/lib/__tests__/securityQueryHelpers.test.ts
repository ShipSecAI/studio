import { describe, expect, it } from 'bun:test';
import { buildBaseFilter, parseFinding, INITIAL_FILTERS } from '../securityQueryHelpers';

describe('buildBaseFilter — status filter', () => {
  const base = { ...INITIAL_FILTERS };

  it('uses simple terms filter for cloud-only view', () => {
    const result = buildBaseFilter({ ...base, status: ['FAILED'] }, { scannerTerms: ['prowler'] });
    const statusClause = result.bool.filter.find((f: any) => f.terms?.status);
    expect(statusClause).toEqual({ terms: { status: ['FAILED'] } });
  });

  it('uses smart OR filter for mixed/all-findings view (no viewFilter)', () => {
    const result = buildBaseFilter({ ...base, status: ['FAILED'] });
    const statusClause = result.bool.filter.find((f: any) => f.bool?.should)!;
    expect(statusClause).toBeDefined();
    expect(statusClause.bool.should).toHaveLength(2);
    expect(statusClause.bool.should[0]).toEqual({ terms: { status: ['FAILED'] } });
    expect(statusClause.bool.should[1]).toEqual({
      bool: { must_not: [{ exists: { field: 'status' } }] },
    });
  });

  it('uses smart OR filter for code-security view', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED'] },
      { scannerTerms: ['opengrep', 'trufflehog'] },
    );
    const statusClause = result.bool.filter.find((f: any) => f.bool?.should)!;
    expect(statusClause).toBeDefined();
    expect(statusClause.bool.minimum_should_match).toBe(1);
  });

  it('uses simple terms for supabase-scanner only view', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED'] },
      { scannerTerms: ['supabase-scanner'] },
    );
    const statusClause = result.bool.filter.find((f: any) => f.terms?.status);
    expect(statusClause).toEqual({ terms: { status: ['FAILED'] } });
  });

  it('does not add status filter when status array is empty', () => {
    const result = buildBaseFilter({ ...base, status: [] });
    const hasStatus = result.bool.filter.some((f: any) => f.terms?.status || f.bool?.should);
    expect(hasStatus).toBe(false);
  });

  it('passes multiple status values through in smart filter', () => {
    const result = buildBaseFilter(
      { ...base, status: ['FAILED', 'PASSED'] },
      { scannerTerms: ['prowler', 'opengrep'] },
    );
    const statusClause = result.bool.filter.find((f: any) => f.bool?.should)!;
    expect(statusClause.bool.should[0]).toEqual({
      terms: { status: ['FAILED', 'PASSED'] },
    });
  });
});

describe('parseFinding', () => {
  it('humanizes OpenGrep title when title is the raw rule id', () => {
    const finding = parseFinding({
      _id: 'finding-1',
      _source: {
        scanner: 'opengrep',
        rule_id: 'php.lang.security.md5-loose-equality.md5-loose-equality',
        title: 'php.lang.security.md5-loose-equality.md5-loose-equality',
      },
    });

    expect(finding.title).toBe('MD5 Loose Equality');
  });

  it('keeps existing human-readable title', () => {
    const finding = parseFinding({
      _id: 'finding-2',
      _source: {
        scanner: 'opengrep',
        rule_id: 'php.lang.security.injection.tainted-filename.tainted-filename',
        title: 'Potential path traversal via user-controlled filename',
      },
    });

    expect(finding.title).toBe('Potential path traversal via user-controlled filename');
  });
});
