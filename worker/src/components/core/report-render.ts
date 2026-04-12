import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
} from '@shipsec/component-sdk';
import { createInternalBackendClient } from '../../utils/internal-backend-client';

const inputSchema = inputs({
  data: port(z.record(z.string(), z.unknown()).default({}), {
    label: 'Data',
    description: 'Structured data used to render the report template.',
    editor: 'json',
  }),
  branding: port(z.record(z.string(), z.unknown()).optional(), {
    label: 'Branding',
    description: 'Optional branding overrides merged into the report payload.',
    editor: 'json',
  }),
});

const parameterSchema = parameters({
  templateId: param(z.string().uuid(), {
    label: 'Template ID',
    editor: 'text',
    description: 'Published report template identifier.',
  }),
  templateVersionId: param(z.string().uuid().optional(), {
    label: 'Template Version ID',
    editor: 'text',
    description:
      'Optional immutable published version. If omitted, the backend uses the current published snapshot.',
  }),
  artifactName: param(z.string().default('security-report'), {
    label: 'Artifact Name',
    editor: 'text',
    description: 'Base name used when saving the rendered HTML artifact.',
  }),
  saveToRunArtifacts: param(z.boolean().default(true), {
    label: 'Save to Run Artifacts',
    editor: 'boolean',
  }),
  publishToArtifactLibrary: param(z.boolean().default(false), {
    label: 'Publish to Artifact Library',
    editor: 'boolean',
  }),
});

const outputSchema = outputs({
  html: port(z.string(), {
    label: 'HTML',
    description: 'Rendered HTML output.',
  }),
  artifactId: port(z.string().optional(), {
    label: 'Artifact ID',
    description: 'Artifact identifier when the result is persisted.',
  }),
  templateId: port(z.string(), {
    label: 'Template ID',
    description: 'Resolved report template ID.',
  }),
  templateVersionId: port(z.string(), {
    label: 'Template Version ID',
    description: 'Resolved immutable published version ID.',
  }),
  versionNumber: port(z.number(), {
    label: 'Version Number',
    description: 'Published template version number used for rendering.',
  }),
});

const definition = defineComponent({
  id: 'core.report.render',
  label: 'Render Report',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Render a published report template with structured data and optionally save the HTML as an artifact.',
  ui: {
    slug: 'report-render',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description: 'Render a published report template into HTML using structured data.',
    icon: 'FileSpreadsheet',
  },
  async execute({ inputs, params }, context) {
    const organizationId = context.organizationId ?? context.metadata.organizationId ?? null;
    if (!organizationId) {
      throw new ConfigurationError('Report rendering requires context.organizationId', {
        configKey: 'organizationId',
      });
    }

    const client = createInternalBackendClient({
      headers: { 'X-Organization-Id': organizationId },
    });

    const payload = {
      versionId: params.templateVersionId ?? null,
      data: {
        ...(inputs.data ?? {}),
        ...(inputs.branding ? { branding: inputs.branding } : {}),
      },
    };

    const response = await client.renderReportTemplate(params.templateId, payload);
    if (response.error || !response.data) {
      throw new Error('Failed to render report template');
    }

    const rendered = response.data as {
      templateId: string;
      versionId: string;
      versionNumber: number;
      html: string;
    };

    let artifactId: string | undefined;
    const destinations: ('run' | 'library')[] = [];
    if (params.saveToRunArtifacts) {
      destinations.push('run');
    }
    if (params.publishToArtifactLibrary) {
      destinations.push('library');
    }

    if (destinations.length > 0) {
      if (!context.artifacts) {
        throw new ConfigurationError('Artifact service is not available for report rendering', {
          configKey: 'artifacts',
        });
      }

      const upload = await context.artifacts.upload({
        name: `${params.artifactName}.html`,
        mimeType: 'text/html',
        content: Buffer.from(rendered.html, 'utf-8'),
        destinations,
        metadata: {
          templateId: rendered.templateId,
          templateVersionId: rendered.versionId,
          templateVersionNumber: rendered.versionNumber,
        },
      });
      artifactId = upload.artifactId;
    }

    return {
      html: rendered.html,
      artifactId,
      templateId: rendered.templateId,
      templateVersionId: rendered.versionId,
      versionNumber: rendered.versionNumber,
    };
  },
});

componentRegistry.register(definition);

export default definition;
