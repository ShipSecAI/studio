import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';
import type { AnalyticsFixtureInput, AnalyticsFixtureOutput } from '../analytics-fixture';

describe('test.analytics.fixture component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get<AnalyticsFixtureInput, AnalyticsFixtureOutput>(
      'test.analytics.fixture',
    );
    expect(component).toBeDefined();
    expect(component!.label).toBe('Analytics Fixture (Test)');
  });

  it('should emit deterministic analytics results', async () => {
    const component = componentRegistry.get<AnalyticsFixtureInput, AnalyticsFixtureOutput>(
      'test.analytics.fixture',
    );
    if (!component) {
      throw new Error('test.analytics.fixture not registered');
    }

    const context = createExecutionContext({
      runId: 'analytics-fixture-test',
      componentRef: 'fixture-node',
    });

    const result = await component.execute({ inputs: {}, params: {} }, context);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.results[0].scanner).toBe('analytics-fixture');
  });
});
