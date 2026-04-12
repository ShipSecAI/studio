import { beforeEach, describe, expect, test, vi } from 'bun:test';

const getBifrostVirtualKeyMock = vi.fn();
const createInternalBackendClientMock = vi.fn(() => ({
  getBifrostVirtualKey: getBifrostVirtualKeyMock,
}));

vi.mock('../../../utils/internal-backend-client', () => ({
  createInternalBackendClient: createInternalBackendClientMock,
}));

import { fetchOrgVirtualKey, requireOrgVirtualKey } from '../utils';

describe('Bifrost org key helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getBifrostVirtualKeyMock.mockReset();
    createInternalBackendClientMock.mockClear();

    process.env.BIFROST_BASE_URL = 'http://bifrost.local:4000/v1';
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    process.env.API_BASE_URL = 'http://backend.local/api/v1';
    delete process.env.STUDIO_API_BASE_URL;
    delete process.env.SHIPSEC_API_BASE_URL;
  });

  test('fetchOrgVirtualKey uses the internal backend client with a normalized base URL', async () => {
    getBifrostVirtualKeyMock.mockResolvedValue({
      data: { virtualKey: 'sk-org-123' },
    });

    await expect(fetchOrgVirtualKey('org-123')).resolves.toBe('sk-org-123');
    expect(createInternalBackendClientMock).toHaveBeenCalledWith({
      baseUrl: 'http://backend.local',
    });
    expect(getBifrostVirtualKeyMock).toHaveBeenCalledWith('org-123');
  });

  test('fetchOrgVirtualKey accepts a backend origin and normalizes it to /api/v1', async () => {
    getBifrostVirtualKeyMock.mockResolvedValue({
      data: { virtualKey: 'sk-org-456' },
    });

    await expect(fetchOrgVirtualKey('org-456', 'http://backend.local:3711')).resolves.toBe(
      'sk-org-456',
    );
    expect(createInternalBackendClientMock).toHaveBeenCalledWith({
      baseUrl: 'http://backend.local:3711',
    });
    expect(getBifrostVirtualKeyMock).toHaveBeenCalledWith('org-456');
  });

  test('fetchOrgVirtualKey returns null when the backend cannot resolve a key', async () => {
    getBifrostVirtualKeyMock.mockResolvedValue({
      data: { virtualKey: null },
    });

    await expect(fetchOrgVirtualKey('org-null')).resolves.toBeNull();
  });

  test('fetchOrgVirtualKey caches successful lookups', async () => {
    getBifrostVirtualKeyMock.mockResolvedValue({
      data: { virtualKey: 'sk-org-cache' },
    });

    await expect(fetchOrgVirtualKey('org-cache')).resolves.toBe('sk-org-cache');
    await expect(fetchOrgVirtualKey('org-cache')).resolves.toBe('sk-org-cache');

    expect(createInternalBackendClientMock).toHaveBeenCalledTimes(1);
    expect(getBifrostVirtualKeyMock).toHaveBeenCalledTimes(1);
  });

  test('requireOrgVirtualKey rejects Bifrost calls without an organization', async () => {
    await expect(requireOrgVirtualKey(null, { consumer: 'Chat AI' })).rejects.toThrow(
      'Chat AI requires an organization ID',
    );
  });

  test('requireOrgVirtualKey rejects when the backend cannot resolve a key', async () => {
    getBifrostVirtualKeyMock.mockResolvedValue({
      data: { virtualKey: null },
    });

    await expect(requireOrgVirtualKey('org-missing', { consumer: 'AI Agent' })).rejects.toThrow(
      'could not resolve a Bifrost virtual key',
    );
  });
});
