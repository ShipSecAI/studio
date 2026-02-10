import { Controller, Get, NotFoundException, Param, Post, Body } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

// Ensure all worker components are registered before accessing the registry
import '@shipsec/studio-worker/components';
import {
  componentRegistry,
  extractPorts,
  isAgentCallable,
  getToolSchema,
  type CachedComponentMetadata,
} from '@shipsec/component-sdk';
import { categorizeComponent, getCategoryConfig } from './utils/categorization';

function serializeComponent(entry: CachedComponentMetadata) {
  const component = entry.definition;
  const metadata = component.ui ?? {
    slug: component.id,
    version: '1.0.0',
    type: 'process',
    category: 'transform',
  };

  // Categorize the component using the new backend logic
  const category = categorizeComponent(component);
  const categoryConfig = getCategoryConfig(category);

  return {
    id: component.id,
    slug: metadata.slug ?? component.id,
    name: component.label,
    version: metadata.version ?? '1.0.0',
    type: metadata.type ?? 'process',
    category: category,
    categoryConfig: categoryConfig,
    description: metadata.description ?? component.docs ?? '',
    documentation: metadata.documentation ?? component.docs ?? '',
    documentationUrl: metadata.documentationUrl ?? null,
    icon: metadata.icon ?? null,
    logo: metadata.logo ?? null,
    author: metadata.author ?? null,
    isLatest: metadata.isLatest ?? true,
    deprecated: metadata.deprecated ?? false,
    example: metadata.example ?? null,
    runner: component.runner,
    inputs: entry.inputs ?? [],
    outputs: entry.outputs ?? [],
    parameters: entry.parameters ?? [],
    examples: metadata.examples ?? [],
    toolProvider: component.toolProvider ?? null,
    toolSchema: isAgentCallable(component) ? getToolSchema(component) : null,
  };
}

@ApiTags('components')
@Controller('components')
export class ComponentsController {
  @Get()
  @ApiOkResponse({
    description: 'List all registered components',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'core.file.loader' },
          slug: { type: 'string', example: 'file-loader' },
          name: { type: 'string', example: 'File Loader' },
          version: { type: 'string', example: '1.0.0' },
          type: { type: 'string', example: 'input' },
          category: { type: 'string', example: 'input' },
          categoryConfig: {
            type: 'object',
            properties: {
              label: { type: 'string', example: 'Input' },
              color: { type: 'string', example: 'text-blue-600' },
              description: {
                type: 'string',
                example: 'Data sources, triggers, and credential access',
              },
              emoji: { type: 'string', example: '📥' },
              icon: { type: 'string', example: 'Download' },
            },
          },
          description: { type: 'string', example: 'Load files from filesystem' },
          documentation: { type: 'string', nullable: true },
          documentationUrl: { type: 'string', nullable: true },
          icon: { type: 'string', example: 'FileUp' },
          logo: { type: 'string', nullable: true },
          isLatest: { type: 'boolean', nullable: true },
          deprecated: { type: 'boolean', nullable: true },
          example: { type: 'string', nullable: true },
          author: {
            type: 'object',
            nullable: true,
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['shipsecai', 'community'] },
              url: { type: 'string', nullable: true },
            },
          },
          runner: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['inline', 'docker', 'remote'],
                example: 'inline',
              },
              image: { type: 'string', nullable: true },
              command: {
                type: 'array',
                nullable: true,
                items: { type: 'string' },
              },
            },
          },
          inputs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                connectionType: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['primitive', 'list', 'map', 'contract', 'any'] },
                    name: { type: 'string', nullable: true },
                    element: { type: 'object', nullable: true },
                    credential: { type: 'boolean', nullable: true },
                  },
                  required: ['kind'],
                  additionalProperties: true,
                },
                editor: {
                  type: 'string',
                  enum: [
                    'text',
                    'textarea',
                    'number',
                    'boolean',
                    'select',
                    'multi-select',
                    'json',
                    'secret',
                  ],
                  nullable: true,
                },
                required: { type: 'boolean' },
                description: { type: 'string', nullable: true },
                valuePriority: {
                  type: 'string',
                  enum: ['manual-first', 'connection-first'],
                  nullable: true,
                },
              },
            },
          },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                connectionType: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['primitive', 'list', 'map', 'contract', 'any'] },
                    name: { type: 'string', nullable: true },
                    element: { type: 'object', nullable: true },
                    credential: { type: 'boolean', nullable: true },
                  },
                  required: ['kind'],
                  additionalProperties: true,
                },
                description: { type: 'string', nullable: true },
              },
            },
          },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                type: {
                  type: 'string',
                  enum: [
                    'text',
                    'textarea',
                    'number',
                    'boolean',
                    'select',
                    'multi-select',
                    'json',
                    'secret',
                  ],
                },
                required: { type: 'boolean' },
                default: { nullable: true },
                placeholder: { type: 'string', nullable: true },
                description: { type: 'string', nullable: true },
                helpText: { type: 'string', nullable: true },
                options: {
                  type: 'array',
                  nullable: true,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      value: {},
                    },
                  },
                },
                min: { type: 'number', nullable: true },
                max: { type: 'number', nullable: true },
                rows: { type: 'number', nullable: true },
              },
            },
          },
          examples: {
            type: 'array',
            items: { type: 'string' },
          },
          toolProvider: {
            type: 'object',
            nullable: true,
            properties: {
              kind: { type: 'string', enum: ['component', 'mcp-server', 'mcp-group'] },
              name: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  })
  listComponents() {
    const components = componentRegistry.listMetadata();

    return components.map((entry) => serializeComponent(entry));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Get a specific component by ID',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
        type: { type: 'string' },
        category: { type: 'string' },
        categoryConfig: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            color: { type: 'string' },
            description: { type: 'string' },
            emoji: { type: 'string' },
            icon: { type: 'string' },
          },
        },
        description: { type: 'string', nullable: true },
        documentation: { type: 'string', nullable: true },
        documentationUrl: { type: 'string', nullable: true },
        icon: { type: 'string', nullable: true },
        logo: { type: 'string', nullable: true },
        author: {
          type: 'object',
          nullable: true,
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            url: { type: 'string', nullable: true },
          },
        },
        runner: { type: 'object' },
        inputs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              connectionType: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['primitive', 'list', 'map', 'contract', 'any'] },
                  name: { type: 'string', nullable: true },
                  element: { type: 'object', nullable: true },
                  credential: { type: 'boolean', nullable: true },
                },
                required: ['kind'],
                additionalProperties: true,
              },
              editor: {
                type: 'string',
                enum: [
                  'text',
                  'textarea',
                  'number',
                  'boolean',
                  'select',
                  'multi-select',
                  'json',
                  'secret',
                ],
                nullable: true,
              },
              required: { type: 'boolean' },
              description: { type: 'string', nullable: true },
              valuePriority: {
                type: 'string',
                enum: ['manual-first', 'connection-first'],
                nullable: true,
              },
            },
          },
        },
        outputs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              connectionType: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['primitive', 'list', 'map', 'contract', 'any'] },
                  name: { type: 'string', nullable: true },
                  element: { type: 'object', nullable: true },
                  credential: { type: 'boolean', nullable: true },
                },
                required: ['kind'],
                additionalProperties: true,
              },
              description: { type: 'string', nullable: true },
            },
          },
        },
        parameters: { type: 'array' },
        examples: { type: 'array' },
        deprecated: { type: 'boolean', nullable: true },
        example: { type: 'string', nullable: true },
        agentTool: {
          type: 'object',
          nullable: true,
          properties: {
            enabled: { type: 'boolean' },
            toolName: { type: 'string', nullable: true },
            toolDescription: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  getComponent(@Param('id') id: string) {
    const entry = componentRegistry.getMetadata(id);

    if (!entry) {
      throw new NotFoundException(`Component ${id} not found`);
    }

    return serializeComponent(entry);
  }
  @Post(':id/resolve-ports')
  @ApiOkResponse({
    description: 'Resolve dynamic ports based on parameters',
  })
  resolvePorts(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const entry = componentRegistry.getMetadata(id);

    if (!entry) {
      throw new NotFoundException(`Component ${id} not found`);
    }

    const component = entry.definition;
    const baseInputs = entry.inputs ?? extractPorts(component.inputs);
    const baseOutputs = entry.outputs ?? extractPorts(component.outputs);

    if (!component.resolvePorts) {
      // If no dynamic resolver, return static definition
      return {
        inputs: baseInputs,
        outputs: baseOutputs,
      };
    }

    // Call the resolver
    try {
      const resolved = component.resolvePorts(body);
      return {
        inputs: resolved.inputs ? extractPorts(resolved.inputs) : baseInputs,
        outputs: resolved.outputs ? extractPorts(resolved.outputs) : baseOutputs,
      };
    } catch (error: any) {
      // Fallback to static on error
      console.error(`Error resolving ports for ${id}:`, error);
      return {
        inputs: baseInputs,
        outputs: baseOutputs,
      };
    }
  }
}
