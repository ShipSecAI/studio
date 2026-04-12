import { describe, expect, it, beforeEach, vi } from 'bun:test';
import { spyOn } from 'bun:test';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { AwsAssetSyncAction } from '../aws-asset-sync.action';
import { IntegrationActionRegistry } from '../../integration-action.registry';
import { IntegrationConnectedEvent } from '../../../events/integration.events';

describe('AwsAssetSyncAction', () => {
  let action: AwsAssetSyncAction;
  let mockTemporalService: { startWorkflow: ReturnType<typeof vi.fn> };
  let registry: IntegrationActionRegistry;

  beforeEach(() => {
    mockTemporalService = {
      startWorkflow: vi.fn().mockResolvedValue({
        workflowId: 'asset-sync-org-org-1',
        runId: 'run-1',
        taskQueue: 'default',
      }),
    };
    registry = new IntegrationActionRegistry();
    action = new AwsAssetSyncAction(mockTemporalService as any, registry);
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

  it('calls temporalService.startWorkflow with correct args', async () => {
    await action.execute(makeEvent());

    expect(mockTemporalService.startWorkflow).toHaveBeenCalledWith({
      workflowType: 'assetSyncWorkflow',
      workflowId: 'asset-sync-org-org-1',
      args: [
        {
          integrationId: 'conn-123',
          organizationId: 'org-1',
        },
      ],
    });
  });

  it('treats WorkflowExecutionAlreadyStartedError as idempotent no-op', async () => {
    mockTemporalService.startWorkflow.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'Workflow execution already started',
        'asset-sync-org-org-1',
        'assetSyncWorkflow',
      ),
    );

    await expect(action.execute(makeEvent())).resolves.toBeUndefined();
  });

  it('re-throws other Temporal errors', async () => {
    const error = new Error('Connection refused');
    mockTemporalService.startWorkflow.mockRejectedValue(error);

    await expect(action.execute(makeEvent())).rejects.toThrow('Connection refused');
  });

  it('self-registers on module init', () => {
    const registerSpy = spyOn(registry, 'register');
    action.onModuleInit();
    expect(registerSpy).toHaveBeenCalledWith(action);
  });
});
