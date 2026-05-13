import { describe, expect, it } from 'bun:test';
import { validate } from '../codex-code-wiki';

describe('core.ai.codex wiki validation', () => {
  it('allows agents to organize wiki files freely', async () => {
    await expect(
      validate([
        'agent-state/manifests/run-123.yaml',
        'assets/repos/shipsec-studio/overview.md',
        'evidence/pointers/run-123.md',
        'architecture/deployment/runtime.md',
        'whatever/path/the-agent-needs.md',
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects path traversal outside the wiki checkout', async () => {
    await expect(validate(['../outside.md'])).rejects.toThrow('Invalid wiki path: ../outside.md');
  });
});
