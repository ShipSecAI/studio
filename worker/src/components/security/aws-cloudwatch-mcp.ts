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
  image: param(z.string().default('shipsec/mcp-aws-cloudwatch:latest'), {
    label: 'Docker Image',
    editor: 'text',
  }),
  region: param(z.string().optional().describe('AWS region for CloudWatch queries.'), {
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

const definition = defineComponent({
  id: 'security.aws-cloudwatch-mcp',
  label: 'AWS CloudWatch MCP Server',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'placeholder',
    command: [],
    detached: true,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs the AWS CloudWatch MCP server in a container and exposes it via the MCP gateway (tool-mode only).',
  ui: {
    slug: 'aws-cloudwatch-mcp',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description: 'Expose AWS CloudWatch via MCP for tool-mode agents.',
    icon: 'Activity',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    agentTool: {
      enabled: true,
      toolName: 'aws_cloudwatch_mcp',
      toolDescription: 'Expose AWS CloudWatch MCP tools to agents.',
    },
    isLatest: true,
  },
  async execute({ inputs, params }, context) {
    const credentials = inputs.credentials;
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      throw new ValidationError('AWS credentials are required for CloudWatch MCP', {
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

    return startMcpDockerServer({
      image: params.image,
      command: [],
      env,
      port,
      params,
      context,
    });
  },
});

componentRegistry.register(definition);

export type AwsCloudwatchMcpInput = typeof inputSchema;
export type AwsCloudwatchMcpParams = typeof parameterSchema;
export type AwsCloudwatchMcpOutput = typeof outputSchema;
