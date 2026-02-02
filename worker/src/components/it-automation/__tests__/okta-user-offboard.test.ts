import { describe, it, expect, vi, beforeEach, mock } from 'bun:test';
import '../../index';
import { createMockExecutionContext } from '../../../testing/test-utils';

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

// Import the component definition
import '../okta-user-offboard';
import { componentRegistry } from '@shipsec/component-sdk';
import { OktaUserOffboardInput, OktaUserOffboardOutput } from '../okta-user-offboard';

const definition = componentRegistry.get<OktaUserOffboardInput, OktaUserOffboardOutput>(
  'it-automation.okta.user-offboard',
);

if (!definition) {
  throw new Error('Component definition not found');
}

describe('okta-user-offboard', () => {
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

  const createContext = () => createMockExecutionContext();

  it('successfully deactivates a user in non-dry-run mode', async () => {
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

    const context = createContext();
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
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(true);
    expect(result.userDeactivated).toBe(true);
    expect(result.userDeleted).toBe(false);
    expect(result.message).toContain('Successfully deactivated user');
    expect(mockUserApi.getUser).toHaveBeenCalledWith({ userId: 'test@example.com' });
    expect(mockUserApi.deactivateUser).toHaveBeenCalledWith({ userId: '12345' });
    expect(mockUserApi.deleteUser).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith(
      '[Okta] Successfully deactivated user account: test@example.com',
    );
  });

  it('deactivates and deletes when action=delete', async () => {
    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockResolvedValue({});
    mockUserApi.deleteUser.mockResolvedValue({});

    const context = createContext();
    const executePayload = {
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: 'delete' as const,
        dry_run: false,
      },
    };
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(true);
    expect(result.userDeactivated).toBe(true);
    expect(result.userDeleted).toBe(true);
    expect(mockUserApi.deactivateUser).toHaveBeenCalledWith({ userId: '12345' });
    expect(mockUserApi.deleteUser).toHaveBeenCalledWith({ userId: '12345' });
  });

  it('simulates operations when dry_run is true', async () => {
    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);

    const context = createContext();
    const executePayload = {
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        dry_run: true,
        action: 'delete' as const,
      },
    };
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(true);
    expect(result.userDeactivated).toBe(true);
    expect(result.userDeleted).toBe(true);
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
    expect(mockUserApi.deleteUser).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith(
      '[Okta] Running in DRY RUN mode - no changes will be made',
    );
  });

  it('returns structured failure when user is not found', async () => {
    const error = new Error('User not found');
    (error as any).status = 404;
    mockUserApi.getUser.mockRejectedValue(error);

    const context = createContext();
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
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(false);
    expect(result.userDeactivated).toBe(false);
    expect(result.userDeleted).toBe(false);
    expect(result.error).toContain('User test@example.com not found');
    expect(mockUserApi.deactivateUser).not.toHaveBeenCalled();
  });

  it('returns structured failure when deactivate call fails', async () => {
    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockRejectedValue(new Error('network down'));

    const context = createContext();
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
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(false);
    expect(result.userDeactivated).toBe(false);
    expect(result.error).toContain('Failed to deactivate user');
  });

  it('returns structured failure when delete call fails', async () => {
    const mockUser = {
      id: '12345',
      profile: { email: 'test@example.com', login: 'test@example.com' },
      status: 'ACTIVE',
      created: new Date('2023-01-01'),
      activated: new Date('2023-01-01'),
      lastLogin: new Date('2023-10-01'),
      lastUpdated: new Date('2023-10-01'),
    };

    mockUserApi.getUser.mockResolvedValue(mockUser);
    mockUserApi.deactivateUser.mockResolvedValue({});
    mockUserApi.deleteUser.mockRejectedValue(new Error('timeout'));

    const context = createContext();
    const executePayload = {
      inputs: {
        user_email: baseParams.user_email,
        okta_domain: baseParams.okta_domain,
        apiToken: baseParams.apiToken,
      },
      params: {
        action: 'delete' as const,
        dry_run: false,
      },
    };
    const result = await definition.execute(executePayload, context);

    expect(result.success).toBe(false);
    expect(result.userDeactivated).toBe(false);
    expect(result.userDeleted).toBe(false);
    expect(result.error).toContain('Failed to delete user');
  });

  it('rejects inputs without an API token', () => {
    expect(() =>
      definition.inputs.parse({
        user_email: 'test@example.com',
        okta_domain: 'company.okta.com',
      }),
    ).toThrowError(/expected string/);
  });

  it('throws when provided API token trims to an empty string', async () => {
    const inputValues = {
      user_email: baseParams.user_email,
      okta_domain: baseParams.okta_domain,
      apiToken: '   ',
    };

    const context = createContext();
    const result = await definition.execute({ inputs: inputValues, params: {} }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API token is required to contact Okta');
  });
});
