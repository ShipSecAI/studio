import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';

import { createMockExecutionContext, createMockSecretsService } from '../../../testing/test-utils';

describe('secret fetch component', () => {
  beforeAll(async () => {
    await import('../secret-fetch');
  });

  it('prefers the wired secretId input over the static parameter', async () => {
    const component: any = componentRegistry.get('core.secret.fetch');
    if (!component) {
      throw new Error('core.secret.fetch not registered');
    }

    const context = createMockExecutionContext({
      secrets: createMockSecretsService({
        wiredSecret: 'super-secret-kubeconfig',
        fallbackSecret: 'should-not-be-used',
      }),
    });

    const result = await component.execute(
      {
        inputs: { secretId: 'wiredSecret' },
        params: { secretId: 'fallbackSecret', outputFormat: 'raw' },
      },
      context,
    );

    expect(result.secret).toBe('super-secret-kubeconfig');
    expect(result.metadata.secretId).toBe('wiredSecret');
  });
});
