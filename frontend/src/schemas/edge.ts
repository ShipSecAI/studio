import { z } from 'zod'

export const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.enum(['default', 'smoothstep', 'step', 'straight']).default('default'),
  animated: z.boolean().optional(),
  label: z.string().optional(),
})

export type Edge = z.infer<typeof EdgeSchema>