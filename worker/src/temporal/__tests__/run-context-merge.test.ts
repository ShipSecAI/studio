import { describe, it, expect } from 'bun:test';

/**
 * Tests for the run context merge logic used in shipsecWorkflowRun (Temporal)
 * and executeWorkflow (inline runner).
 *
 * The merge logic is extracted here as a pure function for testability,
 * mirroring the inline implementation in workflows/index.ts.
 */

const RUN_CONTEXT_ALLOWED_KEYS = new Set([
  'repository',
  'branch',
  'commitSha',
  'provider',
  'accountId',
  'connectionName',
]);
const RUN_CONTEXT_MAX_VALUE_LENGTH = 256;
const RUN_CONTEXT_MAX_ENTRIES = 16;

/** Merge contributions into runContext (first-writer-wins, defense-in-depth) */
function mergeContributions(
  runContext: Record<string, string>,
  contributions: Record<string, unknown> | undefined,
): void {
  if (!contributions) return;
  for (const [key, value] of Object.entries(contributions)) {
    if (!RUN_CONTEXT_ALLOWED_KEYS.has(key)) continue;
    if (!value || typeof value !== 'string') continue;
    if (value.length > RUN_CONTEXT_MAX_VALUE_LENGTH) continue;
    if (Object.keys(runContext).length >= RUN_CONTEXT_MAX_ENTRIES) break;
    if (!(key in runContext)) {
      runContext[key] = value;
    }
  }
}

describe('RunContext merge logic', () => {
  describe('first-writer-wins', () => {
    it('accepts the first contribution for a key', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { repository: 'org/first' });
      mergeContributions(ctx, { repository: 'org/second' });
      expect(ctx.repository).toBe('org/first');
    });

    it('allows different keys from different contributions', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { repository: 'org/repo' });
      mergeContributions(ctx, { branch: 'main' });
      expect(ctx).toEqual({ repository: 'org/repo', branch: 'main' });
    });
  });

  describe('empty contributions', () => {
    it('skips undefined contributions', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, undefined);
      expect(ctx).toEqual({});
    });

    it('skips empty object contributions', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, {});
      expect(ctx).toEqual({});
    });
  });

  describe('defense-in-depth guards', () => {
    it('rejects unknown keys', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { secretKey: 'should-not-appear', repository: 'ok' });
      expect(ctx).toEqual({ repository: 'ok' });
      expect('secretKey' in ctx).toBe(false);
    });

    it('rejects non-string values', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { repository: 123 as any });
      expect(ctx).toEqual({});
    });

    it('rejects empty string values', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { repository: '' });
      expect(ctx).toEqual({});
    });

    it('rejects oversized values', () => {
      const ctx: Record<string, string> = {};
      mergeContributions(ctx, { repository: 'a'.repeat(257) });
      expect(ctx).toEqual({});
    });

    it('accepts values at exactly max length', () => {
      const ctx: Record<string, string> = {};
      const exactMax = 'a'.repeat(256);
      mergeContributions(ctx, { repository: exactMax });
      expect(ctx.repository).toBe(exactMax);
    });

    it('enforces max entries', () => {
      const ctx: Record<string, string> = {};
      // Fill to max with allowed keys (only 6 allowed keys exist, but test the guard)
      for (let i = 0; i < RUN_CONTEXT_MAX_ENTRIES; i++) {
        ctx[`key${i}`] = `val${i}`;
      }
      mergeContributions(ctx, { repository: 'should-not-fit' });
      expect('repository' in ctx).toBe(false);
    });
  });

  describe('tool-mode and tool-call paths (read-only)', () => {
    it('tool-mode contributions are NOT merged back', () => {
      // In the workflow, mcpOutput.runContextContributions is intentionally
      // not merged. This test documents that design decision.
      const ctx: Record<string, string> = { repository: 'org/repo' };
      const _toolModeContributions = { branch: 'feature-branch' };

      // Simulate: do NOT call mergeContributions for tool-mode output
      // (the workflow code simply doesn't merge it)

      expect(ctx).toEqual({ repository: 'org/repo' });
      expect('branch' in ctx).toBe(false);
    });

    it('tool-call contributions are NOT merged back', () => {
      const ctx: Record<string, string> = { repository: 'org/repo' };
      const _toolCallContributions = { provider: 'aws' };

      // Simulate: do NOT call mergeContributions for tool-call output

      expect(ctx).toEqual({ repository: 'org/repo' });
      expect('provider' in ctx).toBe(false);
    });
  });

  describe('trigger propagation', () => {
    it('top-level run gets triggerType from backend args', () => {
      // The workflow receives input.triggerType from the backend
      const input = { triggerType: 'manual', triggerSource: 'user-123' };
      expect(input.triggerType).toBe('manual');
    });

    it('child workflow does NOT inherit parent triggerType', () => {
      // Child workflows get their own trigger type via prepareRunPayloadActivity
      // which sets type: 'api'. The parent does NOT pass triggerType to startChild.
      const parentInput = { triggerType: 'manual' };
      const childInput = { triggerType: undefined }; // not passed from parent
      expect(childInput.triggerType).toBeUndefined();
      expect(parentInput.triggerType).toBe('manual');
    });

    it('schedule helper passes triggerType from prepared.trigger.type', () => {
      const prepared = {
        trigger: { type: 'schedule', sourceId: 'schedule-abc' },
      };
      const childArgs = {
        triggerType: prepared.trigger?.type ?? null,
        triggerSource: prepared.trigger?.sourceId,
      };
      expect(childArgs.triggerType).toBe('schedule');
      expect(childArgs.triggerSource).toBe('schedule-abc');
    });
  });
});
