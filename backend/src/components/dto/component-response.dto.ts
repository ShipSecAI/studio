import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { COMPONENT_CATEGORIES } from '@shipsec/shared';

const ComponentTypeEnum = z.enum(['trigger', 'input', 'scan', 'process', 'output']);

const CategoryConfigSchema = z.object({
  label: z.string(),
  color: z.string(),
  description: z.string(),
  emoji: z.string(),
  icon: z.string(),
});

const AuthorSchema = z
  .object({
    name: z.string(),
    type: z.enum(['shipsecai', 'community']),
    url: z.string().nullable(),
  })
  .nullable();

const ConnectionTypeSchema = z
  .object({
    kind: z.enum(['primitive', 'list', 'map', 'contract', 'any']),
    name: z.string().nullable().optional(),
    element: z.record(z.string(), z.unknown()).nullable().optional(),
    credential: z.boolean().nullable().optional(),
  })
  .passthrough();

const ComponentInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  connectionType: ConnectionTypeSchema,
  editor: z
    .enum(['text', 'textarea', 'number', 'boolean', 'select', 'multi-select', 'json', 'secret'])
    .nullable()
    .optional(),
  required: z.boolean(),
  description: z.string().nullable().optional(),
  valuePriority: z.enum(['manual-first', 'connection-first']).nullable().optional(),
});

const ComponentOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  connectionType: ConnectionTypeSchema,
  description: z.string().nullable().optional(),
});

const ParameterOptionSchema = z.object({
  label: z.string(),
  value: z.unknown(),
});

const ComponentParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    'text',
    'textarea',
    'number',
    'boolean',
    'toggle',
    'select',
    'multi-select',
    'file',
    'json',
    'secret',
    'artifact',
    'variable-list',
    'form-fields',
    'selection-options',
  ]),
  required: z.boolean(),
  default: z.unknown().nullable().optional(),
  placeholder: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  options: z.array(ParameterOptionSchema).nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  rows: z.number().nullable().optional(),
});

const RunnerSchema = z.object({
  kind: z.enum(['inline', 'docker', 'remote']),
  image: z.string().nullable().optional(),
  command: z.array(z.string()).nullable().optional(),
});

const ToolProviderSchema = z
  .object({
    kind: z.enum(['component', 'mcp-server', 'mcp-group']),
    name: z.string(),
    description: z.string(),
  })
  .nullable();

const ToolSchemaSchema = z
  .object({
    enabled: z.boolean(),
    toolName: z.string().nullable().optional(),
    toolDescription: z.string().nullable().optional(),
  })
  .nullable();

export const ComponentListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  type: ComponentTypeEnum,
  category: z.enum(COMPONENT_CATEGORIES),
  categoryConfig: CategoryConfigSchema,
  description: z.string(),
  documentation: z.string().nullable(),
  documentationUrl: z.string().nullable(),
  icon: z.string().nullable(),
  logo: z.string().nullable(),
  author: AuthorSchema,
  isLatest: z.boolean().nullable(),
  deprecated: z.boolean().nullable(),
  example: z.string().nullable(),
  runner: RunnerSchema,
  inputs: z.array(ComponentInputSchema),
  outputs: z.array(ComponentOutputSchema),
  parameters: z.array(ComponentParameterSchema),
  examples: z.array(z.string()),
  toolProvider: ToolProviderSchema,
  toolSchema: ToolSchemaSchema.optional(),
});
export class ComponentListItemDto extends createZodDto(ComponentListItemSchema) {}

export const ComponentDetailSchema = ComponentListItemSchema.extend({
  agentTool: z
    .object({
      enabled: z.boolean(),
      toolName: z.string().nullable().optional(),
      toolDescription: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export class ComponentDetailDto extends createZodDto(ComponentDetailSchema) {}
