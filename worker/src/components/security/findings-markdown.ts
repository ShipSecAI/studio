import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

const LOG_PREFIX = '[Findings Markdown]';

/**
 * Findings Markdown Formatter Component
 *
 * Converts normalized findings into a Markdown report suitable for PR comments.
 * Features:
 * - Summary table by severity
 * - Collapsible details for each finding
 * - Grouping by scanner
 * - Truncation for large reports (GitHub comment size limits)
 */

// Normalized finding schema (from security.findings.normalize)
const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']);

const normalizedFindingSchema = z.object({
  scanner: z.string(),
  finding_hash: z.string(),
  severity: severitySchema,
  asset_key: z.string().optional(),
  rule_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  snippet: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const inputSchema = inputs({
  findings: port(z.array(normalizedFindingSchema), {
    label: 'Normalized Findings',
    description: 'Array of findings from security.findings.normalize',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  prContext: port(
    z
      .object({
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number().optional(),
        headSha: z.string().optional(),
        cloneUrl: z.string().optional(),
      })
      .optional(),
    {
      label: 'PR Context',
      description: 'Optional PR context to add links to files',
      connectionType: { kind: 'any' },
    },
  ),
});

export type FindingsMarkdownInput = typeof inputSchema;

const outputSchema = outputs({
  markdown: port(z.string(), {
    label: 'Markdown Report',
    description: 'Formatted Markdown string ready for PR comment',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  hasFindings: port(z.boolean(), {
    label: 'Has Findings',
    description: 'True if there are any findings in the report',
    connectionType: { kind: 'primitive', name: 'boolean' },
  }),
});

export type FindingsMarkdownOutput = typeof outputSchema;

const parameterSchema = parameters({
  title: param(z.string().default('Security Scan Results'), {
    label: 'Report Title',
    editor: 'text',
    description: 'Title header for the notification',
  }),
  grouping: param(z.enum(['scanner', 'severity', 'none']).default('scanner'), {
    label: 'Group By',
    editor: 'select',
    options: [
      { label: 'Scanner', value: 'scanner' },
      { label: 'Severity', value: 'severity' },
      { label: 'None (Flat List)', value: 'none' },
    ],
    description: 'How to group findings in the report',
  }),
  maxFindings: param(z.number().min(1).max(50).default(20), {
    label: 'Max Findings',
    editor: 'number',
    description: 'Maximum number of findings to show in detail before truncating',
  }),
  showScanner: param(z.boolean().default(false), {
    label: 'Show Scanner Tag',
    editor: 'boolean',
    description:
      'Append the scanner name (e.g. opengrep) to each finding line. Useful when grouping by severity across multiple scanners.',
  }),
  logoUrl: param(
    z.string().optional().default('https://avatars.githubusercontent.com/u/211031279?s=200&v=4'),
    {
      label: 'Logo URL',
      editor: 'text',
      description: 'URL of the logo image to display in the footer.',
    },
  ),
});

// Helper: Get emoji for severity
function getSeverityEmoji(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return '🔴';
    case 'high':
      return '🟠';
    case 'medium':
      return '🟡';
    case 'low':
      return '🔵';
    case 'info':
      return 'ℹ️';
    default:
      return '⚪';
  }
}

// Helper: Generate file link
function getFileLink(
  file: string,
  line: number | undefined,
  context: z.infer<typeof inputSchema>['prContext'],
): string {
  if (!context || !context.owner || !context.repo || !context.headSha) {
    return line ? `${file}:${line}` : file;
  }
  // GitHub permalink
  const url = `https://github.com/${context.owner}/${context.repo}/blob/${context.headSha}/${file}${line ? `#L${line}` : ''}`;
  return `[${file}${line ? `:${line}` : ''}](${url})`;
}

const definition = defineComponent({
  id: 'security.findings.markdown',
  label: 'Format Findings to Markdown',
  category: 'notification',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Converts normalized findings into a rich Markdown report with severity summaries, file links, and categorization.',
  ui: {
    slug: 'security-findings-markdown',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: 'Format security findings as a Markdown report for PR comments.',
    documentation:
      'Connect normalized findings to generate a GitHub-flavored Markdown report. Supports grouping by scanner or severity, and limits output size for comments.',
    icon: 'FileText',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'Normalize Findings → Format Findings → Post PR Comment',
    examples: ['Create a daily security report', 'Generate PR comment body from multiple scanners'],
  },
  async execute({ inputs, params }, context) {
    const { findings, prContext } = inputSchema.parse(inputs);
    const { title, grouping, maxFindings, showScanner, logoUrl } = parameterSchema.parse(params);

    context.logger.info(`${LOG_PREFIX} Formatting ${findings.length} findings into Markdown`);

    // Build context line for header
    const contextParts: string[] = [];
    if (prContext?.owner && prContext?.repo) {
      contextParts.push(`\`${prContext.owner}/${prContext.repo}\``);
    }
    if (prContext?.pullNumber) {
      contextParts.push(`PR #${prContext.pullNumber}`);
    }
    if (prContext?.headSha) {
      contextParts.push(`\`${prContext.headSha.slice(0, 7)}\``);
    }
    const contextLine = contextParts.length > 0 ? contextParts.join(' | ') : '';

    if (findings.length === 0) {
      let emptyReport = `## ${title}\n\n`;
      if (contextLine) emptyReport += `${contextLine}\n\n`;
      const logoTag = logoUrl
        ? `<img src="${logoUrl}" width="16" height="16" align="absmiddle"> `
        : '';
      emptyReport += `> **No issues found**\n\n---\n<sub>${logoTag}ShipSec</sub>`;
      return outputSchema.parse({
        markdown: emptyReport,
        hasFindings: false,
      });
    }

    // summary stats
    const stats = {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info' || f.severity === 'none').length,
      total: findings.length,
    };

    let md = `## ${title}\n\n`;
    if (contextLine) md += `${contextLine}\n\n`;

    // 1. Compact severity badges
    const badges: string[] = [];
    if (stats.critical > 0) badges.push(`🔴 **${stats.critical}** critical`);
    if (stats.high > 0) badges.push(`🟠 **${stats.high}** high`);
    if (stats.medium > 0) badges.push(`🟡 **${stats.medium}** medium`);
    if (stats.low > 0) badges.push(`🔵 **${stats.low}** low`);
    if (stats.info > 0) badges.push(`ℹ️ **${stats.info}** info`);
    md += `> **${stats.total} finding${stats.total !== 1 ? 's' : ''}:** ${badges.join(' · ')}\n\n`;

    // 2. Truncation Warning
    const shownFindings = findings.slice(0, maxFindings);
    const hiddenCount = findings.length - maxFindings;

    if (hiddenCount > 0) {
      md += `> Showing ${maxFindings} of ${findings.length} findings.\n\n`;
    }

    // Helper to truncate long descriptions
    const truncateDesc = (desc: string, max = 200): string => {
      if (desc.length <= max) return desc;
      return desc.slice(0, max).replace(/\s+\S*$/, '') + '...';
    };

    // Helper to render a finding
    const renderFinding = (f: z.infer<typeof normalizedFindingSchema>) => {
      const icon = getSeverityEmoji(f.severity);
      const fileLink = f.file ? getFileLink(f.file, f.line, prContext) : '';
      const scanner = showScanner ? ` _(${f.scanner})_` : '';

      let entry = `<details>\n<summary>${icon} <b>${f.title}</b>`;
      if (fileLink) entry += ` — ${fileLink}`;
      entry += `${scanner}</summary>\n\n`;

      // Rule ID as inline code
      entry += `**Rule:** \`${f.rule_id}\`\n\n`;

      if (f.description) {
        entry += `${truncateDesc(f.description)}\n\n`;
      }

      if (f.snippet) {
        const ext = f.file?.split('.').pop() || '';
        const lang = /^[a-z0-9]+$/i.test(ext) ? ext : '';
        entry += `\`\`\`${lang}\n${f.snippet.trim()}\n\`\`\`\n`;
      }

      entry += `\n</details>\n\n`;
      return entry;
    };

    if (grouping === 'scanner') {
      const byScanner: Record<string, typeof findings> = {};
      shownFindings.forEach((f) => {
        const s = f.scanner || 'unknown';
        if (!byScanner[s]) byScanner[s] = [];
        byScanner[s].push(f);
      });

      Object.keys(byScanner)
        .sort()
        .forEach((scanner) => {
          md += `### ${scanner.toUpperCase()}\n\n`;
          byScanner[scanner].forEach((f) => {
            md += renderFinding(f);
          });
        });
    } else if (grouping === 'severity') {
      const order = ['critical', 'high', 'medium', 'low', 'info', 'none'];
      const bySeverity: Record<string, typeof findings> = {};
      shownFindings.forEach((f) => {
        const s = f.severity;
        if (!bySeverity[s]) bySeverity[s] = [];
        bySeverity[s].push(f);
      });

      order.forEach((sev) => {
        if (bySeverity[sev] && bySeverity[sev].length > 0) {
          md += `### ${getSeverityEmoji(sev)} ${sev.charAt(0).toUpperCase() + sev.slice(1)}\n\n`;
          bySeverity[sev].forEach((f) => {
            md += renderFinding(f);
          });
        }
      });
    } else {
      shownFindings.forEach((f) => {
        md += renderFinding(f);
      });
    }

    if (logoUrl) {
      md += `---\n<sub><img src="${logoUrl}" width="16" height="16" align="absmiddle"> ShipSec</sub>`;
    } else {
      md += `---\n<sub>ShipSec</sub>`;
    }

    context.emitProgress({
      message: `Formatted ${findings.length} findings into Markdown`,
      level: 'info',
      data: { stats, length: md.length },
    });

    return outputSchema.parse({
      markdown: md,
      hasFindings: true,
    });
  },
});

componentRegistry.register(definition);
