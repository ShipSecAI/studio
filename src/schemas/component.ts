import { z } from 'zod'

/**
 * Defines input ports for a component
 */
export const InputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['string', 'array', 'object', 'file', 'any']),
  required: z.boolean().default(false),
  description: z.string().optional(),

  // Type-specific constraints
  accepts: z.array(z.string()).optional(), // ["text/plain", "application/json"]
  maxItems: z.number().optional(),         // For arrays
})

export type InputPort = z.infer<typeof InputPortSchema>

/**
 * Defines output ports for a component
 */
export const OutputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['string', 'array', 'object', 'file', 'any']),
  description: z.string().optional(),
  format: z.string().optional(), // "application/json"
})

export type OutputPort = z.infer<typeof OutputPortSchema>

/**
 * Defines configurable parameters for a component
 */
export const ParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'boolean', 'select', 'multi-select', 'file']),

  required: z.boolean().default(false),
  default: z.any().optional(),

  // For select/multi-select
  options: z.array(z.object({
    label: z.string(),
    value: z.any(),
  })).optional(),

  // For number type
  min: z.number().optional(),
  max: z.number().optional(),

  placeholder: z.string().optional(),
  description: z.string().optional(),
  helpText: z.string().optional(), // Tooltip text
})

export type Parameter = z.infer<typeof ParameterSchema>

/**
 * Component author information
 */
export const ComponentAuthorSchema = z.object({
  name: z.string(),
  type: z.enum(['shipsector', 'community']),
  url: z.string().url().optional(),
})

export type ComponentAuthor = z.infer<typeof ComponentAuthorSchema>

/**
 * Complete component metadata definition
 */
export const ComponentMetadataSchema = z.object({
  // Identification
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),

  // Categorization
  category: z.enum(['security-tool', 'building-block', 'input-output']),
  type: z.enum(['input', 'scan', 'process', 'output']),

  // Authorship
  author: ComponentAuthorSchema,

  // Documentation
  description: z.string().max(200),
  documentation: z.string().optional(),
  icon: z.string(), // Lucide icon name

  // Status
  isLatest: z.boolean(),
  deprecated: z.boolean().default(false),

  // Component contract
  inputs: z.array(InputPortSchema),
  outputs: z.array(OutputPortSchema),
  parameters: z.array(ParameterSchema),

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>
