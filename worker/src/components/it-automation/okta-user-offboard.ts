import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  ConfigurationError,
  NotFoundError,
  ServiceError,
} from '@shipsec/component-sdk';
import * as Okta from '@okta/okta-sdk-nodejs';

const inputSchema = z.object({
  user_email: z.string().email(),
  dry_run: z.boolean().default(false),
  action: z.enum(['deactivate', 'delete']).default('deactivate'),
  okta_domain: z.string(),
  apiToken: z
    .string()
    .min(1, 'API token is required')
    .describe('Resolved Okta API token'),
});

type Input = z.infer<typeof inputSchema>;

interface UserState {
  id: string;
  email: string;
  login: string;
  status: string;
  created: string;
  activated: string;
  lastLogin?: string;
  updated: string;
}

interface AuditLog {
  timestamp: string;
  action: string;
  userEmail: string;
  before?: UserState;
  dryRun: boolean;
  changes: {
    userDeactivated: boolean;
    userDeleted: boolean;
  };
}

export type OktaUserOffboardOutput = {
  success: boolean;
  audit: AuditLog;
  error?: string;
  userDeactivated: boolean;
  userDeleted: boolean;
  message: string;
};

const outputSchema = z.object({
  success: z.boolean(),
  audit: z.object({
    timestamp: z.string(),
    action: z.string(),
    userEmail: z.string(),
    before: z.object({
      id: z.string(),
      email: z.string(),
      login: z.string(),
      status: z.string(),
      created: z.string(),
      activated: z.string(),
      lastLogin: z.string().optional(),
      updated: z.string(),
    }).optional(),
    dryRun: z.boolean(),
    changes: z.object({
      userDeactivated: z.boolean(),
      userDeleted: z.boolean(),
    }),
  }),
  error: z.string().optional(),
  userDeactivated: z.boolean(),
  userDeleted: z.boolean(),
  message: z.string(),
});

/**
 * Initialize Okta client
 */
function initializeOktaClient(oktaDomain: string, apiToken: string): Okta.Client {
  const client = new Okta.Client({
    orgUrl: `https://${oktaDomain}`,
    token: apiToken,
  });

  return client;
}

/**
 * Get user details from Okta using SDK
 */
async function getUserDetails(
  userEmail: string,
  client: Okta.Client
): Promise<UserState> {
  try {
    const user: Okta.User = await client.userApi.getUser({ userId: userEmail });

    return {
      id: user.id || '',
      email: user.profile?.email || '',
      login: user.profile?.login || '',
      status: user.status || '',
      created: user.created?.toISOString() || '',
      activated: user.activated?.toISOString() || '',
      lastLogin: user.lastLogin?.toISOString(),
      updated: user.lastUpdated?.toISOString() || '',
    };
  } catch (error: any) {
    if (error.status === 404) {
      throw new NotFoundError(`User ${userEmail} not found`, {
        resourceType: 'user',
        resourceId: userEmail,
      });
    }
    throw new ServiceError(`Failed to get user details: ${error.message}`, {
      cause: error,
      details: { userEmail, operation: 'getUserDetails' },
    });
  }
}

/**
 * Deactivate a user account using SDK
 */
async function deactivateUser(
  userId: string,
  client: Okta.Client
): Promise<void> {
  try {
    await client.userApi.deactivateUser({ userId });
  } catch (error: any) {
    if (error.status === 404) {
      throw new NotFoundError(`User ${userId} not found`, {
        resourceType: 'user',
        resourceId: userId,
      });
    }
    throw new ServiceError(`Failed to deactivate user: ${error.message}`, {
      cause: error,
      details: { userId, operation: 'deactivateUser' },
    });
  }
}

/**
 * Delete a user account using SDK
 */
async function deleteUser(
  userId: string,
  client: Okta.Client
): Promise<void> {
  try {
    await client.userApi.deleteUser({ userId });
  } catch (error: any) {
    if (error.status === 404) {
      // User already deleted
      return;
    }
    throw new ServiceError(`Failed to delete user: ${error.message}`, {
      cause: error,
      details: { userId, operation: 'deleteUser' },
    });
  }
}

const definition: ComponentDefinition<Input, OktaUserOffboardOutput> = {
  id: 'it-automation.okta.user-offboard',
  label: 'Okta User Offboard',
  category: 'it_ops',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ConfigurationError', 'NotFoundError', 'ValidationError'],
  } satisfies ComponentRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Offboard a user from Okta by deactivating or deleting their account to revoke access and complete the offboarding process.',
  metadata: {
    slug: 'okta-user-offboard',
    version: '1.0.0',
    type: 'output',
    category: 'it_ops',
    description: 'Offboard users from Okta by deactivating or deleting their accounts to revoke all access.',
    icon: 'Shield',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'user_email',
        label: 'User Email',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'Email address of the user to offboard.',
      },
      {
        id: 'okta_domain',
        label: 'Okta Domain',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'Your Okta organization domain.',
      },
      {
        id: 'apiToken',
        label: 'API Token',
        dataType: port.secret(),
        required: true,
        description: 'Connect the Secret Loader output containing the Okta API token.',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'User Offboard Result',
        dataType: port.json(),
        description: 'Results of the user offboarding operation including audit logs.',
      },
    ],
    examples: [
      'Offboard employees by deactivating their Okta accounts.',
      'Automatically revoke all Okta access when users leave the company.',
      'Complete IT offboarding workflows with comprehensive audit trails.',
    ],
    parameters: [
      {
        id: 'action',
        label: 'Action',
        type: 'select',
        required: true,
        default: 'deactivate',
        options: [
          { label: 'Deactivate Only', value: 'deactivate' },
          { label: 'Delete Permanently', value: 'delete' },
        ],
        description: 'Choose to deactivate (recommended) or delete the user account.',
        helpText: 'Business logic choice - use sidebar for operational decisions.',
      },
      {
        id: 'dry_run',
        label: 'Dry Run Mode',
        type: 'boolean',
        default: false,
        description: 'Preview what would happen without making actual changes.',
        helpText: 'Safety setting - enable to test operations without affecting users.',
      },
    ],
  },
  async execute(params, context) {
    const {
      user_email,
      okta_domain,
      action = 'deactivate',
      dry_run = false,
      apiToken,
    } = params;

    context.logger.info(`[Okta] Starting user offboarding for ${user_email}`);
    context.emitProgress(`Initializing user offboarding process`);

    if (dry_run) {
      context.logger.info('[Okta] Running in DRY RUN mode - no changes will be made');
      context.emitProgress('DRY RUN: No actual changes will be made');
    }

    let beforeState: UserState | undefined;
    let userDeactivated = false;
    let userDeleted = false;

    try {
      // Resolve API token
      const resolvedApiToken = apiToken.trim();
      if (!resolvedApiToken) {
        throw new ConfigurationError('API token is required to contact Okta.', {
          configKey: 'apiToken',
        });
      }

      // Initialize Okta client
      context.emitProgress('Initializing Okta SDK');
      const oktaClient = initializeOktaClient(okta_domain, resolvedApiToken);

      // Get current user state
      context.emitProgress('Fetching user details');
      const userDetails = await getUserDetails(user_email, oktaClient);
      beforeState = userDetails;

      context.logger.info(`[Okta] Found user: ${userDetails.email} (ID: ${userDetails.id}, Status: ${userDetails.status})`);

      // Check if user is already deactivated
      if (userDetails.status === 'DEPROVISIONED') {
        const message = `User ${user_email} is already deactivated`;
        context.logger.info(`[Okta] ${message}`);

        return {
          success: true,
          audit: {
            timestamp: new Date().toISOString(),
            action: action,
            userEmail: user_email,
            before: beforeState,
            dryRun: dry_run,
            changes: {
              userDeactivated: false,
              userDeleted: false,
            },
          },
          userDeactivated: false,
          userDeleted: false,
          message,
        };
      }

      // Perform action (if not dry run)
      if (!dry_run) {
        if (action === 'deactivate' || action === 'delete') {
          context.emitProgress('Deactivating user account');
          await deactivateUser(userDetails.id, oktaClient);
          userDeactivated = true;
          context.logger.info(`[Okta] Successfully deactivated user account: ${user_email}`);
        }

        if (action === 'delete') {
          context.emitProgress('Deleting user account');
          await deleteUser(userDetails.id, oktaClient);
          userDeleted = true;
          context.logger.info(`[Okta] Successfully deleted user account: ${user_email}`);
        }
      } else {
        // Dry run simulation
        if (action === 'deactivate' || action === 'delete') {
          context.emitProgress('DRY RUN: Would deactivate user account');
          userDeactivated = true;
        }
        if (action === 'delete') {
          context.emitProgress('DRY RUN: Would delete user account');
          userDeleted = true;
        }
      }

      const auditLog: AuditLog = {
        timestamp: new Date().toISOString(),
        action: action,
        userEmail: user_email,
        before: beforeState,
        dryRun: dry_run,
        changes: {
          userDeactivated,
          userDeleted,
        },
      };

      let message: string;
      if (dry_run) {
        if (action === 'delete') {
          message = `DRY RUN: Would deactivate and delete user ${user_email} from Okta`;
        } else {
          message = `DRY RUN: Would deactivate user ${user_email} from Okta`;
        }
      } else {
        if (action === 'delete') {
          message = `Successfully deactivated and deleted user ${user_email} from Okta`;
        } else {
          message = `Successfully deactivated user ${user_email} from Okta`;
        }
      }

      context.logger.info(`[Okta] ${message}`);
      context.emitProgress(`User offboarding completed successfully`);

      return {
        success: true,
        audit: auditLog,
        userDeactivated,
        userDeleted,
        message,
      };

    } catch (error: any) {
      context.logger.error(`[Okta] User offboarding failed: ${error.message}`);
      context.emitProgress('User offboarding failed');

      return {
        success: false,
        audit: {
          timestamp: new Date().toISOString(),
          action: action,
          userEmail: user_email,
          before: beforeState,
          dryRun: dry_run,
          changes: {
            userDeactivated: false,
            userDeleted: false,
          },
        },
        error: error.message,
        userDeactivated: false,
        userDeleted: false,
        message: `Failed to offboard user: ${error.message}`,
      };
    }
  },
};

componentRegistry.register(definition);
