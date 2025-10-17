import { z } from 'zod'

export const ComponentRunnerSchema = z
  .object({
    kind: z.enum(['inline', 'docker', 'remote']),
  })
  .passthrough()

/**
 * Defines input ports for a component
 */
export const InputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['string', 'array', 'object', 'file', 'any']),
  required: z.boolean().optional(),
  description: z.string().optional(),
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
})

export type OutputPort = z.infer<typeof OutputPortSchema>

/**
 * Defines configurable parameters for a component
 */
export const ParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'multi-select', 'file', 'json']),
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
 * Complete component metadata definition
 */
export const ComponentMetadataSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  type: z.enum(['trigger', 'input', 'scan', 'process', 'output']),
  category: z.enum(['security-tool', 'building-block', 'input-output', 'trigger']),
  description: z.string().optional().default(''),
  documentation: z.string().optional().nullable(),
  documentationUrl: z.string().url().optional().nullable(),
  icon: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  author: ComponentAuthorSchema.optional().nullable(),
  isLatest: z.boolean().optional().default(true),
  deprecated: z.boolean().optional().default(false),
  runner: ComponentRunnerSchema,
  inputs: z.array(InputPortSchema).default([]),
  outputs: z.array(OutputPortSchema).default([]),
  parameters: z.array(ParameterSchema).default([]),
})

export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>
