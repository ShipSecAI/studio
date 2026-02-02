import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
} from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { executeMcpGroupNode, McpGroupTemplateSchema } from '../core/mcp-group-runtime';

/**
 * AWS MCP Group Template
 *
 * Curated list of AWS MCP servers with credential mapping.
 *
 * Servers:
 * - aws-cloudtrail: AWS CloudTrail MCP server for querying API audit logs
 * - aws-cloudwatch: Amazon CloudWatch MCP server for metrics and logs
 */
const AwsGroupTemplate = McpGroupTemplateSchema.parse({
  slug: 'aws',
  name: 'AWS MCPs',
  description: 'Curated AWS MCP servers (CloudTrail, CloudWatch, ...)',
  credentialContractName: 'core.credential.aws',
  defaultDockerImage: 'shipsec/mcp-aws-suite:latest',
  credentialMapping: {
    env: {
      AWS_ACCESS_KEY_ID: 'accessKeyId',
      AWS_SECRET_ACCESS_KEY: 'secretAccessKey',
      AWS_SESSION_TOKEN: 'sessionToken?',
      AWS_REGION: 'region?',
    },
    awsFiles: true,
  },
  servers: [
    {
      id: 'aws-cloudtrail',
      command: 'awslabs.cloudtrail-mcp-server',
    },
    {
      id: 'aws-cloudwatch',
      command: 'awslabs.cloudwatch-mcp-server',
    },
  ],
});

const inputSchema = inputs({
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'AWS credential bundle (access key, secret key, optional session token).',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const endpointSchema = z.object({
  endpoint: z.string().describe('The URL of the MCP server'),
  containerId: z.string().optional().describe('The Docker container ID'),
  serverId: z.string().describe('The server identifier'),
});

const outputSchema = outputs({
  endpoints: port(z.array(endpointSchema).describe('Array of MCP server endpoints'), {
    label: 'Endpoints',
    description: 'MCP server endpoints from selected AWS services',
    schemaName: 'security.aws-mcp-group.endpoints',
  }),
});

const parameterSchema = parameters({
  enabledServers: param(
    z
      .array(z.string())
      .default(['aws-cloudtrail', 'aws-cloudwatch'])
      .describe('Array of AWS MCP server IDs to enable'),
    {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select AWS MCP servers to enable tools from',
      options: [
        { value: 'aws-cloudtrail', label: 'AWS CloudTrail' },
        { value: 'aws-cloudwatch', label: 'AWS CloudWatch' },
      ],
    },
  ),
});

const definition = defineComponent({
  id: 'security.aws-mcp-group',
  label: 'AWS MCPs',
  category: 'mcp',
  runner: {
    kind: 'inline',
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'AWS MCP Group node. Exposes tools from curated AWS MCP servers (CloudTrail, CloudWatch) using AWS credentials. Each selected server runs in its own container with the group image.',
  ui: {
    slug: 'aws-mcp-group',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description:
      'Expose AWS MCP tools from curated AWS services (CloudTrail, CloudWatch) using AWS credentials.',
    icon: 'Cloud',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    agentTool: {
      enabled: true,
      toolName: 'aws_mcp_group',
      toolDescription: 'Expose AWS MCP tools from selected AWS services.',
    },
    isLatest: true,
  },
  async execute({ inputs, params }, context) {
    const credentials = inputs.credentials;
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      throw new Error('AWS credentials are required for AWS MCP Group');
    }

    const enabledServers = params.enabledServers as string[];
    if (enabledServers.length === 0) {
      return { endpoints: [] };
    }

    // Use the group runtime helper
    const result = await executeMcpGroupNode(
      context,
      { credentials },
      { enabledServers },
      AwsGroupTemplate,
    );

    return result;
  },
});

componentRegistry.register(definition);

export type AwsMcpGroupInput = typeof inputSchema;
export type AwsMcpGroupParams = typeof parameterSchema;
export type AwsMcpGroupOutput = typeof outputSchema;
export type AwsMcpGroupEndpoint = z.infer<typeof endpointSchema>;
