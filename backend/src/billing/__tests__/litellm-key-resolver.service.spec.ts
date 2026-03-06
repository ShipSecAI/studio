import { beforeEach, describe, expect, test, vi } from 'bun:test';

import { LiteLLMKeyResolverService } from '../litellm-key-resolver.service';

describe('LiteLLMKeyResolverService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('re-syncs the org team budget before returning a cached key', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
        }),
      }),
    } as any;

    const litellm = {
      isConfigured: true,
      ensureTeam: vi.fn(async () => undefined),
      generateKey: vi.fn(async () => 'sk-org-key'),
    } as any;

    const plansService = {
      getPlanByTier: vi.fn(async () => ({ aiBudgetUsdCents: 5000 })),
    } as any;

    const orgSettingsService = {
      getOrganizationSettings: vi.fn(async () => ({ subscriptionTier: 'pro' })),
    } as any;

    const service = new LiteLLMKeyResolverService(db, litellm, plansService, orgSettingsService);

    await expect(service.resolveVirtualKey('org-1')).resolves.toBe('sk-org-key');
    (service as any).teamSyncCache.set('org-1', Date.now() - 10 * 60 * 1000);
    await expect(service.resolveVirtualKey('org-1')).resolves.toBe('sk-org-key');

    expect(litellm.generateKey).toHaveBeenCalledTimes(1);
    expect(litellm.ensureTeam).toHaveBeenCalledTimes(2);
    expect(litellm.ensureTeam).toHaveBeenLastCalledWith('org-1', 50);
  });
});
