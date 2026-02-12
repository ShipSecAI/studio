import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

/**
 * Reusable helper: assumes an AWS IAM role via STS.
 * Exported for use by other components (e.g. prowler org scan).
 */
export async function assumeRole(
  sourceCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
  },
  roleArn: string,
  options?: { externalId?: string; sessionName?: string },
): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}> {
  const stsClient = new STSClient({
    credentials: {
      accessKeyId: sourceCredentials.accessKeyId,
      secretAccessKey: sourceCredentials.secretAccessKey,
      sessionToken: sourceCredentials.sessionToken,
    },
    region: sourceCredentials.region ?? 'us-east-1',
  });

  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: options?.sessionName ?? 'shipsec-session',
    DurationSeconds: 3600,
    ...(options?.externalId ? { ExternalId: options.externalId } : {}),
  });

  const response = await stsClient.send(command);

  if (!response.Credentials) {
    throw new Error(`STS AssumeRole did not return credentials for role ${roleArn}.`);
  }

  return {
    accessKeyId: response.Credentials.AccessKeyId ?? '',
    secretAccessKey: response.Credentials.SecretAccessKey ?? '',
    sessionToken: response.Credentials.SessionToken,
    region: sourceCredentials.region,
  };
}

const inputSchema = inputs({
  sourceCredentials: port(awsCredentialSchema(), {
    label: 'Source Credentials',
    description: 'AWS credentials to use when assuming the target role.',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const parameterSchema = parameters({
  roleArn: param(
    z.string().min(1, 'Role ARN is required').describe('ARN of the IAM role to assume.'),
    {
      label: 'Role ARN',
      editor: 'text',
      description:
        'The ARN of the IAM role to assume (e.g. arn:aws:iam::123456789012:role/MyRole).',
    },
  ),
  externalId: param(
    z.string().optional().describe('Optional external ID for cross-account role assumption.'),
    {
      label: 'External ID',
      editor: 'text',
      description: 'Optional external ID required by the trust policy of the target role.',
    },
  ),
  sessionName: param(
    z.string().default('shipsec-session').describe('Session name for the assumed role session.'),
    {
      label: 'Session Name',
      editor: 'text',
      description: 'Name for the assumed role session. Defaults to shipsec-session.',
    },
  ),
});

const outputSchema = outputs({
  credentials: port(awsCredentialSchema(), {
    label: 'Assumed Role Credentials',
    description: 'Temporary assumed role credentials',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const definition = defineComponent({
  id: 'core.aws.assume-role',
  label: 'AWS Assume Role',
  category: 'process',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Assume an AWS IAM role using STS and return temporary credentials. Useful for cross-account access and least-privilege workflows.',
  ui: {
    slug: 'aws-assume-role',
    version: '1.0.0',
    type: 'process',
    category: 'cloud',
    description:
      'Assume an AWS IAM role via STS to obtain temporary credentials for cross-account or scoped access.',
    icon: 'Shield',
  },
  async execute({ inputs, params }, context) {
    const sourceCreds = inputSchema.parse(inputs).sourceCredentials;

    if (!sourceCreds.accessKeyId || !sourceCreds.secretAccessKey) {
      throw new ConfigurationError(
        'Source AWS credentials (accessKeyId and secretAccessKey) are required.',
        { configKey: 'sourceCredentials' },
      );
    }

    const roleArn = params.roleArn as string;
    const sessionName = (params.sessionName as string) ?? 'shipsec-session';

    context.emitProgress(`Assuming role ${roleArn}...`);

    const credentials = await assumeRole(sourceCreds, roleArn, {
      externalId: params.externalId as string | undefined,
      sessionName,
    });

    context.logger.info(
      `[AWSAssumeRole] Successfully assumed role ${roleArn} (session: ${sessionName}).`,
    );
    context.emitProgress(`Assumed role ${roleArn} successfully.`);

    return outputSchema.parse({ credentials });
  },
});

componentRegistry.register(definition);
