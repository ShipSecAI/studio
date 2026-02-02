import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
  ValidationError,
} from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { startMcpDockerServer } from '../core/mcp-runtime';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const inputSchema = inputs({
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'AWS credential bundle (access key, secret key, optional session token).',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const outputSchema = outputs({
  endpoint: port(z.string().describe('The URL of the MCP server'), { label: 'Endpoint' }),
  containerId: port(z.string().optional().describe('The Docker container ID'), {
    label: 'Container ID',
    hidden: true,
  }),
});

const parameterSchema = parameters({
  image: param(z.string().default('shipsec/mcp-aws-cloudtrail:latest'), {
    label: 'Docker Image',
    editor: 'text',
  }),
  region: param(z.string().optional().describe('AWS region for CloudTrail queries.'), {
    label: 'Region',
    editor: 'text',
    placeholder: 'us-east-1',
  }),
  port: param(z.number().optional().describe('Internal port the MCP proxy listens on'), {
    label: 'Port',
    editor: 'number',
  }),
  extraArgs: param(z.array(z.string()).default([]).describe('Extra args for the MCP server.'), {
    label: 'Extra Args',
    editor: 'variable-list',
  }),
});

/**
 * AWS CloudTrail MCP Server Component
 *
 * @deprecated Use `security.aws-mcp-group` instead. This component will be removed in a future version.
 * The new AWS MCP group node provides a unified interface for all AWS MCP servers including CloudTrail,
 * CloudWatch, and other AWS services in a single component.
 */
const definition = defineComponent({
  id: 'security.aws-cloudtrail-mcp',
  label: 'AWS CloudTrail MCP (DEPRECATED)',
  category: 'mcp',
  runner: {
    kind: 'docker',
    image: 'placeholder',
    command: [],
    detached: true,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'DEPRECATED: Use the AWS MCPs node instead. This component provides CloudTrail MCP server access.',
  ui: {
    slug: 'aws-cloudtrail-mcp',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description:
      'DEPRECATED: Use the AWS MCPs node instead. This component provides CloudTrail MCP server access. Migrate to the unified AWS MCP group for better management.',
    icon: 'Plug',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    agentTool: {
      enabled: true,
      toolName: 'aws_cloudtrail_mcp',
      toolDescription: 'Expose AWS CloudTrail MCP tools to agents.',
    },
    isLatest: true,
  },
  async execute({ inputs, params }, context) {
    const credentials = inputs.credentials;
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      throw new ValidationError('AWS credentials are required for CloudTrail MCP', {
        fieldErrors: { credentials: ['AWS credentials are required'] },
      });
    }

    const region = params.region || credentials.region || 'us-east-1';
    const port = params.port;

    const env: Record<string, string> = {
      AWS_ACCESS_KEY_ID: credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      AWS_REGION: region,
      AWS_DEFAULT_REGION: region,
    };

    if (params.extraArgs && params.extraArgs.length > 0) {
      env.MCP_ARGS = JSON.stringify(params.extraArgs);
    }

    if (port) {
      env.MCP_PORT = String(port);
    }

    if (credentials.sessionToken) {
      env.AWS_SESSION_TOKEN = credentials.sessionToken;
    }

    env.AWS_SHARED_CREDENTIALS_FILE = '/root/.aws/credentials';
    env.AWS_CONFIG_FILE = '/root/.aws/config';
    env.AWS_PROFILE = 'default';

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    let volumeInitialized = false;

    try {
      const credsLines = [
        '[default]',
        `aws_access_key_id = ${credentials.accessKeyId}`,
        `aws_secret_access_key = ${credentials.secretAccessKey}`,
      ];
      if (credentials.sessionToken) {
        credsLines.push(`aws_session_token = ${credentials.sessionToken}`);
      }

      const configLines = ['[default]', `region = ${region}`, 'output = json'];

      await volume.initialize({
        credentials: credsLines.join('\n'),
        config: configLines.join('\n'),
      });
      volumeInitialized = true;

      return await startMcpDockerServer({
        image: params.image,
        command: [],
        env,
        port,
        params,
        context,
        volumes: [volume.getVolumeConfig('/root/.aws', true)],
      });
    } catch (error) {
      if (volumeInitialized) {
        await volume.cleanup().catch(() => {});
      }
      throw error;
    }
  },
});

componentRegistry.register(definition);

export type AwsCloudtrailMcpInput = typeof inputSchema;
export type AwsCloudtrailMcpParams = typeof parameterSchema;
export type AwsCloudtrailMcpOutput = typeof outputSchema;
