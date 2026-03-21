import { describe, expect, it } from 'bun:test';
import { transformAsmAssetsResponse } from '../useAsmQueries';

describe('transformAsmAssetsResponse', () => {
  it('hydrates asset fields from ClickHouse result and uses distinctCount for total', () => {
    const result = transformAsmAssetsResponse({
      total: 3,
      results: [
        {
          id: 'asset-1',
          asset_key: 'api.example.com',
          scanner: 'httpx',
          url: 'https://api.example.com',
          technologies: ['nginx'],
          status_code: 200,
        },
      ],
      distinctCount: 1,
    });

    expect(result.total).toBe(1);
    expect(result.hits[0]).toMatchObject({
      host: 'api.example.com',
      url: 'https://api.example.com',
      technologies: ['nginx'],
      status_code: 200,
    });
  });

  it('falls back to total when distinctCount is not provided', () => {
    const result = transformAsmAssetsResponse({
      total: 5,
      results: [
        {
          id: 'asset-2',
          asset_key: 'web.example.com',
          scanner: 'dnsx',
        },
      ],
    });

    expect(result.total).toBe(5);
    expect(result.hits[0].host).toBe('web.example.com');
  });
});
