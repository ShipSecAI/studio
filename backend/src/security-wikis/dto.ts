import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SecurityWikiCodeSourceSchema = z.object({
  repoId: z.union([z.string().min(1), z.number()]).transform((value) => String(value)),
  fullName: z.string().min(1),
  repoOwner: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
  cadence: z.enum(['manual', 'nightly', 'weekly']).default('manual'),
  addedAt: z.string().min(1).optional(),
});

export type SecurityWikiCodeSourceDto = z.infer<typeof SecurityWikiCodeSourceSchema>;

export const UpsertSecurityWikiConfigSchema = z.object({
  provider: z.enum(['local', 'github']).default('local'),
  repoOwner: z.string().min(1).optional(),
  repoName: z.string().min(1),
  repoUrl: z.string().url().optional(),
  localPath: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).default('main'),
  rootPath: z.string().min(1).default('/'),
  pathPolicy: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  codeSources: z.array(SecurityWikiCodeSourceSchema).optional(),
});

export class UpsertSecurityWikiConfigDto extends createZodDto(UpsertSecurityWikiConfigSchema) {}

export const RunCodeWikiIngestionSchema = z.object({
  repoPath: z.string().min(1),
  repoSlug: z.string().min(1),
  runId: z.string().min(1).optional(),
  agentName: z.string().min(1).default('code-explorer-agent'),
  model: z.string().min(1).default('gpt-5.5'),
  promptText: z.string().min(1).optional(),
  codexHome: z.string().min(1).optional(),
});

export class RunCodeWikiIngestionDto extends createZodDto(RunCodeWikiIngestionSchema) {}
