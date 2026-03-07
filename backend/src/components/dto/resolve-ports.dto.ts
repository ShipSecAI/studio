import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ResolvePortParameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const ResolvePortsRequestSchema = z.record(z.string(), ResolvePortParameterValueSchema);

export class ResolvePortsRequestDto extends createZodDto(ResolvePortsRequestSchema) {}

const PortConnectionTypeSchema = z.object({
  kind: z.string(),
  name: z.string().optional(),
  credential: z.boolean().optional(),
});

const ResolvedInputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  editor: z.string().optional(),
  valuePriority: z.string().optional(),
  connectionType: PortConnectionTypeSchema,
});

const ResolvedOutputPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  connectionType: PortConnectionTypeSchema,
});

export const ResolvePortsResponseSchema = z.object({
  inputs: z.array(ResolvedInputPortSchema),
  outputs: z.array(ResolvedOutputPortSchema),
});

export class ResolvePortsResponseDto extends createZodDto(ResolvePortsResponseSchema) {}
