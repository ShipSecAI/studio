import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

function summarizeTemplate(template: any) {
  return {
    id: template.id,
    organizationId: template.organizationId ?? null,
    name: template.name,
    slug: template.slug,
    description: template.description ?? null,
    category: template.category,
    status: template.status,
    scope: template.scope,
    visibility: template.visibility,
    publishedAt: template.publishedAt ?? null,
    publishedVersionId: template.publishedVersionId ?? null,
    draftVersionId: template.draftVersionId ?? null,
    draftSessionId: template.draftSessionId ?? null,
    publishedVersion: template.publishedVersion
      ? {
          id: template.publishedVersion.id,
          versionNumber: template.publishedVersion.versionNumber,
          kind: template.publishedVersion.kind,
          name: template.publishedVersion.name,
          description: template.publishedVersion.description ?? null,
        }
      : null,
    draftVersion: template.draftVersion
      ? {
          id: template.draftVersion.id,
          versionNumber: template.draftVersion.versionNumber,
          kind: template.draftVersion.kind,
          name: template.draftVersion.name,
          description: template.draftVersion.description ?? null,
        }
      : null,
  };
}

export function registerReportTemplateTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const service = deps.reportTemplatesService;
  if (!service) {
    return;
  }

  server.registerTool(
    'list_report_templates',
    {
      description:
        'List published report templates visible to the organization. Draft templates are intentionally excluded.',
    },
    async () => {
      const gate = checkPermission(auth, 'report-templates.read');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        const templates = await service.listPublished(auth);
        return jsonResult(templates.map((template) => summarizeTemplate(template)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_report_template',
    {
      description: 'Get a published report template and its current published version snapshot.',
      inputSchema: { templateId: z.string().uuid() },
    },
    async (args: { templateId: string }) => {
      const gate = checkPermission(auth, 'report-templates.read');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        return jsonResult(
          summarizeTemplate(await service.getPublishedTemplate(args.templateId, auth)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_report_template_draft',
    {
      description:
        'Get the active draft working copy for a report template. This is intended for chat-based authoring flows.',
      inputSchema: { templateId: z.string().uuid() },
    },
    async (args: { templateId: string }) => {
      const gate = checkPermission(auth, 'report-templates.read');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        const draft = await service.getDraftTemplate(args.templateId, auth);
        return jsonResult({
          ...summarizeTemplate(draft),
          draftVersion: draft.draftVersion
            ? {
                ...summarizeTemplate(draft).draftVersion,
                htmlTemplate: draft.draftVersion.htmlTemplate,
                css: draft.draftVersion.css,
                inputSchema: draft.draftVersion.inputSchema,
                sampleData: draft.draftVersion.sampleData,
              }
            : null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_report_template_draft',
    {
      description:
        'Create a report template draft using Liquid HTML and CSS. Drafts remain hidden from the main library until published.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().min(1),
        htmlTemplate: z.string().min(1),
        css: z.string().default(''),
        inputSchema: z.record(z.string(), z.unknown()).default({}),
        sampleData: z.record(z.string(), z.unknown()).default({}),
        chatSessionId: z.string().uuid().optional(),
      },
    },
    async (args) => {
      const gate = checkPermission(auth, 'report-templates.write');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        return jsonResult(summarizeTemplate(await service.createDraft(auth, args)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_report_template_draft',
    {
      description:
        'Update the draft working copy for a report template. If the template is already published, this resumes or creates a hidden draft overlay.',
      inputSchema: {
        templateId: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        category: z.string().min(1).optional(),
        htmlTemplate: z.string().min(1).optional(),
        css: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        sampleData: z.record(z.string(), z.unknown()).optional(),
        chatSessionId: z.string().uuid().nullable().optional(),
      },
    },
    async (args) => {
      const gate = checkPermission(auth, 'report-templates.write');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        const { templateId, ...patch } = args;
        return jsonResult(summarizeTemplate(await service.updateDraft(templateId, auth, patch)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'render_report_template_preview',
    {
      description:
        'Render the active draft or current version of a report template into HTML for inline chat preview.',
      inputSchema: {
        templateId: z.string().uuid(),
        data: z.record(z.string(), z.unknown()).default({}),
      },
    },
    async (args: { templateId: string; data: Record<string, unknown> }) => {
      const gate = checkPermission(auth, 'report-templates.read');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        const preview = await service.renderDraftPreview(args.templateId, auth, args.data);
        return jsonResult({
          templateId: preview.templateId,
          versionId: preview.versionId,
          versionNumber: preview.versionNumber,
          kind: preview.kind,
          html: preview.html,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'publish_report_template',
    {
      description:
        'Publish the active draft in place, creating a new immutable published version snapshot and making it visible in the report template library.',
      inputSchema: { templateId: z.string().uuid() },
    },
    async (args: { templateId: string }) => {
      const gate = checkPermission(auth, 'report-templates.write');
      if (!gate.allowed && auth.apiKeyPermissions) return gate.error;
      try {
        return jsonResult(summarizeTemplate(await service.publish(args.templateId, auth)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
