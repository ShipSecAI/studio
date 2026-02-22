import { describe, expect, it } from 'bun:test';
import { parseFinding } from '../securityQueryHelpers';

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
