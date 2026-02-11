import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_TOKEN } from '../database/database.module';

import {
  githubAppInstallations,
  githubRepositories,
  githubTriggerRules,
  githubScanResults,
  workflowRunsTable,
  workflowsTable,
  type GitHubAppInstallationRecord,
  type NewGitHubAppInstallationRecord,
  type GitHubRepositoryRecord,
  type NewGitHubRepositoryRecord,
  type GitHubTriggerRuleRecord,
  type NewGitHubTriggerRuleRecord,
  type GitHubScanResultRecord,
  type NewGitHubScanResultRecord,
} from '../database/schema';

export type ScanResultWithWorkflow = GitHubScanResultRecord & {
  workflowName: string | null;
  workflowVersion: number | null;
  triggerType: string | null;
  triggerSource: string | null;
  triggerLabel: string | null;
};

@Injectable()
export class GitHubAppRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  // ============ Installation Methods ============

  async createInstallation(
    data: NewGitHubAppInstallationRecord,
  ): Promise<GitHubAppInstallationRecord> {
    const [record] = await this.db.insert(githubAppInstallations).values(data).returning();
    return record;
  }

  async findInstallationById(id: string): Promise<GitHubAppInstallationRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubAppInstallations)
      .where(eq(githubAppInstallations.id, id))
      .limit(1);
    return record;
  }

  async findInstallationByGitHubId(
    installationId: number,
  ): Promise<GitHubAppInstallationRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubAppInstallations)
      .where(eq(githubAppInstallations.installationId, installationId))
      .limit(1);
    return record;
  }

  async listInstallationsByOrg(organizationId: string): Promise<GitHubAppInstallationRecord[]> {
    return this.db
      .select()
      .from(githubAppInstallations)
      .where(
        and(
          eq(githubAppInstallations.organizationId, organizationId),
          eq(githubAppInstallations.isActive, true),
        ),
      )
      .orderBy(githubAppInstallations.createdAt);
  }

  async updateInstallation(
    id: string,
    data: Partial<NewGitHubAppInstallationRecord>,
  ): Promise<GitHubAppInstallationRecord | undefined> {
    const [record] = await this.db
      .update(githubAppInstallations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(githubAppInstallations.id, id))
      .returning();
    return record;
  }

  async deactivateInstallation(installationId: number): Promise<void> {
    await this.db
      .update(githubAppInstallations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(githubAppInstallations.installationId, installationId));
  }

  async deleteInstallation(id: string): Promise<void> {
    await this.db.delete(githubAppInstallations).where(eq(githubAppInstallations.id, id));
  }

  // ============ Repository Methods ============

  async upsertRepository(data: NewGitHubRepositoryRecord): Promise<GitHubRepositoryRecord> {
    const existing = await this.findRepositoryByGitHubId(data.repoId);
    if (existing) {
      const [updated] = await this.db
        .update(githubRepositories)
        .set({ ...data, updatedAt: new Date(), lastSyncedAt: new Date() })
        .where(eq(githubRepositories.id, existing.id))
        .returning();
      return updated;
    }
    const [record] = await this.db.insert(githubRepositories).values(data).returning();
    return record;
  }

  async findRepositoryById(id: string): Promise<GitHubRepositoryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.id, id))
      .limit(1);
    return record;
  }

  async findRepositoryByGitHubId(repoId: number): Promise<GitHubRepositoryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.repoId, repoId))
      .limit(1);
    return record;
  }

  async findRepositoryByFullName(fullName: string): Promise<GitHubRepositoryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.fullName, fullName))
      .limit(1);
    return record;
  }

  async listRepositoriesByInstallation(installationId: string): Promise<GitHubRepositoryRecord[]> {
    return this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.installationId, installationId))
      .orderBy(githubRepositories.fullName);
  }

  async listRepositoriesByOrg(organizationId: string): Promise<GitHubRepositoryRecord[]> {
    return this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.organizationId, organizationId))
      .orderBy(githubRepositories.fullName);
  }

  async updateRepository(
    id: string,
    data: Partial<NewGitHubRepositoryRecord>,
  ): Promise<GitHubRepositoryRecord | undefined> {
    const [record] = await this.db
      .update(githubRepositories)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(githubRepositories.id, id))
      .returning();
    return record;
  }

  async deleteRepository(id: string): Promise<void> {
    await this.db.delete(githubRepositories).where(eq(githubRepositories.id, id));
  }

  async deleteRepositoriesByGitHubIds(repoIds: number[]): Promise<void> {
    if (repoIds.length === 0) return;
    await this.db.delete(githubRepositories).where(inArray(githubRepositories.repoId, repoIds));
  }

  // ============ Trigger Rule Methods ============

  async createTriggerRule(data: NewGitHubTriggerRuleRecord): Promise<GitHubTriggerRuleRecord> {
    const [record] = await this.db.insert(githubTriggerRules).values(data).returning();
    return record;
  }

  async findTriggerRuleById(id: string): Promise<GitHubTriggerRuleRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubTriggerRules)
      .where(and(eq(githubTriggerRules.id, id), isNull(githubTriggerRules.deletedAt)))
      .limit(1);
    return record;
  }

  async listTriggerRulesByOrg(organizationId: string): Promise<GitHubTriggerRuleRecord[]> {
    return this.db
      .select()
      .from(githubTriggerRules)
      .where(
        and(
          eq(githubTriggerRules.organizationId, organizationId),
          isNull(githubTriggerRules.deletedAt),
        ),
      )
      .orderBy(githubTriggerRules.priority, githubTriggerRules.createdAt);
  }

  async findMatchingTriggerRules(
    organizationId: string,
    event: string,
    repoFullName: string,
  ): Promise<GitHubTriggerRuleRecord[]> {
    // Get all enabled rules for this org and event
    const rules = await this.db
      .select()
      .from(githubTriggerRules)
      .where(
        and(
          eq(githubTriggerRules.organizationId, organizationId),
          eq(githubTriggerRules.event, event),
          eq(githubTriggerRules.enabled, true),
          isNull(githubTriggerRules.deletedAt),
        ),
      )
      .orderBy(githubTriggerRules.priority);

    // Filter by repository pattern
    return rules.filter((rule) => this.matchesRepoPattern(rule.repositoryPattern, repoFullName));
  }

  private matchesRepoPattern(pattern: string, repoFullName: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('/*')) {
      const orgPrefix = pattern.slice(0, -2);
      return repoFullName.startsWith(orgPrefix + '/');
    }
    return pattern === repoFullName;
  }

  async updateTriggerRule(
    id: string,
    data: Partial<NewGitHubTriggerRuleRecord>,
  ): Promise<GitHubTriggerRuleRecord | undefined> {
    const [record] = await this.db
      .update(githubTriggerRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(githubTriggerRules.id, id))
      .returning();
    return record;
  }

  async deleteTriggerRule(id: string): Promise<void> {
    await this.db
      .update(githubTriggerRules)
      .set({
        enabled: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(githubTriggerRules.id, id));
  }

  // ============ Scan Result Methods ============

  async createScanResult(data: NewGitHubScanResultRecord): Promise<GitHubScanResultRecord> {
    const [record] = await this.db.insert(githubScanResults).values(data).returning();
    return record;
  }

  async findScanResultById(id: string): Promise<ScanResultWithWorkflow | undefined> {
    const [row] = await this.db
      .select({
        scan: githubScanResults,
        workflowName: workflowsTable.name,
        workflowVersion: workflowRunsTable.workflowVersion,
        triggerType: workflowRunsTable.triggerType,
        triggerSource: workflowRunsTable.triggerSource,
        triggerLabel: workflowRunsTable.triggerLabel,
      })
      .from(githubScanResults)
      .leftJoin(workflowRunsTable, eq(githubScanResults.workflowRunId, workflowRunsTable.runId))
      .leftJoin(workflowsTable, eq(workflowRunsTable.workflowId, workflowsTable.id))
      .where(eq(githubScanResults.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.scan,
      workflowName: row.workflowName,
      workflowVersion: row.workflowVersion,
      triggerType: row.triggerType ?? null,
      triggerSource: row.triggerSource ?? null,
      triggerLabel: row.triggerLabel ?? null,
    };
  }

  async findScanResultByWorkflowRun(
    workflowRunId: string,
  ): Promise<GitHubScanResultRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubScanResults)
      .where(eq(githubScanResults.workflowRunId, workflowRunId))
      .limit(1);
    return record;
  }

  async listScanResultsByRepo(
    repositoryId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ScanResultWithWorkflow[]> {
    let query = this.db
      .select({
        scan: githubScanResults,
        workflowName: workflowsTable.name,
        workflowVersion: workflowRunsTable.workflowVersion,
        triggerType: workflowRunsTable.triggerType,
        triggerSource: workflowRunsTable.triggerSource,
        triggerLabel: workflowRunsTable.triggerLabel,
      })
      .from(githubScanResults)
      .leftJoin(workflowRunsTable, eq(githubScanResults.workflowRunId, workflowRunsTable.runId))
      .leftJoin(workflowsTable, eq(workflowRunsTable.workflowId, workflowsTable.id))
      .where(eq(githubScanResults.repositoryId, repositoryId))
      .orderBy(desc(githubScanResults.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => ({
      ...r.scan,
      workflowName: r.workflowName,
      workflowVersion: r.workflowVersion,
      triggerType: r.triggerType ?? null,
      triggerSource: r.triggerSource ?? null,
      triggerLabel: r.triggerLabel ?? null,
    }));
  }

  async listScanResultsByOrg(
    organizationId: string,
    options?: {
      repositoryId?: string;
      limit?: number;
      offset?: number;
      statuses?: string[];
      source?: 'pr' | 'push' | 'manual' | 'schedule';
      scheduleId?: string;
      triggerRuleId?: string;
    },
  ): Promise<ScanResultWithWorkflow[]> {
    const conditions: SQL[] = [eq(githubScanResults.organizationId, organizationId)];

    if (options?.repositoryId) {
      conditions.push(eq(githubScanResults.repositoryId, options.repositoryId));
    }

    if (options?.statuses && options.statuses.length > 0) {
      conditions.push(inArray(githubScanResults.status, options.statuses));
    }

    if (options?.source) {
      if (options.source === 'schedule') {
        conditions.push(
          or(
            eq(githubScanResults.sourceType, 'schedule'),
            eq(workflowRunsTable.triggerType, 'schedule'),
          )!,
        );
      } else {
        conditions.push(eq(githubScanResults.sourceType, options.source));
      }
    }

    if (options?.scheduleId) {
      conditions.push(
        and(
          eq(workflowRunsTable.triggerType, 'schedule'),
          eq(workflowRunsTable.triggerSource, options.scheduleId),
        )!,
      );
    }

    if (options?.triggerRuleId) {
      conditions.push(eq(githubScanResults.triggerRuleId, options.triggerRuleId));
    }

    let query = this.db
      .select({
        scan: githubScanResults,
        workflowName: workflowsTable.name,
        workflowVersion: workflowRunsTable.workflowVersion,
        triggerType: workflowRunsTable.triggerType,
        triggerSource: workflowRunsTable.triggerSource,
        triggerLabel: workflowRunsTable.triggerLabel,
      })
      .from(githubScanResults)
      .leftJoin(workflowRunsTable, eq(githubScanResults.workflowRunId, workflowRunsTable.runId))
      .leftJoin(workflowsTable, eq(workflowRunsTable.workflowId, workflowsTable.id))
      .where(and(...conditions))
      .orderBy(desc(githubScanResults.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => ({
      ...r.scan,
      workflowName: r.workflowName,
      workflowVersion: r.workflowVersion,
      triggerType: r.triggerType ?? null,
      triggerSource: r.triggerSource ?? null,
      triggerLabel: r.triggerLabel ?? null,
    }));
  }

  async updateScanResult(
    id: string,
    data: Partial<NewGitHubScanResultRecord>,
  ): Promise<GitHubScanResultRecord | undefined> {
    const [record] = await this.db
      .update(githubScanResults)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(githubScanResults.id, id))
      .returning();
    return record;
  }

  async findLatestScanResultCommentForRule(
    repositoryId: string,
    prNumber: number,
    triggerRuleId: string,
  ): Promise<GitHubScanResultRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(githubScanResults)
      .where(
        and(
          eq(githubScanResults.repositoryId, repositoryId),
          eq(githubScanResults.prNumber, prNumber),
          eq(githubScanResults.triggerRuleId, triggerRuleId),
          isNotNull(githubScanResults.prCommentId),
        ),
      )
      .orderBy(desc(githubScanResults.createdAt))
      .limit(1);
    return record;
  }

  async findRunningScanResults(limit = 50): Promise<GitHubScanResultRecord[]> {
    return this.db
      .select()
      .from(githubScanResults)
      .where(eq(githubScanResults.status, 'running'))
      .limit(limit);
  }
}
