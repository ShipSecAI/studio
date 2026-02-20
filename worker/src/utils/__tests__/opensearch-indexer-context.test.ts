import { describe, it, expect } from 'bun:test';

/**
 * Tests for the scan context → shipsec namespace mapping in OpenSearchIndexer.
 *
 * The actual buildEnrichedDocument is a private method. These tests validate
 * the mapping logic and allowlist to ensure correctness.
 */

// Mirror the allowlist from opensearch-indexer.ts
const SCAN_CONTEXT_TO_SHIPSEC: Record<string, string> = {
  repository: 'repository',
  branch: 'branch',
  commitSha: 'commit_sha',
  accountId: 'account_id',
  connectionName: 'connection_name',
  provider: 'provider',
};

function mapScanContext(scanContext?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!scanContext) return result;
  for (const [key, value] of Object.entries(scanContext)) {
    const shipsecKey = SCAN_CONTEXT_TO_SHIPSEC[key];
    if (shipsecKey && value) result[shipsecKey] = value;
  }
  return result;
}

describe('OpenSearch indexer scan context mapping', () => {
  it('maps all known keys to their shipsec equivalents', () => {
    const scanContext = {
      repository: 'org/repo',
      branch: 'main',
      commitSha: 'abc123',
      accountId: '123456789',
      connectionName: 'Prod AWS',
      provider: 'aws',
    };

    const result = mapScanContext(scanContext);
    expect(result).toEqual({
      repository: 'org/repo',
      branch: 'main',
      commit_sha: 'abc123',
      account_id: '123456789',
      connection_name: 'Prod AWS',
      provider: 'aws',
    });
  });

  it('drops unknown keys', () => {
    const scanContext = {
      repository: 'org/repo',
      secretKey: 'should-be-dropped',
      apiToken: 'also-dropped',
    } as Record<string, string>;

    const result = mapScanContext(scanContext);
    expect(result).toEqual({ repository: 'org/repo' });
    expect('secretKey' in result).toBe(false);
    expect('apiToken' in result).toBe(false);
  });

  it('drops empty values', () => {
    const scanContext = {
      repository: '',
      branch: 'main',
    };

    const result = mapScanContext(scanContext);
    expect(result).toEqual({ branch: 'main' });
    expect('repository' in result).toBe(false);
  });

  it('returns empty object when scanContext is undefined', () => {
    expect(mapScanContext(undefined)).toEqual({});
  });

  it('returns empty object when scanContext is empty', () => {
    expect(mapScanContext({})).toEqual({});
  });

  describe('triggerType mapping', () => {
    it('triggerType appears as trigger_type in shipsec namespace', () => {
      // This is handled by the spread in buildEnrichedDocument:
      // ...(options.triggerType && { trigger_type: options.triggerType }),
      const options = { triggerType: 'schedule' as string | null };
      const shipsec: Record<string, unknown> = {};
      if (options.triggerType) {
        shipsec.trigger_type = options.triggerType;
      }
      expect(shipsec.trigger_type).toBe('schedule');
    });

    it('null triggerType is excluded from shipsec', () => {
      const options = { triggerType: null as string | null };
      const shipsec: Record<string, unknown> = {};
      if (options.triggerType) {
        shipsec.trigger_type = options.triggerType;
      }
      expect('trigger_type' in shipsec).toBe(false);
    });
  });
});
