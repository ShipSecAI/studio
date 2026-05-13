import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import type { AuthContext } from '../auth/types';
import { SystemWorkflowsService } from '../workflows/system-workflows.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type { RunCodeWikiIngestionDto, UpsertSecurityWikiConfigDto } from './dto';
import {
  GITHUB_BACKED_WIKI_CHECKOUT_CONTRACT,
  asSecurityWikiRecord,
  extractSecurityWikiRunResult,
  normalizeSecurityWikiCodeSources,
} from './security-wiki.metadata';
import type { SecurityWikiRunResultProjection } from './security-wiki.metadata';

const CODE_WIKI_TEMPLATE_SLUG = 'sys-code-wiki-ingestion';
const WIKI_CONTEXT_COMPONENT_ID = 'security.wiki.context';
const CODE_WIKI_COMPONENT_ID = 'core.ai.codex';
const RUN_STATUSES_TO_RECONCILE = new Set([
  'workflow_started',
  'queued',
  'running',
  'awaiting_input',
  'QUEUED',
  'RUNNING',
  'AWAITING_INPUT',
]);
const TERMINAL_WORKFLOW_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
]);

export interface WikiTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  updatedAt: string;
  extension?: string;
  children?: WikiTreeNode[];
}

@Injectable()
export class SecurityWikisService {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly systemWorkflowsService: SystemWorkflowsService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async getActiveConfig(auth: AuthContext) {
    const orgId = this.requireOrg(auth);
    const [config] = await this.db
      .select()
      .from(schema.securityWikiConfigs)
      .where(
        and(
          eq(schema.securityWikiConfigs.organizationId, orgId),
          eq(schema.securityWikiConfigs.status, 'active'),
        ),
      )
      .limit(1);
    if (!config) {
      throw new NotFoundException('No active security wiki is configured for this organization');
    }
    return this.toConfigDto(config);
  }

  async upsertConfig(auth: AuthContext, dto: UpsertSecurityWikiConfigDto) {
    this.requireAdmin(auth);
    const orgId = this.requireOrg(auth);
    if (dto.provider === 'local' && !dto.localPath) {
      throw new BadRequestException('localPath is required for local security wiki provider');
    }
    if (dto.provider === 'github' && !dto.repoUrl) {
      throw new BadRequestException('repoUrl is required for github security wiki provider');
    }

    const existing = await this.db
      .select()
      .from(schema.securityWikiConfigs)
      .where(
        and(
          eq(schema.securityWikiConfigs.organizationId, orgId),
          eq(schema.securityWikiConfigs.status, 'active'),
        ),
      )
      .limit(1);

    const values = {
      organizationId: orgId,
      provider: dto.provider,
      repoOwner: dto.repoOwner ?? null,
      repoName: dto.repoName,
      repoUrl: dto.repoUrl ?? null,
      localPath: dto.localPath ?? null,
      defaultBranch: dto.defaultBranch,
      rootPath: dto.rootPath,
      pathPolicy: dto.pathPolicy,
      metadata: this.buildConfigMetadata(dto.provider, dto.metadata, dto.codeSources),
      status: 'active',
      updatedAt: new Date(),
    };

    if (existing[0]) {
      const [updated] = await this.db
        .update(schema.securityWikiConfigs)
        .set(values)
        .where(eq(schema.securityWikiConfigs.id, existing[0].id))
        .returning();
      return this.toConfigDto(updated);
    }

    const [created] = await this.db.insert(schema.securityWikiConfigs).values(values).returning();
    return this.toConfigDto(created);
  }

  async listRuns(auth: AuthContext) {
    const orgId = this.requireOrg(auth);
    const runs = await this.db
      .select()
      .from(schema.securityWikiRuns)
      .where(eq(schema.securityWikiRuns.organizationId, orgId))
      .orderBy(desc(schema.securityWikiRuns.createdAt))
      .limit(50);

    return Promise.all(runs.map((run) => this.reconcileRunIfNeeded(auth, run)));
  }

  async getTree(auth: AuthContext) {
    const config = await this.getActiveConfig(auth);
    const root = this.resolveReadableWikiRoot(config);
    return {
      configId: config.id,
      provider: config.provider,
      repoName: config.repoName,
      rootPath: config.rootPath,
      codeSources: this.extractConfigCodeSources(config.metadata),
      tree: await this.readWikiDirectory(root, ''),
    };
  }

  async getFile(auth: AuthContext, requestedPath: string) {
    const config = await this.getActiveConfig(auth);
    const root = this.resolveReadableWikiRoot(config);
    const relativePath = this.normalizeWikiRelativePath(requestedPath);
    const absolutePath = this.resolveWikiPath(root, relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundException('Wiki file not found');
    if (stat.size > 512 * 1024) {
      throw new BadRequestException('Wiki file is too large to render in the browser');
    }
    const content = await fs.readFile(absolutePath, 'utf8');
    return {
      path: relativePath,
      name: path.basename(relativePath),
      extension: path.extname(relativePath).slice(1).toLowerCase(),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      content,
    };
  }

  /**
   * CODE ingestion is a system ShipSec workflow, not a bespoke backend runner.
   * This method only resolves config and starts the system workflow with inputs
   * for the Codex Docker component. The worker component owns repo/wiki mounts,
   * validation, commit, and merge as workflow execution work.
   */
  async runCodeWikiIngestion(auth: AuthContext, dto: RunCodeWikiIngestionDto) {
    this.requireAdmin(auth);
    const orgId = this.requireOrg(auth);
    const config = await this.getActiveConfig(auth);
    if (config.provider !== 'local' || !config.localPath) {
      throw new BadRequestException(
        'CODE wiki ingestion workflow currently requires a local security wiki path. GitHub App-backed wiki checkout will be added through workflow credentials.',
      );
    }

    const systemWorkflows = await this.systemWorkflowsService.ensureSystemWorkflows(orgId);
    const codeWikiWorkflow = systemWorkflows.find(
      (workflow) => workflow.slug === CODE_WIKI_TEMPLATE_SLUG,
    );
    if (!codeWikiWorkflow) {
      throw new NotFoundException(`System workflow template not found: ${CODE_WIKI_TEMPLATE_SLUG}`);
    }

    const runId = dto.runId ?? `code-wiki-${Date.now()}`;
    const handle = await this.workflowsService.run(codeWikiWorkflow.id, {}, auth, {
      runId,
      trigger: {
        type: 'api',
        sourceId: 'security-wikis',
        label: 'CODE wiki ingestion',
      },
      componentInputs: {
        [CODE_WIKI_COMPONENT_ID]: {
          ...(dto.promptText ? { promptText: dto.promptText } : {}),
        },
      },
      componentParams: {
        [WIKI_CONTEXT_COMPONENT_ID]: {
          agentName: dto.agentName,
          wikiId: config.id,
          wikiPath: config.localPath,
          wikiAccess: 'write',
          repoPath: dto.repoPath,
          repoSlug: dto.repoSlug,
          runId,
        },
        [CODE_WIKI_COMPONENT_ID]: {
          model: dto.model,
          ...(dto.codexHome ? { codexHome: dto.codexHome } : {}),
        },
      },
    });

    const [runRecord] = await this.db
      .insert(schema.securityWikiRuns)
      .values({
        organizationId: orgId,
        wikiConfigId: config.id,
        runId,
        agentName: dto.agentName,
        repoSlug: dto.repoSlug,
        repoPath: dto.repoPath,
        model: dto.model,
        status: 'workflow_started',
        startedAt: new Date(),
        validation: {
          workflowRunId: handle.runId,
          temporalRunId: handle.temporalRunId,
          workflowId: handle.workflowId,
          workflowVersionId: handle.workflowVersionId,
        },
      })
      .returning();

    return {
      runId,
      status: 'workflow_started',
      workflowRunId: handle.runId,
      temporalRunId: handle.temporalRunId,
      workflowId: handle.workflowId,
      workflowVersionId: handle.workflowVersionId,
      securityWikiRunId: runRecord.id,
    };
  }

  private toConfigDto(config: typeof schema.securityWikiConfigs.$inferSelect) {
    const metadata = this.buildConfigMetadata(config.provider, config.metadata);
    return {
      ...config,
      metadata,
      codeSources: this.extractConfigCodeSources(metadata),
    };
  }

  private buildConfigMetadata(
    provider: string,
    metadata: Record<string, unknown> | null | undefined,
    codeSources?: unknown,
  ): Record<string, unknown> {
    const next = { ...(metadata ?? {}) };
    const metadataRecord = asSecurityWikiRecord(metadata);
    next.codeSources = normalizeSecurityWikiCodeSources(codeSources ?? metadataRecord?.codeSources);

    if (provider === 'github') {
      next.githubBackedCheckout = GITHUB_BACKED_WIKI_CHECKOUT_CONTRACT;
    } else if (next.githubBackedCheckout) {
      delete next.githubBackedCheckout;
    }

    return next;
  }

  private extractConfigCodeSources(metadata: unknown) {
    return normalizeSecurityWikiCodeSources(asSecurityWikiRecord(metadata)?.codeSources);
  }

  private async reconcileRunIfNeeded(
    auth: AuthContext,
    run: typeof schema.securityWikiRuns.$inferSelect,
  ) {
    if (!RUN_STATUSES_TO_RECONCILE.has(run.status)) return run;

    const workflowRunId = this.extractWorkflowRunId(run) ?? run.runId;
    const temporalRunId = this.extractTemporalRunId(run) ?? undefined;
    let statusPayload: Awaited<ReturnType<WorkflowsService['getRunStatus']>>;
    try {
      statusPayload = await this.workflowsService.getRunStatus(workflowRunId, temporalRunId, auth);
    } catch (_error) {
      return run;
    }

    const workflowStatus = statusPayload.status;
    if (!TERMINAL_WORKFLOW_STATUSES.has(workflowStatus)) {
      const runningStatus = workflowStatus.toLowerCase();
      if (run.status === runningStatus) return run;
      const [updated] = await this.db
        .update(schema.securityWikiRuns)
        .set({ status: runningStatus })
        .where(eq(schema.securityWikiRuns.id, run.id))
        .returning();
      return updated ?? run;
    }

    let projection: SecurityWikiRunResultProjection = {};
    try {
      projection = extractSecurityWikiRunResult(
        await this.workflowsService.getRunResult(workflowRunId, temporalRunId, auth),
      );
    } catch (error) {
      projection.error = workflowStatus === 'COMPLETED' ? this.errorMessage(error) : undefined;
    }

    const terminalError = projection.error ?? this.workflowFailureMessage(statusPayload);
    const validation = {
      ...((run.validation ?? {}) as Record<string, unknown>),
      workflowStatus,
      ...(projection.validation ? { result: projection.validation } : {}),
    };
    const completedAt = statusPayload.completedAt
      ? new Date(statusPayload.completedAt)
      : new Date();

    const updates: Partial<typeof schema.securityWikiRuns.$inferInsert> = {
      status: workflowStatus.toLowerCase(),
      validation,
      completedAt,
      error: terminalError ?? null,
    };
    if (projection.changedFiles !== undefined) updates.changedFiles = projection.changedFiles;
    if (projection.outputCommit !== undefined) updates.outputCommit = projection.outputCommit;
    if (projection.mergeCommit !== undefined) updates.mergeCommit = projection.mergeCommit;
    if (projection.wikiBaseCommit !== undefined) {
      updates.wikiBaseCommit = projection.wikiBaseCommit;
    }
    if (projection.repoCommit !== undefined) updates.repoCommit = projection.repoCommit;
    if (projection.branchName !== undefined) updates.branchName = projection.branchName;

    const [updated] = await this.db
      .update(schema.securityWikiRuns)
      .set(updates)
      .where(eq(schema.securityWikiRuns.id, run.id))
      .returning();
    return updated ?? run;
  }

  private extractWorkflowRunId(run: typeof schema.securityWikiRuns.$inferSelect) {
    const validation = asSecurityWikiRecord(run.validation);
    return typeof validation?.workflowRunId === 'string' ? validation.workflowRunId : null;
  }

  private extractTemporalRunId(run: typeof schema.securityWikiRuns.$inferSelect) {
    const validation = asSecurityWikiRecord(run.validation);
    return typeof validation?.temporalRunId === 'string' ? validation.temporalRunId : null;
  }

  private workflowFailureMessage(
    statusPayload: Awaited<ReturnType<WorkflowsService['getRunStatus']>>,
  ) {
    const failure = asSecurityWikiRecord(statusPayload.failure);
    const message = failure?.message ?? failure?.reason;
    if (typeof message === 'string') return message;
    return statusPayload.status === 'COMPLETED'
      ? null
      : `Workflow ended with status ${statusPayload.status}`;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private resolveReadableWikiRoot(config: typeof schema.securityWikiConfigs.$inferSelect) {
    if (config.provider !== 'local' || !config.localPath) {
      throw new BadRequestException(
        'Wiki browsing currently requires a local security wiki path. GitHub App-backed wiki browsing will use a managed checkout.',
      );
    }
    const rootPath = config.rootPath && config.rootPath !== '/' ? config.rootPath : '';
    return path.resolve(config.localPath, rootPath);
  }

  private normalizeWikiRelativePath(requestedPath: string) {
    const normalized = path.posix.normalize((requestedPath || '').replace(/\\/g, '/'));
    if (!normalized || normalized === '.') return '';
    if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) {
      throw new BadRequestException('Invalid wiki path');
    }
    return normalized.replace(/^\/+/, '');
  }

  private resolveWikiPath(root: string, relativePath: string) {
    const absolute = path.resolve(root, relativePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Invalid wiki path');
    }
    return absolute;
  }

  private async readWikiDirectory(root: string, relativePath: string): Promise<WikiTreeNode[]> {
    const absolute = this.resolveWikiPath(root, relativePath);
    const entries = await fs
      .readdir(absolute, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new NotFoundException('Security wiki path not found');
        throw error;
      });

    const visibleEntries = entries
      .filter((entry) => !entry.name.startsWith('.git'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const children: WikiTreeNode[] = await Promise.all(
      visibleEntries.map(async (entry) => {
        const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const childAbsolute = this.resolveWikiPath(root, childPath);
        const stat = await fs.stat(childAbsolute);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: childPath,
            type: 'directory' as const,
            updatedAt: stat.mtime.toISOString(),
            children: await this.readWikiDirectory(root, childPath),
          };
        }
        return {
          name: entry.name,
          path: childPath,
          type: 'file' as const,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          extension: path.extname(entry.name).slice(1).toLowerCase(),
        };
      }),
    );

    return children;
  }

  private requireOrg(auth: AuthContext) {
    if (!auth?.organizationId) throw new ForbiddenException('Organization context is required');
    return auth.organizationId;
  }

  private requireAdmin(auth: AuthContext) {
    if (!auth?.roles?.includes('ADMIN')) throw new ForbiddenException('Admin role is required');
  }
}
