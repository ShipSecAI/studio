import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';

import { BifrostClientService } from '../bifrost-client.service';

describe('BifrostClientService', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...envSnapshot,
      BIFROST_PROXY_URL: 'http://bifrost.local:4000',
      BIFROST_MASTER_KEY: 'sk-master',
    };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  test('getTeamInfo resolves team by name and returns budget usage', async () => {
    const teamId = 'team-uuid-123';
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);

      // First call: list teams to resolve name → UUID
      if (url.includes('/api/governance/teams?')) {
        return new Response(
          JSON.stringify({
            teams: [
              { id: teamId, name: 'org-1' },
              { id: 'other-uuid', name: 'org-2' },
            ],
            count: 2,
            total_count: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Second call: get team info with budget
      if (url.includes(`/api/governance/teams/${teamId}`)) {
        return new Response(
          JSON.stringify({
            team: {
              id: teamId,
              name: 'org-1',
              budget: {
                id: 'budget-1',
                max_limit: 50,
                current_usage: 12.35,
                reset_duration: '1M',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new BifrostClientService();
    await expect(service.getTeamInfo('org-1')).resolves.toEqual({
      spend: 12.35,
      maxBudget: 50,
    });
  });

  test('getTeamSpend returns current_usage from team budget', async () => {
    const teamId = 'team-uuid-456';
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);

      if (url.includes('/api/governance/teams?')) {
        return new Response(
          JSON.stringify({
            teams: [{ id: teamId, name: 'org-1' }],
            count: 1,
            total_count: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes(`/api/governance/teams/${teamId}`)) {
        return new Response(
          JSON.stringify({
            team: {
              id: teamId,
              name: 'org-1',
              budget: {
                id: 'budget-1',
                max_limit: 100,
                current_usage: 3.25,
                reset_duration: '1M',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new BifrostClientService();
    await expect(
      service.getTeamSpend(
        'org-1',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(3.25);
  });

  test('getTeamSpend returns 0 when team not found', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ teams: [], count: 0, total_count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new BifrostClientService();
    await expect(
      service.getTeamSpend(
        'nonexistent-org',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(0);
  });
});
