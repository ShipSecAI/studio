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
 * - aws-iam: AWS IAM MCP server for identity and access management
 * - aws-s3-tables: AWS S3 Tables MCP server for S3 table operations
 * - aws-cloudwatch: Amazon CloudWatch MCP server for metrics and logs
 * - aws-network: AWS Network MCP server for VPC and networking
 * - aws-lambda: AWS Lambda MCP server for serverless functions
 * - aws-dynamodb: Amazon DynamoDB MCP server for NoSQL database operations
 * - aws-documentation: AWS Documentation MCP server for querying AWS docs
 * - aws-well-architected: AWS Well-Architected Security MCP server for security reviews
 * - aws-api: AWS API MCP server for general AWS API access
 */
const AwsGroupTemplate = McpGroupTemplateSchema.parse({
  slug: 'aws',
  name: 'AWS MCPs',
  description: 'Curated AWS MCP servers (CloudTrail, CloudWatch, IAM, S3, Lambda, DynamoDB, ...)',
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
      name: 'cloudtrail',
      command: 'awslabs.cloudtrail-mcp-server',
    },
    {
      id: 'aws-iam',
      name: 'iam',
      command: 'awslabs.iam-mcp-server',
    },
    {
      id: 'aws-s3-tables',
      name: 's3-tables',
      command: 'awslabs.s3-tables-mcp-server',
    },
    {
      id: 'aws-cloudwatch',
      name: 'cloudwatch',
      command: 'awslabs.cloudwatch-mcp-server',
    },
    {
      id: 'aws-network',
      name: 'aws-network',
      command: 'awslabs.aws-network-mcp-server',
    },
    {
      id: 'aws-lambda',
      name: 'lambda',
      command: 'awslabs.lambda-tool-mcp-server',
    },
    {
      id: 'aws-dynamodb',
      name: 'dynamodb',
      command: 'awslabs.dynamodb-mcp-server',
    },
    {
      id: 'aws-documentation',
      name: 'aws-documentation',
      command: 'awslabs.aws-documentation-mcp-server',
    },
    {
      id: 'aws-well-architected',
      name: 'well-architected-security',
      command: 'awslabs.well-architected-security-mcp-server',
    },
    {
      id: 'aws-api',
      name: 'aws-api',
      command: 'awslabs.aws-api-mcp-server',
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

const outputSchema = outputs({
  tools: port(z.unknown().optional().describe('MCP tools from selected AWS services'), {
    label: 'Tools',
    description:
      'MCP tools from selected AWS services (CloudTrail, IAM, S3, CloudWatch, Lambda, DynamoDB, Documentation, Well-Architected, API)',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
    allowAny: true,
    reason:
      'MCP tools are dynamically discovered from AWS servers at runtime and cannot have a fixed schema',
  }),
});

const parameterSchema = parameters({
  enabledServers: param(
    z
      .array(z.string())
      .default([
        'aws-cloudtrail',
        'aws-iam',
        'aws-s3-tables',
        'aws-cloudwatch',
        'aws-network',
        'aws-lambda',
        'aws-dynamodb',
        'aws-documentation',
        'aws-well-architected',
        'aws-api',
      ])
      .describe('Array of AWS MCP server IDs to enable'),
    {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select AWS MCP servers to enable tools from',
      options: [
        { value: 'aws-cloudtrail', label: 'AWS CloudTrail' },
        { value: 'aws-iam', label: 'AWS IAM' },
        { value: 'aws-s3-tables', label: 'AWS S3 Tables' },
        { value: 'aws-cloudwatch', label: 'AWS CloudWatch' },
        { value: 'aws-network', label: 'AWS Network' },
        { value: 'aws-lambda', label: 'AWS Lambda' },
        { value: 'aws-dynamodb', label: 'AWS DynamoDB' },
        { value: 'aws-documentation', label: 'AWS Documentation' },
        { value: 'aws-well-architected', label: 'AWS Well-Architected Security' },
        { value: 'aws-api', label: 'AWS API' },
      ],
    },
  ),
});

const definition = defineComponent({
  id: 'mcp.group.aws',
  label: 'AWS MCPs',
  category: 'mcp',
  runner: {
    kind: 'inline',
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'AWS MCP Group node. Exposes tools from curated AWS MCP servers (CloudTrail, IAM, S3 Tables, CloudWatch, Network, Lambda, DynamoDB, Documentation, Well-Architected Security, API) using AWS credentials. Each selected server runs in its own container with the group image. Tools are registered with the Tool Registry and can be connected to any AI agent.',
  ui: {
    slug: 'aws-mcp-group',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description:
      'Expose AWS MCP tools from curated AWS services (CloudTrail, IAM, S3 Tables, CloudWatch, Network, Lambda, DynamoDB, Documentation, Well-Architected Security, API) using AWS credentials.',
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
      return { tools: [] };
    }

    // Use the group runtime helper to register tools
    const result = await executeMcpGroupNode(context, { credentials }, { enabledServers }, AwsGroupTemplate);

    // Return the list of enabled tools to the tools output port
    // This allows the workflow to pass tool information to connected nodes
    return {
      tools: enabledServers.map(serverId => ({
        id: serverId,
        name: AwsGroupTemplate.servers.find(s => s.id === serverId)?.name || serverId,
        type: 'mcp-server',
        group: 'aws',
      })),
    };
  },
});

componentRegistry.register(definition);

export type AwsMcpGroupInput = typeof inputSchema;
export type AwsMcpGroupParams = typeof parameterSchema;
export type AwsMcpGroupOutput = typeof outputSchema;
