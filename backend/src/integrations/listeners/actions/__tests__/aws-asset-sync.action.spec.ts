import { beforeEach, describe, expect, it, spyOn, vi } from 'bun:test';

import { AwsAssetSyncAction } from '../aws-asset-sync.action';
import { IntegrationActionRegistry } from '../../integration-action.registry';
import { IntegrationConnectedEvent } from '../../../events/integration.events';

describe('AwsAssetSyncAction', () => {
  let action: AwsAssetSyncAction;
  let mockIndexInfraService: {
    ensureDefaultScheduleForIntegration: ReturnType<typeof vi.fn>;
    triggerRun: ReturnType<typeof vi.fn>;
  };
  let registry: IntegrationActionRegistry;

  beforeEach(() => {
    mockIndexInfraService = {
      ensureDefaultScheduleForIntegration: vi.fn().mockResolvedValue({ id: 'schedule-1' }),
      triggerRun: vi.fn().mockResolvedValue({
        workflowId: 'workflow-1',
        runId: 'run-1',
      }),
    };
    registry = new IntegrationActionRegistry();
    action = new AwsAssetSyncAction(mockIndexInfraService as any, registry);
  });

  function makeEvent(): IntegrationConnectedEvent {
    return new IntegrationConnectedEvent(
      'conn-123',
      'aws',
      'iam_role',
      'org-1',
      'user-1',
      false,
      'us-east-1',
    );
  }

  it('ensures the default infra schedule and starts the system workflow run', async () => {
    await action.execute(makeEvent());

    expect(mockIndexInfraService.ensureDefaultScheduleForIntegration).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'system',
      },
      'conn-123',
    );
    expect(mockIndexInfraService.triggerRun).toHaveBeenCalledWith({
      auth: {
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'system',
      },
      integrationId: 'conn-123',
      trigger: {
        type: 'api',
        sourceId: 'conn-123',
        label: 'AWS integration connected',
      },
    });
  });

  it('re-throws workflow launch errors', async () => {
    const error = new Error('Connection refused');
    mockIndexInfraService.triggerRun.mockRejectedValue(error);

    await expect(action.execute(makeEvent())).rejects.toThrow('Connection refused');
  });

  it('self-registers on module init', () => {
    const registerSpy = spyOn(registry, 'register');
    action.onModuleInit();
    expect(registerSpy).toHaveBeenCalledWith(action);
  });
});
