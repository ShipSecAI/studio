import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('asm recon dedupe component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.asm.recon-dedupe');
    expect(component).toBeDefined();
    expect(component?.label).toBe('ASM Recon Dedupe');
  });

  it('should prefer HTTPx enriched record for the same host', async () => {
    const component = componentRegistry.get('core.asm.recon-dedupe');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'asm-recon-dedupe-test',
    });

    const result = (await component.execute(
      {
        inputs: {
          dnsResults: [
            {
              scanner: 'dnsx',
              finding_hash: 'dns-1',
              severity: 'info',
              asset_key: 'vibe.shipsec.ai',
              host: 'vibe.shipsec.ai',
              answers: { a: ['1.2.3.4'] },
            },
          ],
          httpResults: [
            {
              scanner: 'httpx',
              finding_hash: 'http-1',
              severity: 'info',
              asset_key: 'https://vibe.shipsec.ai',
              url: 'https://vibe.shipsec.ai',
              host: 'vibe.shipsec.ai',
              status_code: 200,
              title: 'ShipSec',
            },
          ],
        },
        params: {},
      },
      context,
    )) as any;

    expect(result.uniqueHostCount).toBe(1);
    expect(result.httpPreferredCount).toBe(1);
    expect(result.dnsOnlyCount).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.asset_key).toBe('vibe.shipsec.ai');
    expect(result.results[0]?.host).toBe('vibe.shipsec.ai');
    expect(result.results[0]?.url).toBe('https://vibe.shipsec.ai');
    expect(result.results[0]?.answers).toEqual({ a: ['1.2.3.4'] });
    expect(result.results[0]?.scanner).toBe('httpx');
    expect(result.results[0]?.source_scanner).toBe('httpx');
    expect(result.results[0]?.scanner_labels).toEqual(['dnsx', 'httpx']);
  });

  it('should keep DNS-only hosts when HTTPx has no match', async () => {
    const component = componentRegistry.get('core.asm.recon-dedupe');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'asm-recon-dedupe-test',
    });

    const result = (await component.execute(
      {
        inputs: {
          dnsResults: [
            {
              scanner: 'dnsx',
              finding_hash: 'dns-1',
              severity: 'info',
              asset_key: 'api.shipsec.ai',
              host: 'api.shipsec.ai',
            },
            {
              scanner: 'dnsx',
              finding_hash: 'dns-2',
              severity: 'info',
              asset_key: 'docs.shipsec.ai',
              host: 'docs.shipsec.ai',
            },
          ],
          httpResults: [
            {
              scanner: 'httpx',
              finding_hash: 'http-1',
              severity: 'info',
              asset_key: 'https://api.shipsec.ai',
              url: 'https://api.shipsec.ai',
              host: 'api.shipsec.ai',
              status_code: 200,
            },
          ],
        },
        params: {},
      },
      context,
    )) as any;

    expect(result.uniqueHostCount).toBe(2);
    expect(result.httpPreferredCount).toBe(1);
    expect(result.dnsOnlyCount).toBe(1);
    expect(result.results.map((r: any) => r.host).sort()).toEqual([
      'api.shipsec.ai',
      'docs.shipsec.ai',
    ]);
    const api = result.results.find((r: any) => r.host === 'api.shipsec.ai');
    const docs = result.results.find((r: any) => r.host === 'docs.shipsec.ai');
    expect(api?.scanner).toBe('httpx');
    expect(api?.scanner_labels).toEqual(['dnsx', 'httpx']);
    expect(docs?.scanner).toBe('dnsx');
    expect(docs?.scanner_labels).toEqual(['dnsx']);
  });
});
