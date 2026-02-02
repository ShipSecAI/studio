import { describe, it, expect, vi, beforeEach, mock } from 'bun:test';
import '../../index';
import { ExecutionContext } from '@shipsec/component-sdk';
import { createMockExecutionContext } from '../../../testing/test-utils';

// Mock the dependencies
const mockAdminClient = {
  users: {
    get: vi.fn(),
    delete: vi.fn(),
  },
};

mock.module('@googleapis/admin', () => ({
  admin: vi.fn(() => mockAdminClient),
}));

mock.module('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(() => ({})),
    },
  },
}));

// Import the component definition
import '../google-workspace-license-unassign';
import { componentRegistry } from '@shipsec/component-sdk';
import { GoogleWorkspaceUserDeleteOutput } from '../google-workspace-license-unassign';

const definition = componentRegistry.get('it-automation.google-workspace.user-delete');

if (!definition) {
  throw new Error('Component definition not found');
}

const execute = definition.execute as unknown as (
  params: any,
  context: ExecutionContext,
) => Promise<GoogleWorkspaceUserDeleteOutput>;

describe('google-workspace-user-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully delete a user in a non-dry run', async () => {
    // 1. Set up mocks
    const mockUser = {
      data: {
        id: '12345',
        primaryEmail: 'test@example.com',
        orgUnitPath: '/',
        suspended: false,
        admin: false,
        lastLoginTime: new Date().toISOString(),
        customerId: 'C012345',
      },
    };
    mockAdminClient.users.get.mockResolvedValue(mockUser);
    mockAdminClient.users.delete.mockResolvedValue({});

    // 2. Define input parameters
    const inputValues = {
      primary_email: 'test@example.com',
      service_account_secret: JSON.stringify({ private_key: 'test-key' }),
    };
    const paramValues = {
      dry_run: false,
    };

    // 3. Create mock context
    const context = createMockExecutionContext();

    // 4. Execute the component
    const result: GoogleWorkspaceUserDeleteOutput = await execute(
      { inputs: inputValues, params: paramValues },
      context,
    );

    // 5. Assert the results
    expect(result.success).toBe(true);
    expect(result.userDeleted).toBe(true);
    expect(result.message).toContain('Successfully deleted user');
    expect(mockAdminClient.users.get).toHaveBeenCalledWith({ userKey: 'test@example.com' });
    expect(mockAdminClient.users.delete).toHaveBeenCalledWith({ userKey: 'test@example.com' });
    expect(context.logger.info).toHaveBeenCalledWith(
      '[GoogleWorkspace] Successfully deleted user account: test@example.com',
    );
  });

  it('should simulate deletion in dry run mode', async () => {
    // 1. Set up mocks
    const mockUser = { data: { id: '12345', primaryEmail: 'test@example.com' } };
    mockAdminClient.users.get.mockResolvedValue(mockUser);

    // 2. Define input parameters
    const inputValues = {
      primary_email: 'test@example.com',
      service_account_secret: JSON.stringify({ private_key: 'test-key' }),
    };
    const paramValues = {
      dry_run: true,
    };

    // 3. Create mock context
    const context = createMockExecutionContext();

    // 4. Execute the component
    const result: GoogleWorkspaceUserDeleteOutput = await execute(
      { inputs: inputValues, params: paramValues },
      context,
    );

    // 5. Assert the results
    expect(result.success).toBe(true);
    expect(result.userDeleted).toBe(true);
    expect(result.message).toContain('DRY RUN: Would delete user');
    expect(mockAdminClient.users.delete).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith(
      '[GoogleWorkspace] Running in DRY RUN mode - no changes will be made',
    );
  });

  it('should fail gracefully if user is not found', async () => {
    // 1. Set up mocks
    mockAdminClient.users.get.mockRejectedValue({ code: 404 });

    // 2. Define input parameters
    const inputValues = {
      primary_email: 'notfound@example.com',
      service_account_secret: JSON.stringify({ private_key: 'test-key' }),
    };

    // 3. Create mock context
    const context = createMockExecutionContext();

    // 4. Execute the component
    const result: GoogleWorkspaceUserDeleteOutput = await execute(
      { inputs: inputValues, params: {} },
      context,
    );

    // 5. Assert the results
    expect(result.success).toBe(false);
    expect(result.userDeleted).toBe(false);
    expect(result.error).toContain('User notfound@example.com not found');
    expect(mockAdminClient.users.delete).not.toHaveBeenCalled();
  });

  it('should fail if secret is not found', async () => {
    // 1. Set up mocks
    // 2. Define input parameters
    const inputValues = {
      primary_email: 'test@example.com',
      service_account_secret: '',
    };

    // 3. Create mock context
    const context = createMockExecutionContext();

    // 4. Execute the component
    const result: GoogleWorkspaceUserDeleteOutput = await execute(
      { inputs: inputValues, params: {} },
      context,
    );

    // 5. Assert the results
    expect(result.success).toBe(false);
    expect(result.userDeleted).toBe(false);
    expect(result.error).toContain('Service account secret is required');
    expect(mockAdminClient.users.get).not.toHaveBeenCalled();
    expect(mockAdminClient.users.delete).not.toHaveBeenCalled();
  });
});
