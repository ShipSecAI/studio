import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

// Ensure all worker components are registered before accessing the registry
import '../../../worker/src/components';
import { componentRegistry } from '@shipsec/component-sdk';

function serializeComponent(component: ReturnType<typeof componentRegistry.get>) {
  if (!component) {
    return null;
  }

  const metadata = component.metadata ?? {
    slug: component.id,
    version: '1.0.0',
    type: 'process',
    category: 'building-block',
  };

  return {
    id: component.id,
    slug: metadata.slug ?? component.id,
    name: component.label,
    version: metadata.version ?? '1.0.0',
    type: metadata.type ?? 'process',
    category: metadata.category ?? component.category,
    description: metadata.description ?? component.docs ?? '',
    documentation: metadata.documentation ?? component.docs ?? '',
    documentationUrl: metadata.documentationUrl ?? null,
    icon: metadata.icon ?? null,
    logo: metadata.logo ?? null,
    author: metadata.author ?? null,
    isLatest: metadata.isLatest ?? true,
    deprecated: metadata.deprecated ?? false,
    runner: component.runner,
    inputs: metadata.inputs ?? [],
    outputs: metadata.outputs ?? [],
    parameters: metadata.parameters ?? [],
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
          category: { type: 'string', example: 'input-output' },
          description: { type: 'string', example: 'Load files from filesystem' },
          icon: { type: 'string', example: 'FileUp' },
          logo: { type: 'string', nullable: true },
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
                type: { type: 'string', enum: ['string', 'array', 'object', 'file', 'any'] },
                required: { type: 'boolean' },
                description: { type: 'string', nullable: true },
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
                type: { type: 'string', enum: ['string', 'array', 'object', 'file', 'any'] },
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
                  enum: ['text', 'textarea', 'number', 'boolean', 'select', 'multi-select', 'json'],
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
        },
      },
    },
  })
  listComponents() {
    const components = componentRegistry.list();

    // Transform to frontend-friendly format
    return components.map((component) => serializeComponent(component));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Get a specific component by ID',
  })
  getComponent(@Param('id') id: string) {
    const component = componentRegistry.get(id);

    if (!component) {
      throw new NotFoundException(`Component ${id} not found`);
    }

    return serializeComponent(component);
  }
}
