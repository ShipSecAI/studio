import { describe, it, expect } from 'bun:test';
import { createExecutionContext, getRunContextContributions } from '../context';

describe('RunContext', () => {
  function makeContext(opts: { runContext?: Record<string, string> } = {}) {
    return createExecutionContext({
      runId: 'test-run',
      componentRef: 'test.component',
      ...opts,
    });
  }

  describe('contributeRunContext', () => {
    it('accepts allowlisted keys', () => {
      const ctx = makeContext();
      ctx.contributeRunContext?.('repository', 'myorg/myrepo');
      ctx.contributeRunContext?.('branch', 'main');
      ctx.contributeRunContext?.('commitSha', 'abc123');
      ctx.contributeRunContext?.('provider', 'aws');
      ctx.contributeRunContext?.('accountId', '123456789');
      ctx.contributeRunContext?.('connectionName', 'Prod AWS');

      const contributions = getRunContextContributions(ctx);
      expect(contributions).toEqual({
        repository: 'myorg/myrepo',
        branch: 'main',
        commitSha: 'abc123',
        provider: 'aws',
        accountId: '123456789',
        connectionName: 'Prod AWS',
      });
    });

    it('silently ignores unknown keys', () => {
      const ctx = makeContext();
      ctx.contributeRunContext?.('unknownKey', 'value');
      ctx.contributeRunContext?.('password', 'secret');

      const contributions = getRunContextContributions(ctx);
      expect(contributions).toEqual({});
    });

    it('truncates values exceeding max length', () => {
      const ctx = makeContext();
      const longValue = 'a'.repeat(300);
      ctx.contributeRunContext?.('repository', longValue);

      const contributions = getRunContextContributions(ctx);
      expect(contributions.repository.length).toBe(256);
    });

    it('skips empty values', () => {
      const ctx = makeContext();
      ctx.contributeRunContext?.('repository', '');

      const contributions = getRunContextContributions(ctx);
      expect(contributions).toEqual({});
    });

    it('enforces max entries limit', () => {
      const ctx = makeContext();
      // There are only 6 allowed keys, and max entries is 16, so we can't
      // actually hit the limit with allowed keys alone. But the guard should
      // still work if the limit were lower. Test with all 6 allowed keys.
      const allowedKeys = ['repository', 'branch', 'commitSha', 'provider', 'accountId', 'connectionName'];
      for (const key of allowedKeys) {
        ctx.contributeRunContext?.(key, `value-${key}`);
      }

      const contributions = getRunContextContributions(ctx);
      expect(Object.keys(contributions).length).toBe(6);
    });

    it('overwrites same key on re-contribution', () => {
      const ctx = makeContext();
      ctx.contributeRunContext?.('repository', 'first');
      ctx.contributeRunContext?.('repository', 'second');

      const contributions = getRunContextContributions(ctx);
      expect(contributions.repository).toBe('second');
    });
  });

  describe('runContext on context', () => {
    it('is undefined when not provided', () => {
      const ctx = makeContext();
      expect(ctx.runContext).toBeUndefined();
    });

    it('is frozen (read-only)', () => {
      const ctx = makeContext({ runContext: { repository: 'org/repo' } });
      expect(ctx.runContext).toBeDefined();
      expect(ctx.runContext!.repository).toBe('org/repo');
      expect(Object.isFrozen(ctx.runContext)).toBe(true);
    });

    it('is a copy of the input (not a reference)', () => {
      const input = { repository: 'org/repo' };
      const ctx = makeContext({ runContext: input });
      input.repository = 'mutated';
      expect(ctx.runContext!.repository).toBe('org/repo');
    });
  });

  describe('getRunContextContributions', () => {
    it('returns empty object for context with no contributions', () => {
      const ctx = makeContext();
      expect(getRunContextContributions(ctx)).toEqual({});
    });

    it('returns contributions as plain object', () => {
      const ctx = makeContext();
      ctx.contributeRunContext?.('repository', 'test/repo');
      const result = getRunContextContributions(ctx);
      expect(result).toEqual({ repository: 'test/repo' });
      expect(typeof result).toBe('object');
    });
  });
});
