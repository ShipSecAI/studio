import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_DIR = join(__dirname, 'templates');

function loadTemplates(): Record<string, McpGroupTemplate> {
  const templates: Record<string, McpGroupTemplate> = {};
  const files = readdirSync(TEMPLATE_DIR).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(TEMPLATE_DIR, file), 'utf-8')) as McpGroupTemplate;
    const slug = raw.slug || file.replace(/\.json$/, '');
    templates[slug] = { ...raw, slug };
  }

  return templates;
}

/**
 * Registry of all available MCP group templates
 */
export const MCP_GROUP_TEMPLATES: Record<string, McpGroupTemplate> = {
  ...loadTemplates(),
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
