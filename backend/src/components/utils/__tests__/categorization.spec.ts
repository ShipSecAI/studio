import { describe, expect, it } from 'bun:test';

import { categorizeComponent, getCategoryConfig } from '../categorization';

describe('component categorization', () => {
  it('prefers UI category when present', () => {
    const component = {
      id: 'core.aws.org-discovery',
      category: 'transform',
      ui: { category: 'cloud' },
    } as any;

    expect(categorizeComponent(component)).toBe('cloud');
  });

  it('falls back to definition category and defaults for unknown values', () => {
    const fromDefinition = {
      id: 'core.integration.resolve-credentials',
      category: 'core',
    } as any;
    const unknown = {
      id: 'core.unknown',
      category: 'not-a-category',
    } as any;

    expect(categorizeComponent(fromDefinition)).toBe('core');
    expect(categorizeComponent(unknown)).toBe('input');
  });

  it('returns shared descriptor configuration', () => {
    const config = getCategoryConfig('process');

    expect(config.label).toBe('Process');
    expect(config.icon).toBe('Cog');
    expect(config.color).toContain('text-slate');
  });
});
