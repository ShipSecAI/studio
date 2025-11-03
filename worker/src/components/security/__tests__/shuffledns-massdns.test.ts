import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { ShufflednsMassdnsInput, ShufflednsMassdnsOutput } from '../shuffledns-massdns';

describe('shuffledns-massdns component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with expected metadata', () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'shipsec.shuffledns.massdns',
    );
    expect(component).toBeDefined();
    expect(component!.label).toBe('Shuffledns + MassDNS');
    expect(component!.category).toBe('security');
    expect(component!.metadata?.slug).toBe('shuffledns-massdns');
  });

  it('normalises plain text output into subdomains array', async () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'shipsec.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({ runId: 'run-1', componentRef: 'shuffledns-test' });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
      mode: 'bruteforce',
      words: ['www', 'api', 'dev'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      'www.example.com\napi.example.com\napi.example.com\n',
    );

    const result = component.outputSchema.parse(await component.execute(params, context));
    expect(result.domainCount).toBe(1);
    // Deduped
    expect(result.subdomains).toEqual(['www.example.com', 'api.example.com']);
    expect(result.subdomainCount).toBe(2);
  });

  it('uses docker runner with correct image', () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'shipsec.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');
    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('ghcr.io/shipsecai/shuffledns-massdns:latest');
      // We no longer depend on a shell entrypoint; the execute path sets
      // the entrypoint to the tool binary and passes flags directly.
      // The static runner definition just provides image/network defaults.
      expect(component.runner.entrypoint).toBeUndefined();
    }
  });
});
