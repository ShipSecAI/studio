import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TemplateVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface GitHubMcpTemplateDefaults {
  readOnly?: boolean;
  toolsets?: string[];
  tools?: string[];
  dynamicToolsets?: boolean;
  githubHost?: string;
}

export interface McpServerTemplate {
  slug: string;
  name: string;
  description?: string;
  transportType: 'http' | 'stdio';
  runtimeType: 'docker' | 'host';
  authSource: 'none' | 'github_app';
  command?: string;
  args?: string[];
  endpoint?: string;
  docsUrl?: string;
  icon?: string;
  supportsReadOnly?: boolean;
  supportsDynamicToolsets?: boolean;
  availableToolsets?: string[];
  defaultToolsets?: string[];
  defaultTools?: string[];
  version: TemplateVersion;
  github?: GitHubMcpTemplateDefaults;
}

export function computeTemplateHash(template: McpServerTemplate): string {
  const content = JSON.stringify({
    name: template.name,
    description: template.description,
    transportType: template.transportType,
    runtimeType: template.runtimeType,
    authSource: template.authSource,
    command: template.command,
    args: template.args,
    endpoint: template.endpoint,
    docsUrl: template.docsUrl,
    supportsReadOnly: template.supportsReadOnly,
    supportsDynamicToolsets: template.supportsDynamicToolsets,
    availableToolsets: template.availableToolsets,
    defaultToolsets: template.defaultToolsets,
    defaultTools: template.defaultTools,
    version: template.version,
    github: template.github,
  });

  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_DIR = join(__dirname, 'templates');

function loadTemplates(): Record<string, McpServerTemplate> {
  const templates: Record<string, McpServerTemplate> = {};
  const files = readdirSync(TEMPLATE_DIR).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(TEMPLATE_DIR, file), 'utf-8')) as McpServerTemplate;
    const slug = raw.slug || file.replace(/\.json$/, '');
    templates[slug] = { ...raw, slug };
  }

  return templates;
}

export const MCP_SERVER_TEMPLATES: Record<string, McpServerTemplate> = {
  ...loadTemplates(),
};

export function getServerTemplateBySlug(slug: string): McpServerTemplate | undefined {
  return MCP_SERVER_TEMPLATES[slug];
}

export function getAllServerTemplates(): McpServerTemplate[] {
  return Object.values(MCP_SERVER_TEMPLATES);
}
