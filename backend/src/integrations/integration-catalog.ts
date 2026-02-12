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
  iconUrl: '/icons/aws.png',
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
        'Full Slack app with OAuth for sending messages, slash commands, and DMs. Requires a Slack app with channels:read, chat:write, chat:write.public, commands, and im:write scopes.',
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
          'Go to https://api.slack.com/apps and create a new app.',
          'Under "OAuth & Permissions", add the bot token scopes: channels:read, chat:write, chat:write.public, commands, im:write.',
          'Set the redirect URL to the one shown below.',
          'Copy the Client ID and Client Secret into the provider configuration.',
          'Click "Add to Slack" to complete the OAuth flow.',
        ],
      },
    ],
  },
};

export function getCatalog(): IntegrationProviderDefinition[] {
  return [AWS_PROVIDER, SLACK_PROVIDER];
}
