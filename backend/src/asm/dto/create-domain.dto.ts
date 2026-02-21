import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Reject private/reserved IP ranges, localhost, internal hostnames
const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fd/,
  /^fe80:/,
];

const DOMAIN_REGEX = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*\.[a-zA-Z]{2,}$/;

export const CreateDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .max(255, 'Domain must be at most 255 characters')
    .transform((d) => d.toLowerCase().trim().replace(/\.$/, ''))
    .refine((d) => DOMAIN_REGEX.test(d), 'Invalid domain format')
    .refine(
      (d) => !PRIVATE_IP_PATTERNS.some((p) => p.test(d)),
      'Private/reserved IP addresses are not allowed',
    )
    .refine(
      (d) => d !== 'localhost' && !d.endsWith('.local') && !d.endsWith('.internal'),
      'Internal hostnames are not allowed',
    ),
  scopeInclude: z.array(z.string().max(500)).max(100).optional(),
  scopeExclude: z.array(z.string().max(500)).max(100).optional(),
  scanNow: z.boolean().optional().default(false),
});

export class CreateDomainDto extends createZodDto(CreateDomainSchema) {}
