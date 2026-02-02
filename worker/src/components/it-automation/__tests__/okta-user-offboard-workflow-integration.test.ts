import { describe, it, expect, vi, beforeEach, mock } from 'bun:test';
import { executeWorkflow } from '../../../temporal/workflow-runner';
import type { WorkflowDefinition } from '../../../temporal/types';
import type { TraceEvent } from '@shipsec/component-sdk';

// Mock the Okta SDK at the global level
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

describe('Okta User Offboard - Workflow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserApi.getUser.mockReset();
    mockUserApi.deactivateUser.mockReset();
    mockUserApi.deleteUser.mockReset();
  });

  const createTestWorkflow = (config: any): WorkflowDefinition => {
    const { user_email, okta_domain, apiToken, ...params } = config;
    return {
      version: 1,
      title: 'Okta Offboard Test',
      description: 'Test Okta user offboarding through workflow runner',
      entrypoint: { ref: 'okta-offboard' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        'okta-offboard': { ref: 'okta-offboard' },
      },
      edges: [],
      dependencyCounts: {
        'okta-offboard': 0,
      },
      actions: [
        {
          ref: 'okta-offboard',
          componentId: 'it-automation.okta.user-offboard',
          params,
          inputOverrides: { user_email, okta_domain, apiToken },
          dependsOn: [],
          inputMappings: {},
        },
      ],
    };
  };

  it('successfully deactivates a user via the workflow runner', async () => {
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

    const traceEvents: TraceEvent[] = [];
    const trace = {
      record: (event: TraceEvent) => traceEvents.push(event),
    };

    const workflow = createTestWorkflow({
      user_email: 'test@example.com',
      okta_domain: 'company.okta.com',
      apiToken: 'okta-api-token',
      action: 'deactivate',
      dry_run: false,
    });

    const result = await executeWorkflow(workflow, {}, { runId: 'workflow-success', trace });

    expect(result.success).toBe(true);
    const output = result.outputs['okta-offboard'] as any;
    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.userDeleted).toBe(false);
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deleteUser).not.toHaveBeenCalled();
  });

  it('returns structured failure without retries when user not found', async () => {
    const error = new Error('User not found');
    (error as any).status = 404;
    mockUserApi.getUser.mockRejectedValue(error);

    const workflow = createTestWorkflow({
      user_email: 'missing@example.com',
      okta_domain: 'company.okta.com',
      apiToken: 'okta-api-token',
      action: 'deactivate',
      dry_run: false,
    });

    const startTime = Date.now();
    const result = await executeWorkflow(workflow, {}, { runId: 'workflow-notfound' });
    const executionTime = Date.now() - startTime;

    expect(result.success).toBe(false);
    const output = result.outputs['okta-offboard'] as any;
    expect(output.success).toBe(false);
    expect(output.error).toContain('User missing@example.com not found');
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    expect(executionTime).toBeLessThan(5000);
  });

  it('supports dry run mode through the workflow runner', async () => {
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

    const workflow = createTestWorkflow({
      user_email: 'test@example.com',
      okta_domain: 'company.okta.com',
      apiToken: 'okta-api-token',
      action: 'deactivate',
      dry_run: true,
    });

    const result = await executeWorkflow(workflow, {}, { runId: 'workflow-dry' });

    expect(result.success).toBe(true);
    const output = result.outputs['okta-offboard'] as any;
    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.message).toContain('DRY RUN');
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
  });

  it('supports delete action end-to-end', async () => {
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

    const workflow = createTestWorkflow({
      user_email: 'test@example.com',
      okta_domain: 'company.okta.com',
      apiToken: 'okta-api-token',
      action: 'delete',
      dry_run: false,
    });

    const result = await executeWorkflow(workflow, {}, { runId: 'workflow-delete' });

    expect(result.success).toBe(true);
    const output = result.outputs['okta-offboard'] as any;
    expect(output.success).toBe(true);
    expect(output.userDeactivated).toBe(true);
    expect(output.userDeleted).toBe(true);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deleteUser).toHaveBeenCalledTimes(1);
  });
});
