import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchOrgVirtualKey, requireOrgVirtualKey, resetAiGatewayProviderForTests } from '../utils';

describe('AI gateway key helpers', () => {
  beforeEach(() => {
    resetAiGatewayProviderForTests();
    delete process.env.CHAT_AI_BASE_URL;
    delete process.env.CHAT_AI_API_KEY;
    delete process.env.BIFROST_BASE_URL;
    delete process.env.BIFROST_API_KEY;
  });

  test('fetchOrgVirtualKey returns the configured CHAT_AI_API_KEY', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-org-123';

    await expect(fetchOrgVirtualKey('org-123')).resolves.toBe('sk-org-123');
  });

  test('fetchOrgVirtualKey falls back to legacy BIFROST envs', async () => {
    process.env.BIFROST_BASE_URL = 'https://legacy-gateway.local/v1';
    process.env.BIFROST_API_KEY = 'sk-legacy-456';

    await expect(fetchOrgVirtualKey('org-456')).resolves.toBe('sk-legacy-456');
  });

  test('fetchOrgVirtualKey caches successful lookups', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-org-cache';

    await expect(fetchOrgVirtualKey('org-cache')).resolves.toBe('sk-org-cache');
    process.env.CHAT_AI_API_KEY = 'sk-new-value';
    await expect(fetchOrgVirtualKey('org-cache')).resolves.toBe('sk-org-cache');
  });

  test('requireOrgVirtualKey rejects when no AI gateway is configured', async () => {
    await expect(requireOrgVirtualKey(null, { consumer: 'Chat AI' })).rejects.toThrow(
      'AI gateway routing is not enabled.',
    );
  });

  test('requireOrgVirtualKey resolves a shared gateway key without an org id', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-shared';

    await expect(requireOrgVirtualKey(null, { consumer: 'AI Agent' })).resolves.toBe('sk-shared');
  });
});
