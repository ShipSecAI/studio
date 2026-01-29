import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  port,
  analyticsResultSchema,
  generateFindingHash,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  trigger: port(z.any().optional(), {
    label: 'Trigger',
    description: 'Optional trigger input to allow wiring from entrypoint.',
    allowAny: true,
    reason: 'Test fixture accepts any trigger input for E2E testing flexibility.',
  }),
});

const outputSchema = outputs({
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Deterministic analytics results for E2E testing.',
  }),
});

const definition = defineComponent({
  id: 'test.analytics.fixture',
  label: 'Analytics Fixture (Test)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Emits deterministic analytics results for end-to-end tests.',
  ui: {
    slug: 'analytics-fixture',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Test-only component that emits deterministic analytics results.',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute() {
    const results = [
      {
        scanner: 'analytics-fixture',
        severity: 'high',
        title: 'Fixture Finding 1',
        asset_key: 'fixture.local',
        host: 'fixture.local',
        finding_hash: generateFindingHash('fixture', 'finding-1'),
      },
      {
        scanner: 'analytics-fixture',
        severity: 'low',
        title: 'Fixture Finding 2',
        asset_key: 'fixture.local',
        host: 'fixture.local',
        finding_hash: generateFindingHash('fixture', 'finding-2'),
      },
    ];

    return { results };
  },
});

if (!componentRegistry.has(definition.id)) {
  componentRegistry.register(definition);
}

type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as AnalyticsFixtureInput, Output as AnalyticsFixtureOutput };
