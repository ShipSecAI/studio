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

export const SecurityWikiConfigResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(['local', 'github']),
  repoOwner: z.string().nullable().optional(),
  repoName: z.string(),
  repoUrl: z.string().nullable().optional(),
  localPath: z.string().nullable().optional(),
  defaultBranch: z.string(),
  rootPath: z.string(),
  status: z.string(),
  pathPolicy: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  codeSources: z.array(SecurityWikiCodeSourceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class SecurityWikiConfigResponseDto extends createZodDto(SecurityWikiConfigResponseSchema) {}

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

export const SecurityWikiRunResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  wikiConfigId: z.string(),
  runId: z.string(),
  agentName: z.string(),
  repoSlug: z.string(),
  repoPath: z.string().nullable().optional(),
  repoCommit: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
  wikiBaseCommit: z.string().nullable().optional(),
  outputCommit: z.string().nullable().optional(),
  mergeCommit: z.string().nullable().optional(),
  status: z.string(),
  changedFiles: z.array(z.string()),
  validation: z.record(z.string(), z.unknown()),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});

export class SecurityWikiRunResponseDto extends createZodDto(SecurityWikiRunResponseSchema) {}

export const SecurityWikiTreeNodeSchema: z.ZodType<{
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  updatedAt: string;
  extension?: string;
  children?: any[];
}> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    size: z.number().optional(),
    updatedAt: z.string(),
    extension: z.string().optional(),
    children: z.array(SecurityWikiTreeNodeSchema).optional(),
  }),
);

export const SecurityWikiTreeResponseSchema = z.object({
  configId: z.string(),
  provider: z.enum(['local', 'github']),
  repoName: z.string().nullable().optional(),
  rootPath: z.string(),
  codeSources: z.array(SecurityWikiCodeSourceSchema),
  tree: z.array(SecurityWikiTreeNodeSchema),
});

export class SecurityWikiTreeResponseDto extends createZodDto(SecurityWikiTreeResponseSchema) {}

export const SecurityWikiFileResponseSchema = z.object({
  path: z.string(),
  name: z.string(),
  extension: z.string(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string(),
  content: z.string(),
});

export class SecurityWikiFileResponseDto extends createZodDto(SecurityWikiFileResponseSchema) {}

export const RunCodeWikiIngestionResponseSchema = z.object({
  runId: z.string(),
  status: z.string(),
  workflowRunId: z.string(),
  temporalRunId: z.string().nullable().optional(),
  workflowId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  securityWikiRunId: z.string(),
});

export class RunCodeWikiIngestionResponseDto extends createZodDto(
  RunCodeWikiIngestionResponseSchema,
) {}
