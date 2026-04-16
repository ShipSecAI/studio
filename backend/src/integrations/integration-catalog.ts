import type { IntegrationProviderConfig } from './integration-providers';

export interface AuthMethodField {
  id: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { label: string; value: string }[];
}

export interface AuthMethod {
  type: string;
  label: string;
  description: string;
  fields: AuthMethodField[];
}

export interface SetupInstructionSection {
  title: string;
  authMethodType: string;
  scenario: string;
  steps: string[];
}

export interface IntegrationProviderDefinition {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  iconUrl?: string;
  authMethods: AuthMethod[];
  supportsMultipleConnections: boolean;
  installUrl?: string | null;
  setupInstructions: { sections: SetupInstructionSection[] };
  oauthConfig?: IntegrationProviderConfig;
}

export const AWS_PROVIDER: IntegrationProviderDefinition = {
  id: 'aws',
  name: 'Amazon Web Services',
  description:
    'Connect AWS accounts for cloud security posture management (CSPM), compliance scanning, and resource discovery.',
  docsUrl:
    'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html',
  iconUrl: '/icons/aws.svg',
  supportsMultipleConnections: true,
  authMethods: [
    {
      type: 'iam_role',
      label: 'IAM Role',
      description:
        'Create an IAM role in your AWS account (IAM → Roles → Create role → "Custom trust policy") that allows the ShipSec platform to assume it. No customer secrets are stored.',
      fields: [
        {
          id: 'roleArn',
          label: 'Role ARN',
          type: 'text',
          required: true,
          placeholder: 'arn:aws:iam::123456789012:role/ShipSecAuditRole',
        },
        {
          id: 'region',
          label: 'Default Region',
          type: 'text',
          required: false,
          placeholder: 'us-east-1',
          helpText: 'Default AWS region for API calls. Can be overridden per workflow.',
        },
      ],
    },
  ],
  setupInstructions: {
    sections: [
      {
        title: 'Single Account',
        authMethodType: 'iam_role',
        scenario: 'single-account',
        steps: [
          'Click "Add Connection" to generate a trust policy with a unique External ID.',
          'In the target AWS account, create an IAM role with `SecurityAudit` and `ViewOnlyAccess` policies.',
          'Set the trust policy to the JSON shown in the setup dialog (includes the ShipSec platform ARN and External ID).',
          'Copy the role ARN and paste it into the form, then click "Create Connection".',
        ],
      },
      {
        title: 'Cross-Account',
        authMethodType: 'iam_role',
        scenario: 'cross-account',
        steps: [
          'Click "Add Connection" to generate a trust policy with a unique External ID.',
          'In each target account, create an IAM role with `SecurityAudit` and `ViewOnlyAccess` policies.',
          'Use the same trust policy JSON from the setup dialog for each role.',
          'Add one connection per target account using its role ARN.',
        ],
      },
      {
        title: 'Organizations',
        authMethodType: 'iam_role',
        scenario: 'organizations',
        steps: [
          'Click "Add Connection" for your management account and apply the trust policy shown.',
          'Ensure the management role has `SecurityAudit`, `ViewOnlyAccess`, and `OrganizationsReadOnlyAccess` policies.',
          'Use "Discover Accounts" to list all member accounts.',
          'For each member account, create a role with the same trust policy and add a connection.',
        ],
      },
    ],
  },
};

export const GCP_PROVIDER: IntegrationProviderDefinition = {
  id: 'gcp',
  name: 'Google Cloud',
  description:
    'Connect GCP projects and organizations for Cartography inventory indexing and GCP cloud security assessments.',
  docsUrl:
    'https://cloud.google.com/iam/docs/service-account-permissions#service_account_token_creator_role',
  iconUrl: '/icons/gcp.svg',
  supportsMultipleConnections: true,
  authMethods: [
    {
      type: 'service_account',
      label: 'Service Account Impersonation',
      description:
        'Configure a target service account for ShipSec to impersonate. No customer service-account key JSON is uploaded.',
      fields: [
        {
          id: 'displayName',
          label: 'Display Name',
          type: 'text',
          required: true,
          placeholder: 'Production GCP',
        },
        {
          id: 'defaultProjectId',
          label: 'Default Project ID',
          type: 'text',
          required: false,
          placeholder: 'my-project-123',
          helpText: 'Optional default project scope for indexing and UI defaults.',
        },
        {
          id: 'organizationId',
          label: 'Organization ID',
          type: 'text',
          required: false,
          placeholder: '123456789012',
          helpText: 'Optional GCP organization identifier if this credential spans an org.',
        },
        {
          id: 'targetServiceAccountEmail',
          label: 'Target Service Account Email',
          type: 'text',
          required: true,
          placeholder: 'shipsec-reader@my-project.iam.gserviceaccount.com',
          helpText:
            'ShipSec will impersonate this service account at runtime. Grant ShipSec token-creator on this account.',
        },
      ],
    },
  ],
  setupInstructions: {
    sections: [
      {
        title: 'Single Project',
        authMethodType: 'service_account',
        scenario: 'single-project',
        steps: [
          'Click "Add Connection" and follow the wizard to create a service account in your GCP project with `Viewer`, `Security Admin`, and `Service Usage Viewer` roles.',
          'Run the `gcloud iam service-accounts add-iam-policy-binding` command shown in step 2 to let ShipSec impersonate the account. No keys are shared.',
          'Paste the service account email into the form and click "Create Connection". Then use "Validate" to confirm access.',
        ],
      },
      {
        title: 'Organization',
        authMethodType: 'service_account',
        scenario: 'organization',
        steps: [
          'Create a service account in your GCP org with `Viewer`, `Security Admin`, `Service Usage Viewer`, `Organization Viewer`, and `Role Viewer` roles.',
          'Run the impersonation grant command shown in the setup wizard to let ShipSec impersonate the account.',
          'Add a connection with the service account email and your Organization ID, then use "Discover Projects" to list all accessible projects.',
        ],
      },
    ],
  },
};

export const SLACK_PROVIDER: IntegrationProviderDefinition = {
  id: 'slack',
  name: 'Slack',
  description: 'Send workflow notifications, security alerts, and scan results to Slack channels.',
  docsUrl: 'https://api.slack.com/messaging/webhooks',
  iconUrl: '/icons/slack.svg',
  supportsMultipleConnections: true,
  authMethods: [
    {
      type: 'webhook',
      label: 'Incoming Webhook',
      description:
        'Simple webhook URL for sending messages to a specific channel. No OAuth required.',
      fields: [
        {
          id: 'webhookUrl',
          label: 'Webhook URL',
          type: 'password',
          required: true,
          placeholder: 'https://hooks.slack.com/services/T.../B.../...',
          helpText: 'Create an incoming webhook at https://api.slack.com/apps',
        },
      ],
    },
    {
      type: 'oauth',
      label: 'Slack App (OAuth)',
      description:
        'Full Slack app with OAuth for channel messaging, slash commands, and thread-based agent chat. Requires a Slack app with channels:read, channels:history, chat:write, chat:write.public, commands, app_mentions:read, and team:read scopes.',
      fields: [],
    },
  ],
  setupInstructions: {
    sections: [
      {
        title: 'Incoming Webhook',
        authMethodType: 'webhook',
        scenario: 'webhook',
        steps: [
          'Go to https://api.slack.com/apps and create a new app (or select an existing one).',
          'Navigate to "Incoming Webhooks" and toggle it on.',
          'Click "Add New Webhook to Workspace" and select the target channel.',
          'Copy the generated webhook URL and paste it below.',
        ],
      },
      {
        title: 'Slack App (OAuth)',
        authMethodType: 'oauth',
        scenario: 'oauth',
        steps: [
          'Click "Add to Slack" below to authorize ShipSec in your workspace.',
          'Select the channel you want to receive notifications in.',
          'Once authorized, the connection will appear automatically.',
        ],
      },
    ],
  },
};

export const JIRA_PROVIDER: IntegrationProviderDefinition = {
  id: 'jira',
  name: 'Jira',
  description:
    'Connect Jira for vulnerability ticket management, automated issue creation, and workflow tracking.',
  docsUrl: 'https://developer.atlassian.com/platform/forge/',
  iconUrl: '/icons/jira.svg',
  supportsMultipleConnections: false,
  installUrl: process.env.JIRA_FORGE_INSTALL_URL || null,
  authMethods: [
    {
      type: 'forge_app',
      label: 'Forge App',
      description:
        'Install the ShipSec.ai Forge app on your Jira site. The app runs with its own identity — no personal credentials needed. Connection is created automatically after install.',
      fields: [
        {
          id: 'webTriggerUrl',
          label: 'Web Trigger URL',
          type: 'password',
          required: true,
          placeholder: 'https://xxxx.hello.atlassian-dev.net/x1/...',
          helpText:
            'Only needed if auto-registration did not complete. Run "forge webtrigger" to get this URL.',
        },
      ],
    },
  ],
  setupInstructions: {
    sections: [
      {
        title: 'Install Forge App',
        authMethodType: 'forge_app',
        scenario: 'forge-app',
        steps: [
          'Click "Install on Jira" to add the ShipSec.ai app to your Jira site.',
          'Approve the requested permissions (read/write issues, read users).',
          'The connection will be created automatically — no further configuration needed.',
        ],
      },
    ],
  },
};

export function getCatalog(): IntegrationProviderDefinition[] {
  return [AWS_PROVIDER, GCP_PROVIDER, SLACK_PROVIDER, JIRA_PROVIDER];
}
