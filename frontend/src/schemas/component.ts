import { z } from 'zod'

export const ComponentRunnerSchema = z
  .object({
    kind: z.enum(['inline', 'docker', 'remote']),
  })
  .passthrough()

const PrimitivePortTypes = ['any', 'text', 'secret', 'number', 'boolean', 'file', 'json'] as const

export const PrimitivePortTypeEnum = z.enum(PrimitivePortTypes)

const PrimitivePortSchema = z.object({
  kind: z.literal('primitive'),
  name: PrimitivePortTypeEnum,
  coercion: z
    .object({
      from: z.array(PrimitivePortTypeEnum).optional(),
    })
    .optional(),
})

const ContractPortSchema = z.object({
  kind: z.literal('contract'),
  name: z.string().min(1),
})

const ListPortSchema = z.object({
  kind: z.literal('list'),
  element: z.union([PrimitivePortSchema, ContractPortSchema]),
})

const MapPortSchema = z.object({
  kind: z.literal('map'),
  value: PrimitivePortSchema,
})

export const PortDataTypeSchema = z.union([
  PrimitivePortSchema,
  ContractPortSchema,
  MapPortSchema,
  ListPortSchema,
])

export type PortDataType = z.infer<typeof PortDataTypeSchema>

/**
 * Defines input ports for a component
 */
const DEFAULT_TEXT_PORT = {
  kind: 'primitive',
  name: 'text',
} as const

export const InputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  dataType: PortDataTypeSchema.optional().default(DEFAULT_TEXT_PORT),
  required: z.boolean().optional(),
  description: z.string().optional(),
  valuePriority: z.enum(['manual-first', 'connection-first']).optional(),
})

export type InputPort = z.infer<typeof InputPortSchema>

/**
 * Defines output ports for a component
 */
export const OutputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  dataType: PortDataTypeSchema.optional().default(DEFAULT_TEXT_PORT),
  description: z.string().optional(),
})

export type OutputPort = z.infer<typeof OutputPortSchema>

/**
 * Defines configurable parameters for a component
 */
export const ParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'multi-select', 'file', 'json', 'secret']),
  required: z.boolean().optional(),
  default: z.any().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.any(),
      }),
    )
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  rows: z.number().optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  helpText: z.string().optional(),
})

export type Parameter = z.infer<typeof ParameterSchema>

/**
 * Component author information
 */
export const ComponentAuthorSchema = z.object({
  name: z.string(),
  type: z.enum(['shipsecai', 'community']),
  url: z.string().url().optional(),
})

export type ComponentAuthor = z.infer<typeof ComponentAuthorSchema>

/**
 * Component category configuration
 */
export const ComponentCategoryConfigSchema = z.object({
  label: z.string(),
  color: z.string(),
  description: z.string(),
  emoji: z.string(),
}).partial().default({
  label: 'Uncategorized',
  color: 'text-muted-foreground',
  description: '',
  emoji: '🧩',
})

export type ComponentCategoryConfig = z.infer<typeof ComponentCategoryConfigSchema>

/**
 * Complete component metadata definition
 */
export const ComponentMetadataSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  type: z.enum(['trigger', 'input', 'scan', 'process', 'output']),
  category: z.enum(['input', 'transform', 'ai', 'security', 'it_ops', 'output']),
  categoryConfig: ComponentCategoryConfigSchema.optional().default({
    label: 'Uncategorized',
    color: 'text-muted-foreground',
    description: '',
    emoji: '🧩',
  }),
  description: z.string().optional().default(''),
  documentation: z.string().optional().nullable(),
  documentationUrl: z.string().url().optional().nullable(),
  icon: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  author: ComponentAuthorSchema.optional().nullable(),
  isLatest: z.boolean().optional().default(true),
  deprecated: z.boolean().optional().default(false),
  example: z.string().optional().nullable(),
  runner: ComponentRunnerSchema.optional().default({ kind: 'inline' as const }),
  inputs: z.array(InputPortSchema).default([]),
  outputs: z.array(OutputPortSchema).default([]),
  parameters: z.array(ParameterSchema).default([]),
  examples: z.array(z.string()).optional().default([]),
})

export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>
