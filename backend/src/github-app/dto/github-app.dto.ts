import { z } from 'zod';

// Installation DTOs
export const GitHubInstallationSchema = z.object({
  id: z.string().uuid(),
  installationId: z.number(),
  accountType: z.enum(['Organization', 'User']),
  accountLogin: z.string(),
  accountId: z.number(),
  accountAvatarUrl: z.string().nullable(),
  repositorySelection: z.enum(['all', 'selected']).nullable(),
  isActive: z.boolean(),
  organizationId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GitHubInstallation = z.infer<typeof GitHubInstallationSchema>;

// Repository DTOs
export const GitHubRepoSchema = z.object({
  id: z.string().uuid(),
  installationId: z.string().uuid(),
  repoId: z.number(),
  fullName: z.string(),
  name: z.string(),
  owner: z.string(),
  isPrivate: z.boolean(),
  defaultBranch: z.string().nullable(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  htmlUrl: z.string().nullable(),
  scansEnabled: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;

// Trigger Rule DTOs
export const CreateTriggerRuleSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().optional(),
  repositoryPattern: z.string().min(1).max(255),
  event: z.enum(['pull_request', 'push', 'release', 'repository_added']),
  actions: z.array(z.string()).optional().default([]),
  branches: z.array(z.string()).optional().default([]),
  workflowId: z.string().uuid(),
  postPrComment: z.boolean().optional().default(true),
  createCheckRun: z.boolean().optional().default(true),
  postPrReview: z.boolean().optional().default(false),
  failOn: z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']).optional().default('high'),
  enabled: z.boolean().optional().default(true),
  priority: z.number().optional().default(100),
});

export type CreateTriggerRuleInput = z.infer<typeof CreateTriggerRuleSchema>;

export const UpdateTriggerRuleSchema = CreateTriggerRuleSchema.partial();
export type UpdateTriggerRuleInput = z.infer<typeof UpdateTriggerRuleSchema>;

export const TriggerRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  repositoryPattern: z.string(),
  event: z.string(),
  actions: z.array(z.string()),
  branches: z.array(z.string()),
  workflowId: z.string().uuid(),
  postPrComment: z.boolean(),
  createCheckRun: z.boolean(),
  postPrReview: z.boolean(),
  failOn: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  organizationId: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TriggerRule = z.infer<typeof TriggerRuleSchema>;

// Scan Result DTOs
export const ScanSummarySchema = z.object({
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
});

export type ScanSummary = z.infer<typeof ScanSummarySchema>;

export const ScanFindingSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  file: z.string(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  message: z.string(),
  snippet: z.string().optional(),
  ruleId: z.string().optional(),
  category: z.string().optional(),
});

export type ScanFinding = z.infer<typeof ScanFindingSchema>;

export const GitHubScanResultSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  workflowRunId: z.string(),
  sourceType: z.enum(['pr', 'push', 'manual', 'schedule']),
  triggerType: z.string().nullable(),
  triggerSource: z.string().nullable(),
  triggerLabel: z.string().nullable(),
  scheduleId: z.string().nullable(),
  scheduleName: z.string().nullable(),
  prNumber: z.number().nullable(),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  status: z.enum(['pending', 'running', 'success', 'failure', 'error']),
  summary: ScanSummarySchema,
  findingsCount: z.number(),
  findings: z.array(ScanFindingSchema),
  checkRunId: z.number().nullable(),
  prCommentId: z.number().nullable(),
  prReviewId: z.number().nullable(),
  resultsUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  triggerRuleId: z.string().uuid().nullable(),
  organizationId: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workflowName: z.string().nullable(),
  workflowVersion: z.number().nullable(),
});

export type GitHubScanResult = z.infer<typeof GitHubScanResultSchema>;

// API Request DTOs
export const StartInstallationSchema = z.object({
  /** Optional: redirect URL after installation */
  redirectUri: z.string().url().optional(),
});

export type StartInstallationInput = z.infer<typeof StartInstallationSchema>;

export const CompleteInstallationSchema = z.object({
  installationId: z.number(),
  setupAction: z.enum(['install', 'update', 'request']).optional(),
});

export type CompleteInstallationInput = z.infer<typeof CompleteInstallationSchema>;

export const TriggerScanSchema = z.object({
  workflowId: z.string().uuid(),
  branch: z.string().optional(),
  ref: z.string().optional(),
  prNumber: z.number().optional(),
});

export type TriggerScanInput = z.infer<typeof TriggerScanSchema>;

// GitHub Webhook Event Types
export interface GitHubWebhookEvent {
  action?: string;
  installation?: {
    id: number;
    account: {
      login: string;
      id: number;
      type: string;
      avatar_url?: string;
    };
    repository_selection: 'all' | 'selected';
    permissions: Record<string, string>;
  };
  repositories?: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }[];
  repositories_added?: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }[];
  repositories_removed?: {
    id: number;
    name: string;
    full_name: string;
  }[];
  sender?: {
    login: string;
    id: number;
  };
}

export interface GitHubPullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    state: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    user: {
      login: string;
    };
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    clone_url: string;
    html_url: string;
  };
  installation?: {
    id: number;
  };
}

export interface GitHubPushEvent {
  ref: string;
  before: string;
  after: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    clone_url: string;
    html_url: string;
  };
  pusher: {
    name: string;
  };
  installation?: {
    id: number;
  };
}
