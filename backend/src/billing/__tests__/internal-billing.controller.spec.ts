import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';

import { InternalBillingController } from '../internal-billing.controller';

describe('InternalBillingController', () => {
  test('requires x-organization-id header', async () => {
    const controller = new InternalBillingController({
      resolveVirtualKey: async () => 'sk-test',
    } as any);

    await expect(controller.getBifrostKey(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  test('resolves a key using the request organization header', async () => {
    let resolvedOrgId: string | null = null;
    const controller = new InternalBillingController({
      resolveVirtualKey: async (orgId: string) => {
        resolvedOrgId = orgId;
        return 'sk-org-key';
      },
    } as any);

    await expect(controller.getBifrostKey(' org-42 ')).resolves.toEqual({
      virtualKey: 'sk-org-key',
    });
    expect(resolvedOrgId as string | null).toBe('org-42');
  });
});
