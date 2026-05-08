import { beforeEach, describe, expect, test } from 'bun:test';

import {
  fetchOrganizationApiKey,
  requireOrganizationApiKey,
  resetAiGatewayProviderForTests,
} from '../utils';

describe('AI gateway key helpers', () => {
  beforeEach(() => {
    resetAiGatewayProviderForTests();
    delete process.env.CHAT_AI_BASE_URL;
    delete process.env.CHAT_AI_API_KEY;
    delete process.env.BIFROST_BASE_URL;
    delete process.env.BIFROST_API_KEY;
  });

  test('returns the configured shared CHAT_AI_API_KEY', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-org-123';

    await expect(fetchOrganizationApiKey('org-123')).resolves.toBe('sk-org-123');
  });

  test('caches the shared AI gateway key once resolved', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-org-cache';

    await expect(fetchOrganizationApiKey('org-cache')).resolves.toBe('sk-org-cache');
    process.env.CHAT_AI_API_KEY = 'sk-new-value';
    await expect(fetchOrganizationApiKey('org-cache')).resolves.toBe('sk-org-cache');
  });

  test('rejects when the AI gateway is not configured', async () => {
    await expect(requireOrganizationApiKey(null, { consumer: 'Chat AI' })).rejects.toThrow(
      'AI gateway routing is not enabled.',
    );
  });

  test('resolves the shared AI gateway key without an organization id', async () => {
    process.env.CHAT_AI_BASE_URL = 'https://gateway.local/v1';
    process.env.CHAT_AI_API_KEY = 'sk-shared';

    await expect(requireOrganizationApiKey(null, { consumer: 'AI Agent' })).resolves.toBe(
      'sk-shared',
    );
  });

  test('uses Bifrost as the shared AI gateway when CHAT_AI is absent', async () => {
    process.env.BIFROST_BASE_URL = 'http://shipsec-bifrost.shipsec-system:4000/v1';
    process.env.BIFROST_API_KEY = 'sk-bifrost';

    await expect(requireOrganizationApiKey(null, { consumer: 'OpenCode agent' })).resolves.toBe(
      'sk-bifrost',
    );
  });
});
