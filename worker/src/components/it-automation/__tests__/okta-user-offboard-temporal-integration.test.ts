import { describe, it, expect, vi, beforeEach, afterEach, mock } from 'bun:test';
import { Context } from '@temporalio/activity';
import { runComponentActivity } from '../../../temporal/activities/run-component.activity';
import { createMockTrace, createMockLogCollector } from '../../../testing/test-utils';

// Mock the Okta SDK
const mockUserApi = {
  getUser: vi.fn(),
  deactivateUser: vi.fn(),
  deleteUser: vi.fn(),
};

const mockClient = {
  userApi: mockUserApi,
};

mock.module('@okta/okta-sdk-nodejs', () => ({
  Client: vi.fn(() => mockClient),
  User: {},
  UserSchema: {},
}));

// Ensure all components are registered
import '../../index';

describe('Okta User Offboard - Temporal Activity Integration', () => {
  const contextSpy = vi.spyOn(Context, 'current');

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserApi.getUser.mockReset();
    mockUserApi.deactivateUser.mockReset();
    mockUserApi.deleteUser.mockReset();

    contextSpy.mockReturnValue({
      info: {
        activityId: 'activity-1',
        attempt: 1,
      },
    } as any);
  });

  afterEach(() => {
    contextSpy.mockReset();
  });

  const baseParams = {
    user_email: 'test@example.com',
    okta_domain: 'company.okta.com',
    apiToken: 'okta-api-token',
    action: 'deactivate' as const,
    dry_run: false,
  };

  async function initServices() {
    const { initializeComponentActivityServices } =
      await import('../../../temporal/activities/run-component.activity');
    initializeComponentActivityServices({
      storage: undefined as any,
      secrets: undefined,
      trace: createMockTrace(),
      logs: createMockLogCollector(),
    });
  }

  it('successfully deactivates a user through the activity', async () => {
    await initServices();

    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date(),
      activated: new Date(),
      lastLogin: new Date(),
      lastUpdated: new Date(),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockResolvedValue({});

    const result = await runComponentActivity({
      runId: 'run-success',
      workflowId: 'workflow-success',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: baseParams.action,
        dry_run: baseParams.dry_run,
      },
      metadata: {
        streamId: 'test-stream',
      },
    });

    const output = result.output as any;

    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.userDeleted).toBe(false);
    expect(output.message).toContain('Successfully deactivated user');
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deleteUser).not.toHaveBeenCalled();
  });

  it('fails gracefully (no retries) when user not found', async () => {
    await initServices();

    const error = new Error('User not found');
    (error as any).status = 404;
    mockUserApi.getUser.mockRejectedValue(error);

    const startTime = Date.now();
    const result = await runComponentActivity({
      runId: 'run-notfound',
      workflowId: 'workflow-fail',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: 'missing@example.com',
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: baseParams.action,
        dry_run: baseParams.dry_run,
      },
      metadata: {
        streamId: 'test-stream',
      },
    });
    const executionTime = Date.now() - startTime;

    const output = result.output as any;

    expect(output.success).toBe(false);
    expect(output.error).toContain('User missing@example.com not found');
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    expect(executionTime).toBeLessThan(2000);
  });

  it('fails gracefully when the API token is invalid', async () => {
    await initServices();

    const error = new Error('Invalid token');
    (error as any).status = 401;
    mockUserApi.getUser.mockRejectedValue(error);

    const result = await runComponentActivity({
      runId: 'run-invalid-token',
      workflowId: 'workflow-fail',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: baseParams.action,
        dry_run: baseParams.dry_run,
      },
      metadata: {
        streamId: 'test-stream',
      },
    });

    const output = result.output as any;

    expect(output.success).toBe(false);
    expect(output.error).toContain('Failed to get user details');
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
  });

  it('supports dry run mode', async () => {
    await initServices();

    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date(),
      activated: new Date(),
      lastLogin: new Date(),
      lastUpdated: new Date(),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);

    const result = await runComponentActivity({
      runId: 'run-dry',
      workflowId: 'workflow-dry',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        ...baseParams,
        dry_run: true,
      },
      metadata: {
        streamId: 'test-stream',
      },
    });

    const output = result.output as any;

    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.userDeleted).toBe(false);
    expect(output.message).toContain('DRY RUN');
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
  });

  it('supports delete action end-to-end', async () => {
    await initServices();

    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date(),
      activated: new Date(),
      lastLogin: new Date(),
      lastUpdated: new Date(),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockResolvedValue({});
    mockUserApi.deleteUser.mockResolvedValue({});

    const result = await runComponentActivity({
      runId: 'run-delete',
      workflowId: 'workflow-delete',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        ...baseParams,
        action: 'delete',
      },
      metadata: {
        streamId: 'test-stream',
      },
    });

    const output = result.output as any;

    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.userDeleted).toBe(true);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when user is already deactivated', async () => {
    await initServices();

    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'DEPROVISIONED',
      created: new Date(),
      activated: new Date(),
      lastLogin: new Date(),
      lastUpdated: new Date(),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);

    const result = await runComponentActivity({
      runId: 'run-already',
      workflowId: 'workflow-already',
      action: {
        ref: 'okta-offboard',
        componentId: 'it-automation.okta.user-offboard',
      },
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: baseParams,
      metadata: {
        streamId: 'test-stream',
      },
    });

    const output = result.output as any;

    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(false);
    expect(output.userDeleted).toBe(false);
    expect(output.message).toContain('already deactivated');
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
  });
});
