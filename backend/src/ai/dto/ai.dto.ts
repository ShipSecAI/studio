import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GenerateAiSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    messages: z.array(z.unknown()).optional(),
    systemPrompt: z.string().optional(),
    model: z.string().optional(),
    context: z.enum(['template', 'agent', 'report', 'general']).optional(),
  })
  .refine((data) => Boolean(data.prompt || (data.messages && data.messages.length > 0)), {
    message: 'prompt or messages are required',
  });

export class GenerateAiDto extends createZodDto(GenerateAiSchema) {}
