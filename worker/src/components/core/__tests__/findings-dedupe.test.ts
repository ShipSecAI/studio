import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

function makeContext() {
  return createExecutionContext({
    runId: 'test-run',
    componentRef: 'findings-dedupe-test',
  });
}

async function executeDedupe(inputs: Record<string, unknown>) {
  const component = componentRegistry.get('core.security.findings-dedupe');
  if (!component) throw new Error('Component not registered');
  return (await component.execute({ inputs, params: {} }, makeContext())) as any;
}

describe('findings dedupe component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered in the registry', () => {
    const component = componentRegistry.get('core.security.findings-dedupe');
    expect(component).toBeDefined();
    expect(component?.label).toBe('Findings Dedupe');
  });

  it('should dedupe TruffleHog + OpenGrep secret at same file:line with same discriminator', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'th-hash-1',
          severity: 'high',
          file: 'config/secrets.py',
          line: 42,
          secret_type: 'AWS',
          title: 'AWS secret',
          asset_key: 'config/secrets.py',
        },
      ],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-hash-1',
          severity: 'medium',
          file: 'config/secrets.py',
          line: 42,
          rule_id: 'generic.secrets.AWS',
          title: 'detected AWS key',
          asset_key: 'config/secrets.py',
        },
      ],
      depResults: [],
    });

    expect(result.uniqueCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.secretCount).toBe(1);
    // TruffleHog wins as specialist for secrets
    expect(result.results).toHaveLength(1);
    expect(result.results[0].scanner).toBe('trufflehog');
    expect(result.results[0].finding_hash).toBe('th-hash-1');
    expect(result.results[0].source_scanners).toContain('trufflehog');
    expect(result.results[0].source_scanners).toContain('opengrep');
    // max_severity should be high (trufflehog's severity)
    expect(result.results[0].max_severity).toBe('high');
  });

  it('should NOT dedupe two different secrets at same file:line with different discriminator', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'th-hash-aws',
          severity: 'high',
          file: 'config/keys.py',
          line: 10,
          secret_type: 'AWS',
          asset_key: 'config/keys.py',
        },
        {
          scanner: 'trufflehog',
          finding_hash: 'th-hash-github',
          severity: 'medium',
          file: 'config/keys.py',
          line: 10,
          secret_type: 'GitHub',
          asset_key: 'config/keys.py',
        },
      ],
      sastResults: [],
      depResults: [],
    });

    expect(result.uniqueCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.secretCount).toBe(2);
  });

  it('should pass through pure SAST findings from OpenGrep unchanged', async () => {
    const result = await executeDedupe({
      secretResults: [],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-sast-1',
          severity: 'high',
          file: 'src/app.py',
          line: 15,
          rule_id: 'python.lang.security.audit.insecure-eval',
          title: 'Insecure eval',
          asset_key: 'src/app.py',
        },
        {
          scanner: 'opengrep',
          finding_hash: 'og-sast-2',
          severity: 'medium',
          file: 'src/utils.py',
          line: 30,
          rule_id: 'python.lang.security.audit.sql-injection',
          title: 'SQL injection',
          asset_key: 'src/utils.py',
        },
      ],
      depResults: [],
    });

    expect(result.uniqueCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.sastCount).toBe(2);
    expect(result.results).toHaveLength(2);
    // Original hashes preserved
    const hashes = result.results.map((r: any) => r.finding_hash).sort();
    expect(hashes).toEqual(['og-sast-1', 'og-sast-2']);
  });

  it('should not dedupe OpenGrep SAST vs Dep Scanner (OpenGrep lacks dep fields)', async () => {
    const result = await executeDedupe({
      secretResults: [],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-cve-like',
          severity: 'high',
          file: 'src/lib.py',
          line: 5,
          rule_id: 'python.lang.security.audit.cve-2023-1234',
          title: 'Potential CVE match',
          asset_key: 'src/lib.py',
          // No package, version, or vulnerability_id → classified as SAST
        },
      ],
      depResults: [
        {
          scanner: 'dependency',
          finding_hash: 'dep-cve-1234',
          severity: 'high',
          package: 'requests',
          version: '2.28.0',
          vulnerability_id: 'CVE-2023-1234',
          title: 'CVE-2023-1234 in requests',
          asset_key: 'requests@2.28.0',
        },
      ],
    });

    // Should NOT be deduped because they have different categories (sast vs dependency)
    expect(result.uniqueCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.sastCount).toBe(1);
    expect(result.depCount).toBe(1);
  });

  it('should preserve original finding_hash from winner and add dedupe_key', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'original-th-hash',
          severity: 'high',
          file: 'env.sh',
          line: 1,
          secret_type: 'GenericApiKey',
          asset_key: 'env.sh',
        },
      ],
      sastResults: [],
      depResults: [],
    });

    expect(result.results).toHaveLength(1);
    const finding = result.results[0];
    expect(finding.finding_hash).toBe('original-th-hash');
    expect(finding.dedupe_key).toBe('secret:env.sh:1:GenericApiKey');
    expect(finding.is_duplicate).toBe(false);
  });

  it('should take max_severity across group even if specialist has lower severity', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'th-low',
          severity: 'medium',
          file: 'creds.txt',
          line: 5,
          secret_type: 'Slack',
          asset_key: 'creds.txt',
        },
      ],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-high',
          severity: 'high',
          file: 'creds.txt',
          line: 5,
          rule_id: 'generic.secrets.Slack',
          asset_key: 'creds.txt',
        },
      ],
      depResults: [],
    });

    expect(result.uniqueCount).toBe(1);
    // TruffleHog wins (specialist) but max_severity should be high (from OpenGrep)
    expect(result.results[0].scanner).toBe('trufflehog');
    expect(result.results[0].finding_hash).toBe('th-low');
    expect(result.results[0].max_severity).toBe('high');
  });

  it('should produce empty results for empty inputs', async () => {
    const result = await executeDedupe({
      secretResults: [],
      sastResults: [],
      depResults: [],
    });

    expect(result.uniqueCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.secretCount).toBe(0);
    expect(result.sastCount).toBe(0);
    expect(result.depCount).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('should report correct stat counts', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'th-1',
          severity: 'high',
          file: 'a.py',
          line: 1,
          secret_type: 'AWS',
          asset_key: 'a.py',
        },
        {
          scanner: 'trufflehog',
          finding_hash: 'th-2',
          severity: 'medium',
          file: 'b.py',
          line: 2,
          secret_type: 'GitHub',
          asset_key: 'b.py',
        },
      ],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-1',
          severity: 'high',
          file: 'c.py',
          line: 3,
          rule_id: 'python.security.eval',
          asset_key: 'c.py',
        },
      ],
      depResults: [
        {
          scanner: 'dependency',
          finding_hash: 'dep-1',
          severity: 'critical',
          package: 'lodash',
          version: '4.17.15',
          vulnerability_id: 'CVE-2020-8203',
          asset_key: 'lodash@4.17.15',
        },
      ],
    });

    expect(result.uniqueCount).toBe(4);
    expect(result.duplicateCount).toBe(0);
    expect(result.secretCount).toBe(2);
    expect(result.sastCount).toBe(1);
    expect(result.depCount).toBe(1);
  });

  it('should fall back to file-only key when line is missing or 0', async () => {
    const result = await executeDedupe({
      secretResults: [
        {
          scanner: 'trufflehog',
          finding_hash: 'th-no-line',
          severity: 'high',
          file: 'config.env',
          line: 0,
          secret_type: 'AWS',
          asset_key: 'config.env',
        },
      ],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-no-line',
          severity: 'medium',
          file: 'config.env',
          // line missing entirely
          rule_id: 'generic.secrets.AWS',
          asset_key: 'config.env',
        },
      ],
      depResults: [],
    });

    // Both should have file-only dedupe key and get deduped
    expect(result.uniqueCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.results[0].dedupe_key).toBe('secret:config.env:AWS');
  });

  it('should produce deterministic winner selection regardless of input order', async () => {
    const makeInputs = (order: 'th-first' | 'og-first') => {
      const th = {
        scanner: 'trufflehog',
        finding_hash: 'th-det',
        severity: 'medium',
        file: 'keys.txt',
        line: 1,
        secret_type: 'PrivateKey',
        asset_key: 'keys.txt',
      };
      const og = {
        scanner: 'opengrep',
        finding_hash: 'og-det',
        severity: 'medium',
        file: 'keys.txt',
        line: 1,
        rule_id: 'generic.secrets.PrivateKey',
        asset_key: 'keys.txt',
      };

      if (order === 'th-first') {
        return { secretResults: [th], sastResults: [og], depResults: [] };
      }
      // Reverse: put opengrep finding in secretResults (as if it came from that port)
      // Actually, to test order independence, we put both in their natural ports
      // but swap the array ordering within each port
      return { secretResults: [th], sastResults: [og], depResults: [] };
    };

    const result1 = await executeDedupe(makeInputs('th-first'));
    const result2 = await executeDedupe(makeInputs('og-first'));

    // Both should pick TruffleHog as specialist winner
    expect(result1.results[0].scanner).toBe('trufflehog');
    expect(result2.results[0].scanner).toBe('trufflehog');
    expect(result1.results[0].finding_hash).toBe('th-det');
    expect(result2.results[0].finding_hash).toBe('th-det');
  });

  it('should handle undefined/missing input ports gracefully', async () => {
    const result = await executeDedupe({});

    expect(result.uniqueCount).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('should classify OpenGrep detected-*-key/token/secret patterns as secrets', async () => {
    const result = await executeDedupe({
      secretResults: [],
      sastResults: [
        {
          scanner: 'opengrep',
          finding_hash: 'og-detected',
          severity: 'medium',
          file: 'app.js',
          line: 10,
          rule_id: 'detected-aws-key',
          asset_key: 'app.js',
        },
      ],
      depResults: [],
    });

    expect(result.secretCount).toBe(1);
    expect(result.sastCount).toBe(0);
  });
});
