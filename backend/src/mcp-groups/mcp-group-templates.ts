/**
 * MCP Group Templates
 *
 * Defines predefined templates for MCP server groups.
 * Templates provide:
 * - Logical groupings of related MCP servers
 * - Shared credential contracts
 * - Default Docker images for containerized execution
 * - Server configurations with transport details
 */

/**
 * Server configuration within a group template
 */
export interface GroupTemplateServer {
  name: string;
  description?: string;
  transportType: 'http' | 'stdio' | 'sse' | 'websocket';
  endpoint?: string;
  command?: string;
  args?: string[];
  recommended?: boolean;
  defaultSelected?: boolean;
}

/**
 * Template version metadata for change detection
 */
export interface TemplateVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Complete group template definition
 */
export interface McpGroupTemplate {
  slug: string;
  name: string;
  description?: string;
  credentialContractName: string;
  credentialMapping?: Record<string, unknown>;
  defaultDockerImage: string;
  version: TemplateVersion;
  servers: GroupTemplateServer[];
}

/**
 * Compute deterministic version hash from template content
 * Used to detect when templates have changed and need updating
 */
export function computeTemplateHash(template: McpGroupTemplate): string {
  const content = JSON.stringify({
    name: template.name,
    description: template.description,
    credentialContractName: template.credentialContractName,
    credentialMapping: template.credentialMapping,
    defaultDockerImage: template.defaultDockerImage,
    version: template.version,
    servers: template.servers.map((s) => ({
      name: s.name,
      description: s.description,
      transportType: s.transportType,
      endpoint: s.endpoint,
      command: s.command,
      args: s.args,
    })),
  });

  // Simple hash for version tracking
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * AWS Group Template
 *
 * Provides AWS-related MCP servers for cloud operations.
 * Requires AWS credentials with appropriate IAM permissions.
 */
export const awsGroupTemplate: McpGroupTemplate = {
  slug: 'aws',
  name: 'AWS',
  description: 'Essential AWS security tools for auditing, monitoring, and incident response',
  credentialContractName: 'core.credential.aws',
  credentialMapping: {
    accessKeyId: 'AWS_ACCESS_KEY_ID',
    secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
    sessionToken: 'AWS_SESSION_TOKEN',
    region: 'AWS_REGION',
  },
  defaultDockerImage: 'shipsec/mcp-aws-suite:latest',
  version: { major: 2, minor: 0, patch: 0 },
  servers: [
    {
      name: 'cloudtrail',
      description:
        'CloudTrail auditing - event lookup, user activity analysis, compliance investigations',
      transportType: 'stdio',
      command: 'awslabs.cloudtrail-mcp-server',
      recommended: true,
      defaultSelected: true,
    },
    {
      name: 'iam',
      description: 'IAM security - user/role management, permission analysis, access key audit',
      transportType: 'stdio',
      command: 'awslabs.iam-mcp-server',
      recommended: true,
      defaultSelected: true,
    },
    {
      name: 's3-tables',
      description: 'S3 Tables security - S3 Tables bucket policies, access controls',
      transportType: 'stdio',
      command: 'awslabs.s3-tables-mcp-server',
      recommended: true,
      defaultSelected: true,
    },
    {
      name: 'cloudwatch',
      description: 'CloudWatch monitoring - logs, metrics, alarms for security events',
      transportType: 'stdio',
      command: 'awslabs.cloudwatch-mcp-server',
      recommended: true,
      defaultSelected: true,
    },
    {
      name: 'aws-network',
      description: 'AWS Network - VPC, networking configuration, security groups',
      transportType: 'stdio',
      command: 'awslabs.aws-network-mcp-server',
      recommended: true,
      defaultSelected: false,
    },
    {
      name: 'lambda',
      description: 'Lambda security - function permissions, runtime analysis, IAM roles',
      transportType: 'stdio',
      command: 'awslabs.lambda-tool-mcp-server',
      recommended: false,
      defaultSelected: false,
    },
    {
      name: 'dynamodb',
      description: 'DynamoDB security - table access policies, encryption, point-in-time recovery',
      transportType: 'stdio',
      command: 'awslabs.dynamodb-mcp-server',
      recommended: false,
      defaultSelected: false,
    },
    {
      name: 'aws-documentation',
      description: 'AWS docs - real-time access to official AWS security documentation',
      transportType: 'stdio',
      command: 'awslabs.aws-documentation-mcp-server',
      recommended: true,
      defaultSelected: false,
    },
    {
      name: 'well-architected-security',
      description: 'Security review - AWS Well-Architected security best practices framework',
      transportType: 'stdio',
      command: 'awslabs.well-architected-security-mcp-server',
      recommended: false,
      defaultSelected: false,
    },
    {
      name: 'aws-api',
      description: 'AWS API explorer - interact with any AWS service API directly',
      transportType: 'stdio',
      command: 'awslabs.aws-api-mcp-server',
      recommended: false,
      defaultSelected: false,
    },
  ],
};

/**
 * Registry of all available MCP group templates
 */
export const MCP_GROUP_TEMPLATES: Record<string, McpGroupTemplate> = {
  aws: awsGroupTemplate,
};

/**
 * Get a template by slug
 */
export function getTemplateBySlug(slug: string): McpGroupTemplate | undefined {
  return MCP_GROUP_TEMPLATES[slug];
}

/**
 * Get all available templates
 */
export function getAllTemplates(): McpGroupTemplate[] {
  return Object.values(MCP_GROUP_TEMPLATES);
}

/**
 * Get template slugs
 */
export function getTemplateSlugs(): string[] {
  return Object.keys(MCP_GROUP_TEMPLATES);
}
