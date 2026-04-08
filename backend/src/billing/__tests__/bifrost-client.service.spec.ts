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

  test('uses the period spend report rather than cumulative team info', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/global/spend/report')) {
        return new Response(
          JSON.stringify({
            group_by_day: [
              {
                date: '2026-03-06',
                teams: [{ team_name: 'org-1', total_spend: 12.3456 }],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          team_id: 'org-1',
          team_info: {
            team_id: 'org-1',
            spend: 999.99,
            max_budget: 50,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new BifrostClientService();
    await expect(service.getTeamInfo('org-1')).resolves.toEqual({
      spend: 999.99,
      maxBudget: 50,
    });
    await expect(
      service.getTeamSpend(
        'org-1',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).resolves.toBe(12.35);
  });

  test('falls back to global spend report when team info is unavailable', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/team/info')) {
        return new Response('not found', { status: 404 });
      }

      return new Response(
        JSON.stringify({
          group_by_day: [
            {
              date: '2026-03-06',
              teams: [
                { team_name: 'org-1', total_spend: 3.25 },
                { team_name: 'org-2', total_spend: 9.99 },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
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

  test('falls back to cumulative team info spend in local test mode when spend report is enterprise-only', async () => {
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    process.env = {
      ...process.env,
      BIFROST_ALLOW_TEAM_INFO_SPEND_FALLBACK: 'true',
    };

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/global/spend/report')) {
        return new Response(
          JSON.stringify({
            detail: {
              error:
                '/spend/report endpoint You must be a LiteLLM Enterprise user to use this feature.',
            },
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          team_id: 'org-1',
          team_info: {
            team_id: 'org-1',
            spend: 1.23,
            max_budget: 50,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new BifrostClientService();
    await expect(service.getTeamSpend('org-1', currentMonthStart, nextMonthStart)).resolves.toBe(
      1.23,
    );
  });
});
