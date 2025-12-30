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
import { admin, auth as googleAdminAuth } from '@googleapis/admin';

const inputSchema = z.object({
  primary_email: z.string().email(),
  dry_run: z.boolean().default(false),
  service_account_secret: z.string().describe('Google Workspace service account JSON key from Secret Fetch component'),
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

  const auth = new googleAdminAuth.GoogleAuth({
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
    throw new ServiceError(`Failed to delete user: ${error.message}`, {
      cause: error,
      details: { userEmail, operation: 'deleteUser' },
    });
  }
}

const componentDocumentation = [
  'Delete a Google Workspace user account to free up all associated licenses and complete the offboarding process.',
  '',
  'How it works:',
  '- Resolves the Google Workspace service account JSON (with domain-wide delegation) from ShipSec Secrets.',
  '- Fetches the current user profile to capture org unit, admin status, suspension flag, and last login details for auditing.',
  '- Deletes the account through the Admin SDK Directory API unless Dry Run is enabled.',
  '- Emits an audit log containing the before state and whether the deletion was executed or simulated.',
  '',
  'Inputs:',
  '1. **User Email** - Primary email address of the account to remove. Must exist in the tenant.',
  '2. **Dry Run Mode** - Toggle to preview the deletion without calling the Admin SDK delete endpoint. Still returns an audit log.',
  '3. **Service Account Secret** - Secret ID pointing to a JSON key authorised for the Admin SDK with domain-wide delegation.',
  '',
  'Service account setup:',
  '1. In Google Cloud Console create or select a project that will host the service account used for automation. The account that creates the key needs the **Service Account Token Creator** IAM role (or Editor/Owner) on that project.',
  '2. Enable the **Admin SDK API** inside that project. The Directory API is the only scope this component uses.',
  '3. Create a **service account** (IAM & Admin -> Service Accounts -> Create service account). Grant it at least the Service Account Token Creator role so workflow runs can mint delegated credentials.',
  '4. From the service account details page open the **Keys** tab -> **Add Key** -> **Create new key** (JSON). Download the JSON file, upload it to ShipSec Secrets, and note the resulting secret ID to supply as the component input.',
  '5. Still within the service account, open **Show domain-wide delegation**, enable the toggle, and capture the generated OAuth2 client ID.',
  '6. In the Google Workspace Admin Console, go to Security -> Access and data control -> API controls -> **Domain-wide delegation**. Add a new delegation entry with the client ID and authorise the scope https://www.googleapis.com/auth/admin.directory.user.',
  '7. Choose a Workspace user that can delete accounts (Super Admin or a delegated admin with the **User Management Admin** or equivalent custom role) and allow the service account to impersonate that user via domain-wide delegation. The impersonated admin must retain delete permissions or the Directory API will reject the call.',
  '8. Rotate the service account key on a regular cadence, re-upload the updated JSON to ShipSec Secrets, and update any workflows that reference the secret when you change its identifier.',
  '',
  'Outputs:',
  '- **User Deletion Result** - JSON payload with success, userDeleted, message, optional error, and an audit object capturing before/after state and dry-run status.',
  '',
  'Operational notes:',
  '- The component requires the worker to inject the Secrets service (ISecretsService). Missing secrets or invalid JSON keys result in failure and a surfaced error message.',
  '- Dry Run mode returns userDeleted: true to indicate the action would succeed while leaving the account untouched.',
  '- Progress updates stream via context.emitProgress so downstream workflow consumers can display live status.',
].join('\n');

const definition: ComponentDefinition<Input, GoogleWorkspaceUserDeleteOutput> = {
  id: 'it-automation.google-workspace.user-delete',
  label: 'Google Workspace User Delete',
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
  docs: componentDocumentation,
  metadata: {
    slug: 'google-workspace-user-delete',
    version: '2.0.0',
    type: 'output',
    category: 'it_ops',
    description: 'Delete Google Workspace user accounts to automatically release all licenses and complete offboarding.',
    documentation: componentDocumentation,
    icon: 'Building',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'primary_email',
        label: 'User Email',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'Email address of the user to delete.',
      },
      {
        id: 'service_account_secret',
        label: 'Service Account Secret',
        dataType: port.secret(),  // Changed from text to secret for proper masking
        required: true,
        description: 'Google Workspace service account JSON key (can be provided directly or via Secret Fetch component).',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'User Deletion Result',
        dataType: port.json(),
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
      primary_email,
      dry_run = false,
      service_account_secret,
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
      // Validate secret input
      if (!service_account_secret) {
        throw new ConfigurationError(
          'Service account secret is required. Please provide the Google Workspace service account JSON key directly or connect a Secret Fetch component.',
          { configKey: 'service_account_secret' },
        );
      }

      // Parse service account key from the input (could be string or object)
      let serviceKey: string;
      try {
        serviceKey = typeof service_account_secret === 'string'
          ? service_account_secret
          : JSON.stringify(service_account_secret);
      } catch (error) {
        throw new ConfigurationError(
          `Failed to parse service account secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
          {
            configKey: 'service_account_secret',
            cause: error instanceof Error ? error : undefined,
          },
        );
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
