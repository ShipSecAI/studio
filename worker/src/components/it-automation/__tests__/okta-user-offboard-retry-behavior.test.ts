import { describe, it, expect, vi, beforeEach, mock } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import { createMockExecutionContext } from '../../../testing/test-utils';
import { OktaUserOffboardInput, OktaUserOffboardOutput } from '../okta-user-offboard';

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

// Import the component after mocking
import '../okta-user-offboard';

describe('Okta User Offboard - Retry Behavior Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserApi.getUser.mockReset();
    mockUserApi.deactivateUser.mockReset();
    mockUserApi.deleteUser.mockReset();
  });

  const baseParams = {
    user_email: 'test@example.com',
    okta_domain: 'company.okta.com',
    apiToken: 'okta-api-token',
    action: 'deactivate' as const,
    dry_run: false,
  };

  it('returns structured (non-throwing) failures for common error cases', async () => {
    const definition = componentRegistry.get('it-automation.okta.user-offboard');
    if (!definition) throw new Error('Component definition not found');
    const execute = definition.execute;

    // Scenario 1: user not found
    {
      const error = new Error('User not found');
      (error as any).status = 404;
      mockUserApi.getUser.mockRejectedValueOnce(error);

      const executePayload = {
        inputs: {
          user_email: baseParams.user_email,
          okta_domain: baseParams.okta_domain,
          apiToken: baseParams.apiToken,
        },
        params: {
          action: baseParams.action,
          dry_run: baseParams.dry_run,
        },
      };
      const result = await execute(executePayload, createMockExecutionContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('User test@example.com not found');
      expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
      expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    }

    // Scenario 2: invalid token (401)
    {
      const error = new Error('Invalid token');
      (error as any).status = 401;
      mockUserApi.getUser.mockRejectedValueOnce(error);

      const executePayload = {
        inputs: {
          user_email: baseParams.user_email,
          okta_domain: baseParams.okta_domain,
          apiToken: baseParams.apiToken,
        },
        params: {
          action: baseParams.action,
          dry_run: baseParams.dry_run,
        },
      };
      const result = await execute(executePayload, createMockExecutionContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get user details');
      expect(mockUserApi.getUser).toHaveBeenCalledTimes(2);
      expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    }

    // Scenario 3: deactivate call fails mid-run
    {
      const mockUser = {
        id: 'u-123',
        profile: { email: 'test@example.com', login: 'test@example.com' },
        status: 'ACTIVE',
        created: new Date(),
        activated: new Date(),
        lastLogin: new Date(),
        lastUpdated: new Date(),
      };
      mockUserApi.getUser.mockResolvedValueOnce(mockUser);
      mockUserApi.deactivateUser.mockRejectedValueOnce(new Error('network down'));

      const executePayload = {
        inputs: {
          user_email: baseParams.user_email,
          okta_domain: baseParams.okta_domain,
          apiToken: baseParams.apiToken,
        },
        params: {
          action: baseParams.action,
          dry_run: baseParams.dry_run,
        },
      };
      const result = await execute(executePayload, createMockExecutionContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to deactivate user');
      expect(mockUserApi.getUser).toHaveBeenCalledTimes(3);
      expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
    }
  });

  it('executes successfully when everything is valid', async () => {
    const definition = componentRegistry.get('it-automation.okta.user-offboard');
    if (!definition) throw new Error('Component definition not found');
    const execute = definition.execute;

    const mockUser = {
      id: '12345',
      profile: {
        email: 'test@example.com',
        login: 'test@example.com',
      },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockResolvedValue({});

    const executePayload = {
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: baseParams.action,
        dry_run: baseParams.dry_run,
      },
    };
    const result = await execute(executePayload, createMockExecutionContext());

    expect(result.success).toBe(true);
    expect(result.userDeactivated).toBe(true);
    expect(result.userDeleted).toBe(false);
    expect(result.message).toContain('Successfully deactivated user');
    expect(mockUserApi.getUser).toHaveBeenCalledTimes(1);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledTimes(1);
  });

  it('handles dry run mode without mutating accounts', async () => {
    const definition = componentRegistry.get<OktaUserOffboardInput, OktaUserOffboardOutput>(
      'it-automation.okta.user-offboard',
    );
    if (!definition) throw new Error('Component definition not found');
    const execute = definition.execute;

    const mockUser = {
      id: '12345',
      profile: {
        email: 'test@example.com',
        login: 'test@example.com',
      },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);

    const executePayload = {
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        dry_run: true,
        action: baseParams.action,
      },
    };

    const result = await execute(executePayload, createMockExecutionContext());

    expect(result.success).toBe(true);
    expect(result.userDeactivated).toBe(true);
    expect(result.userDeleted).toBe(false);
    expect(result.message).toContain('DRY RUN: Would deactivate user');
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    expect(mockUserApi.deleteUser).not.toHaveBeenCalled();
  });
});
