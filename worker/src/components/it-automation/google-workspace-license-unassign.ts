import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';
import { admin } from '@googleapis/admin';
import { google } from 'googleapis';

const inputSchema = z.object({
  primary_email: z.string().email(),
  dry_run: z.boolean().default(false),
  service_account_secret_id: z.string().optional().describe('Secret ID for Google Workspace service account JSON key'),
});

type Input = z.infer<typeof inputSchema>;

interface UserState {
  email: string;
  orgUnitPath: string;
  suspended: boolean;
  admin: boolean;
  lastLoginTime?: string;
  customerId: string;
  id: string;
}

interface AuditLog {
  timestamp: string;
  action: string;
  userEmail: string;
  before?: UserState;
  dryRun: boolean;
  changes: {
    userDeleted: boolean;
  };
}

export type GoogleWorkspaceUserDeleteOutput = {
  success: boolean;
  audit: AuditLog;
  error?: string;
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
      email: z.string(),
      orgUnitPath: z.string(),
      suspended: z.boolean(),
      admin: z.boolean(),
      lastLoginTime: z.string().optional(),
      customerId: z.string(),
      id: z.string(),
    }).optional(),
    dryRun: z.boolean(),
    changes: z.object({
      userDeleted: z.boolean(),
    }),
  }),
  error: z.string().optional(),
  userDeleted: z.boolean(),
  message: z.string(),
});

/**
 * Initialize Google Admin SDK client with service account authentication
 */
async function initializeGoogleClient(serviceAccountKey: string) {
  const credentials = JSON.parse(serviceAccountKey);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user'
    ],
  });

  const adminClient = admin({
    version: 'directory_v1',
    auth,
  });

  return adminClient;
}

/**
 * Get user details from Google Admin SDK
 */
async function getUserDetails(
  userEmail: string,
  adminClient: any,
): Promise<UserState> {
  try {
    const response = await adminClient.users.get({
      userKey: userEmail,
    });
    const userData = response.data;

    return {
      email: userData.primaryEmail,
      orgUnitPath: userData.orgUnitPath || '/',
      suspended: userData.suspended || false,
      admin: userData.admin || false,
      lastLoginTime: userData.lastLoginTime,
      customerId: userData.customerId,
      id: userData.id,
    };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`User ${userEmail} not found`);
    }
    throw new Error(`Failed to get user details: ${error.message}`);
  }
}

/**
 * Delete a user account
 */
async function deleteUser(
  userEmail: string,
  adminClient: any,
): Promise<void> {
  try {
    await adminClient.users.delete({
      userKey: userEmail,
    });
  } catch (error: any) {
    if (error.code === 404) {
      // User already deleted
      return;
    }
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}

const definition: ComponentDefinition<Input, GoogleWorkspaceUserDeleteOutput> = {
  id: 'it-automation.google-workspace.user-delete',
  label: 'Google Workspace User Delete',
  category: 'output',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Delete a Google Workspace user account to free up all associated licenses and complete the offboarding process.',
  metadata: {
    slug: 'google-workspace-user-delete',
    version: '2.0.0',
    type: 'output',
    category: 'building-block',
    description: 'Delete Google Workspace user accounts to automatically release all licenses and complete offboarding.',
    icon: 'Building',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [
      {
        id: 'result',
        label: 'User Deletion Result',
        type: 'object',
        description: 'Results of the user deletion operation including audit logs.',
      },
    ],
    examples: [
      'Offboard employees by deleting their Google Workspace accounts.',
      'Automatically release all licenses when users leave the company.',
      'Complete IT offboarding workflows with comprehensive audit trails.',
    ],
    parameters: [
      {
        id: 'primary_email',
        label: 'User Email',
        type: 'text',
        required: true,
        placeholder: 'user@company.com',
        description: 'Primary email address of the user to delete.',
      },
      {
        id: 'dry_run',
        label: 'Dry Run Mode',
        type: 'boolean',
        default: false,
        description: 'Preview what would happen without making actual changes.',
      },
      {
        id: 'service_account_secret_id',
        label: 'Service Account Secret',
        type: 'secret',
        required: false,
        description: 'Secret ID containing the Google Workspace service account JSON key.',
        helpText: 'Create a secret in ShipSec containing the service account JSON with domain-wide delegation enabled.',
      },
    ],
  },
  async execute(params, context) {
    const {
      primary_email,
      dry_run = false,
      service_account_secret_id,
    } = params;

    context.logger.info(`[GoogleWorkspace] Starting user deletion for ${primary_email}`);
    context.emitProgress(`Initializing user deletion process`);

    if (dry_run) {
      context.logger.info('[GoogleWorkspace] Running in DRY RUN mode - no changes will be made');
      context.emitProgress('DRY RUN: No actual changes will be made');
    }

    let beforeState: UserState | undefined;
    let userDeleted = false;

    try {
      // Validate secrets service
      if (!context.secrets) {
        throw new Error('Google Workspace User Delete component requires the secrets service. Ensure the worker injects ISecretsService.');
      }

      // Validate secret ID input
      if (!service_account_secret_id) {
        throw new Error('Service account secret ID is required. Please provide a secret ID containing the Google Workspace service account JSON key.');
      }

      // Get and validate secret
      const resolvedSecret = await context.secrets.get(service_account_secret_id);
      if (!resolvedSecret) {
        throw new Error(`Secret ${service_account_secret_id} not found or has no active version.`);
      }

      // Parse service account key
      let serviceKey: string;
      try {
        serviceKey = typeof resolvedSecret.value === 'string'
          ? resolvedSecret.value
          : JSON.stringify(resolvedSecret.value);
      } catch (error) {
        throw new Error(`Failed to parse service account secret: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Initialize Google client
      context.emitProgress('Initializing Google Admin SDK');
      const adminClient = await initializeGoogleClient(serviceKey);

      // Get current user state
      context.emitProgress('Fetching user details');
      const userDetails = await getUserDetails(primary_email, adminClient);
      beforeState = userDetails;

      context.logger.info(`[GoogleWorkspace] Found user: ${userDetails.email} (ID: ${userDetails.id})`);

      // Delete user (if not dry run)
      if (!dry_run) {
        context.emitProgress('Deleting user account');
        await deleteUser(primary_email, adminClient);
        userDeleted = true;
        context.logger.info(`[GoogleWorkspace] Successfully deleted user account: ${primary_email}`);
      } else {
        context.emitProgress('DRY RUN: Would delete user account');
        userDeleted = true; // Simulate successful deletion
      }

      const auditLog: AuditLog = {
        timestamp: new Date().toISOString(),
        action: 'user-delete',
        userEmail: primary_email,
        before: beforeState,
        dryRun: dry_run,
        changes: {
          userDeleted: true,
        },
      };

      const message = dry_run
        ? `DRY RUN: Would delete user ${primary_email} and release all associated licenses`
        : `Successfully deleted user ${primary_email} and released all associated licenses`;

      context.logger.info(`[GoogleWorkspace] ${message}`);
      context.emitProgress(`User deletion completed successfully`);

      return {
        success: true,
        audit: auditLog,
        userDeleted: true,
        message,
      };

    } catch (error: any) {
      context.logger.error(`[GoogleWorkspace] User deletion failed: ${error.message}`);
      context.emitProgress('User deletion failed');

      return {
        success: false,
        audit: {
          timestamp: new Date().toISOString(),
          action: 'user-delete',
          userEmail: primary_email,
          before: beforeState,
          dryRun: dry_run,
          changes: {
            userDeleted: false,
          },
        },
        error: error.message,
        userDeleted: false,
        message: `Failed to delete user: ${error.message}`,
      };
    }
  },
};

componentRegistry.register(definition);
