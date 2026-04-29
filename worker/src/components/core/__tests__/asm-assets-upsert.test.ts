import { describe, expect, it, beforeAll } from 'bun:test';
import { componentRegistry } from '../../index';
import { buildAsmAssetUpserts } from '../asm-assets-upsert';

describe('asm assets upsert component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.asm.assets-upsert');
    expect(component).toBeDefined();
    expect(component?.label).toBe('ASM Assets Upsert');
  });

  it('builds inventory payloads from deduped DNS and HTTP recon results', () => {
    const assets = buildAsmAssetUpserts([
      {
        scanner: 'httpx',
        finding_hash: 'http-1',
        severity: 'info',
        asset_key: 'vibe.shipsec.ai',
        host: 'vibe.shipsec.ai',
        url: 'https://vibe.shipsec.ai',
        status_code: 200,
        title: 'ShipSec',
        webserver: 'cloudflare',
        technologies: ['React', 'Vite'],
        ip: '1.2.3.4',
        answers: { a: ['1.2.3.4'], aaaa: ['2001:db8::1'] },
        scanner_labels: ['dnsx', 'httpx'],
      },
      {
        scanner: 'dnsx',
        finding_hash: 'dns-1',
        severity: 'info',
        asset_key: 'vibe.shipsec.ai',
        host: 'vibe.shipsec.ai',
        answers: { a: ['1.2.3.4'] },
      },
    ]);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.hostname).toBe('vibe.shipsec.ai');
    expect(assets[0]?.ipAddresses.sort()).toEqual(['1.2.3.4', '2001:db8::1']);
    expect(assets[0]?.techStack).toEqual(['React', 'Vite', 'cloudflare']);
    expect(assets[0]?.ports).toEqual([{ port: 443, protocol: 'tcp', service: '' }]);
    expect(assets[0]?.dnsRecords).toEqual({ answers: { a: ['1.2.3.4'] } });
    expect(assets[0]?.tlsInfo).toEqual({ scheme: 'https', observedHttps: true });
    expect(assets[0]?.metadata?.url).toBe('https://vibe.shipsec.ai');
    expect(assets[0]?.metadata?.status_code).toBe(200);
  });

  it('skips records that do not identify a host', () => {
    const assets = buildAsmAssetUpserts([
      {
        scanner: 'dnsx',
        finding_hash: 'dns-1',
        severity: 'info',
        asset_key: '',
      },
    ]);

    expect(assets).toEqual([]);
  });
});
