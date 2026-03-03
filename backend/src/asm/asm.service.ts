import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { asmDomains, asmAssets } from '../database/schema/asm';
import { workflowRunsTable } from '../database/schema/workflow-runs';
import { eq, and, isNull, desc, asc, ilike, count, sql, inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/types';
import { WorkflowsService } from '../workflows/workflows.service';
import { SystemWorkflowsService } from '../workflows/system-workflows.service';
import { WorkflowTemplatesService } from '../workflow-templates/workflow-templates.service';

const MAX_DOMAINS_PER_ORG = 50;
const MAX_SCANS_PER_DOMAIN_PER_HOUR = 5;

// In-memory rate limit tracker (per-process; fine for dev, use Redis in production)
const scanRateMap = new Map<string, number[]>();

@Injectable()
export class AsmService {
  private readonly logger = new Logger(AsmService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly workflowsService: WorkflowsService,
    private readonly systemWorkflowsService: SystemWorkflowsService,
    private readonly workflowTemplatesService: WorkflowTemplatesService,
  ) {}

  private requireOrganizationId(auth: AuthContext | null): string {
    const orgId = auth?.organizationId;
    if (!orgId) throw new BadRequestException('Organization context required');
    return orgId;
  }

  // ── Domain CRUD ────────────────────────────────────────────────────────────

  async listDomains(auth: AuthContext, options: { limit?: number; offset?: number } = {}) {
    const organizationId = this.requireOrganizationId(auth);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const domains = await this.db
      .select()
      .from(asmDomains)
      .where(and(eq(asmDomains.organizationId, organizationId), isNull(asmDomains.deletedAt)))
      .orderBy(desc(asmDomains.createdAt))
      .limit(limit)
      .offset(offset);

    // Compute lastScanAt from completed ASM workflow runs (covers both manual & scheduled scans)
    const lastScanByDomain = await this.computeLastScanTimes(auth, organizationId, domains);

    // Aggregate stats per domain in a single batched query
    const domainIds = domains.map((d) => d.id);
    const statsMap = new Map<string, { assetCount: number; techStack: string[] }>();

    if (domainIds.length > 0) {
      const statsRows = await this.db.execute(sql`
        SELECT
          domain_id,
          COUNT(*)::int AS asset_count,
          COALESCE(
            ARRAY(SELECT DISTINCT unnest FROM unnest(array_agg(DISTINCT t.tech)) AS unnest WHERE unnest IS NOT NULL),
            '{}'
          ) AS techs
        FROM asm_assets a
        LEFT JOIN LATERAL unnest(a.tech_stack) AS t(tech) ON true
        WHERE a.domain_id = ANY(${domainIds})
        GROUP BY domain_id
      `);

      for (const row of statsRows.rows as {
        domain_id: string;
        asset_count: number;
        techs: string[];
      }[]) {
        statsMap.set(row.domain_id, {
          assetCount: row.asset_count,
          techStack: row.techs ?? [],
        });
      }
    }

    return domains.map((domain) => {
      const stats = statsMap.get(domain.id);
      return {
        ...domain,
        lastScanAt: lastScanByDomain.get(domain.domain) ?? domain.lastScanAt,
        assetCount: stats?.assetCount ?? 0,
        techStack: stats?.techStack ?? [],
      };
    });
  }

  /**
   * Compute the most recent completed scan time for each domain by querying workflow_runs.
   * Considers both per-domain manual scans (triggerSource = 'asm:{domain}') and
   * org-wide scheduled scans (any completed ASM workflow run).
   */
  private async computeLastScanTimes(
    auth: AuthContext,
    organizationId: string,
    domains: { domain: string }[],
  ): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    if (domains.length === 0) return result;

    const asmWorkflowIds = await this.resolveAsmWorkflowIds(auth);
    if (asmWorkflowIds.length === 0) return result;

    // Latest completed ASM run for the org (covers scheduled multi-domain scans)
    const [orgLatest] = await this.db
      .select({
        lastScan: sql<Date>`MAX(COALESCE(${workflowRunsTable.closeTime}, ${workflowRunsTable.createdAt}))`,
      })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.organizationId, organizationId),
          inArray(workflowRunsTable.workflowId, asmWorkflowIds),
          eq(workflowRunsTable.status, 'COMPLETED'),
        ),
      );
    const orgLastScan = orgLatest?.lastScan ? new Date(orgLatest.lastScan) : null;

    // Per-domain manual scan times (triggerSource = 'asm:{domain}')
    const domainNames = domains.map((d) => d.domain);
    const perDomainResults = await this.db
      .select({
        triggerSource: workflowRunsTable.triggerSource,
        lastScan: sql<Date>`MAX(COALESCE(${workflowRunsTable.closeTime}, ${workflowRunsTable.createdAt}))`,
      })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.organizationId, organizationId),
          inArray(
            workflowRunsTable.triggerSource,
            domainNames.map((d) => `asm:${d}`),
          ),
          eq(workflowRunsTable.status, 'COMPLETED'),
        ),
      )
      .groupBy(workflowRunsTable.triggerSource);

    const perDomainMap = new Map<string, Date>();
    for (const row of perDomainResults) {
      if (row.triggerSource && row.lastScan) {
        const domainName = row.triggerSource.replace(/^asm:/, '');
        perDomainMap.set(domainName, new Date(row.lastScan));
      }
    }

    // For each domain, take the most recent of org-wide and per-domain scans
    for (const domain of domains) {
      const candidates: Date[] = [];
      if (orgLastScan) candidates.push(orgLastScan);
      const perDomain = perDomainMap.get(domain.domain);
      if (perDomain) candidates.push(perDomain);

      if (candidates.length > 0) {
        result.set(domain.domain, new Date(Math.max(...candidates.map((d) => d.getTime()))));
      }
    }

    return result;
  }

  /**
   * Resolve workflow IDs for ASM-related workflow templates.
   */
  private async resolveAsmWorkflowIds(auth: AuthContext): Promise<string[]> {
    const templates = await this.workflowTemplatesService.list();
    const asmTemplateSlugs = new Set([
      'sys-attack-surface-recon',
      'sys-quick-recon',
      'sys-port-scan',
      'sys-vuln-scan',
    ]);
    const asmTemplateIds = templates
      .filter((t) => t.slug && asmTemplateSlugs.has(t.slug))
      .map((t) => t.id);

    const workflows = await this.workflowsService.list(auth);
    return workflows
      .filter((w: any) => {
        if (asmTemplateIds.includes(w.templateId)) return true;
        if (w.slug && asmTemplateSlugs.has(w.slug)) return true;
        return false;
      })
      .map((w: any) => w.id);
  }

  async getDomain(auth: AuthContext, id: string) {
    const organizationId = this.requireOrganizationId(auth);

    const [domain] = await this.db
      .select()
      .from(asmDomains)
      .where(
        and(
          eq(asmDomains.id, id),
          eq(asmDomains.organizationId, organizationId),
          isNull(asmDomains.deletedAt),
        ),
      );

    if (!domain) throw new NotFoundException(`Domain ${id} not found`);
    return domain;
  }

  async createDomain(
    auth: AuthContext,
    dto: {
      domain: string;
      scopeInclude?: string[];
      scopeExclude?: string[];
      scanNow?: boolean;
    },
  ) {
    const organizationId = this.requireOrganizationId(auth);

    // Check org domain limit
    const [{ count: domainCount }] = await this.db
      .select({ count: count() })
      .from(asmDomains)
      .where(and(eq(asmDomains.organizationId, organizationId), isNull(asmDomains.deletedAt)));

    if (domainCount >= MAX_DOMAINS_PER_ORG) {
      throw new BadRequestException(
        `Maximum of ${MAX_DOMAINS_PER_ORG} domains per organization reached`,
      );
    }

    // Check for duplicate (partial unique index handles DB level, but give nice error)
    const [existing] = await this.db
      .select()
      .from(asmDomains)
      .where(
        and(
          eq(asmDomains.organizationId, organizationId),
          eq(asmDomains.domain, dto.domain),
          isNull(asmDomains.deletedAt),
        ),
      );

    if (existing) {
      throw new ConflictException(`Domain ${dto.domain} already exists`);
    }

    const [domain] = await this.db
      .insert(asmDomains)
      .values({
        organizationId,
        domain: dto.domain,
        scopeInclude: dto.scopeInclude ?? null,
        scopeExclude: dto.scopeExclude ?? null,
      })
      .returning();

    this.logger.log(`Created domain ${domain.domain} for org ${organizationId}`);

    // Optionally trigger scan
    if (dto.scanNow) {
      try {
        const scanResult = await this.triggerDomainScan(auth, domain.id);
        return { ...domain, assetCount: 0, scanTriggered: true, runId: scanResult.runId };
      } catch (error) {
        this.logger.warn(`Failed to auto-trigger scan for ${domain.domain}: ${error}`);
        return { ...domain, assetCount: 0, scanTriggered: false };
      }
    }

    return { ...domain, assetCount: 0 };
  }

  async updateDomain(
    auth: AuthContext,
    id: string,
    dto: { scopeInclude?: string[]; scopeExclude?: string[] },
  ) {
    const organizationId = this.requireOrganizationId(auth);

    const [updated] = await this.db
      .update(asmDomains)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(asmDomains.id, id),
          eq(asmDomains.organizationId, organizationId),
          isNull(asmDomains.deletedAt),
        ),
      )
      .returning();

    if (!updated) throw new NotFoundException(`Domain ${id} not found`);
    return updated;
  }

  async deleteDomain(auth: AuthContext, id: string) {
    const organizationId = this.requireOrganizationId(auth);

    const [deleted] = await this.db
      .update(asmDomains)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(asmDomains.id, id),
          eq(asmDomains.organizationId, organizationId),
          isNull(asmDomains.deletedAt),
        ),
      )
      .returning();

    if (!deleted) throw new NotFoundException(`Domain ${id} not found`);
    this.logger.log(`Soft-deleted domain ${deleted.domain} for org ${organizationId}`);
    return { success: true };
  }

  // ── Scan Trigger ───────────────────────────────────────────────────────────

  async triggerDomainScan(auth: AuthContext, domainId: string, templateSlug?: string) {
    const domain = await this.getDomain(auth, domainId);
    const slug = templateSlug || 'sys-attack-surface-recon';

    // Rate limiting
    this.checkScanRateLimit(domainId);

    // Find the system workflow for this template
    const workflowId = await this.resolveWorkflowIdForTemplate(slug, auth);

    // Trigger the workflow run with domain as componentParams
    const runHandle = await this.workflowsService.run(
      workflowId,
      { inputs: { domain: domain.domain } },
      auth,
      {
        trigger: {
          type: 'manual',
          sourceId: `asm:${domain.domain}`,
          label: `ASM Scan: ${domain.domain}`,
        },
        componentParams: {
          'shipsec.subfinder.run': {
            domain: domain.domain,
          },
        },
      },
    );

    this.logger.log(
      `Triggered ASM scan for ${domain.domain} (runId: ${runHandle.runId}, template: ${slug})`,
    );

    return { runId: runHandle.runId, domain: domain.domain };
  }

  private checkScanRateLimit(domainId: string) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const timestamps = (scanRateMap.get(domainId) ?? []).filter((t) => t > oneHourAgo);

    if (timestamps.length >= MAX_SCANS_PER_DOMAIN_PER_HOUR) {
      throw new BadRequestException(
        `Rate limit exceeded: max ${MAX_SCANS_PER_DOMAIN_PER_HOUR} scans per domain per hour`,
      );
    }

    timestamps.push(now);
    scanRateMap.set(domainId, timestamps);
  }

  private async resolveWorkflowIdForTemplate(
    templateSlug: string,
    auth: AuthContext,
  ): Promise<string> {
    // Get all templates and find the one matching the slug
    const templates = await this.workflowTemplatesService.list();
    const template = templates.find((t) => t.slug === templateSlug);

    if (!template) {
      throw new NotFoundException(`Template ${templateSlug} not found`);
    }

    // Ensure system workflows exist for this org, then select by templateId only.
    // Using slug-based matching here can pick stale/legacy workflows that no
    // longer match the template graph and fail compile-time validation.
    const organizationId = this.requireOrganizationId(auth);
    const systemWorkflows = await this.systemWorkflowsService.ensureSystemWorkflows(organizationId);
    const systemWorkflow = systemWorkflows.find((w) => w.templateId === template.id);

    if (systemWorkflow) {
      return systemWorkflow.id;
    }

    // If no workflow exists for this template, instantiate one
    this.logger.log(
      `Instantiating workflow from template ${templateSlug} for org ${organizationId}`,
    );
    const graph = template.graph as {
      nodes: unknown[];
      edges: unknown[];
      name?: string;
      description?: string;
    };

    const workflowGraph = {
      ...graph,
      name: template.name,
      description: template.description ?? graph.description ?? '',
    };

    const workflow = await this.workflowsService.create(workflowGraph as any, auth);
    return workflow.id;
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  async listAssets(
    auth: AuthContext,
    options: {
      limit?: number;
      offset?: number;
      domainId?: string;
      type?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    const organizationId = this.requireOrganizationId(auth);
    const limit = options.limit ?? 25;
    const offset = options.offset ?? 0;

    const conditions = [eq(asmAssets.organizationId, organizationId)];

    if (options.domainId) {
      conditions.push(eq(asmAssets.domainId, options.domainId));
    }
    if (options.type) {
      conditions.push(eq(asmAssets.type, options.type));
    }
    if (options.search) {
      conditions.push(ilike(asmAssets.hostname, `%${options.search}%`));
    }

    const sortColumn =
      {
        hostname: asmAssets.hostname,
        type: asmAssets.type,
        riskScore: asmAssets.riskScore,
        firstSeen: asmAssets.firstSeen,
        lastSeen: asmAssets.lastSeen,
      }[options.sortBy ?? 'lastSeen'] ?? asmAssets.lastSeen;

    const orderFn = options.sortOrder === 'asc' ? asc : desc;

    const assets = await this.db
      .select()
      .from(asmAssets)
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await this.db
      .select({ count: count() })
      .from(asmAssets)
      .where(and(...conditions));

    return { assets, total: totalResult?.count ?? 0 };
  }

  async getAsset(auth: AuthContext, id: string) {
    const organizationId = this.requireOrganizationId(auth);

    const [asset] = await this.db
      .select()
      .from(asmAssets)
      .where(and(eq(asmAssets.id, id), eq(asmAssets.organizationId, organizationId)));

    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    return asset;
  }

  // ── Scans (derived from workflow runs) ─────────────────────────────────────

  async listScans(
    auth: AuthContext,
    options: {
      limit?: number;
      offset?: number;
      status?: string;
      domainId?: string;
    } = {},
  ) {
    const asmWorkflowIds = await this.resolveAsmWorkflowIds(auth);

    if (asmWorkflowIds.length === 0) {
      return { runs: [], total: 0 };
    }

    const result = await this.workflowsService.listRuns(auth, {
      workflowIds: asmWorkflowIds,
      status: options.status as any,
      limit: options.limit ?? 25,
      offset: options.offset ?? 0,
    });

    return result;
  }

  // ── Dashboard Stats ────────────────────────────────────────────────────────

  async getDashboardStats(auth: AuthContext) {
    const organizationId = this.requireOrganizationId(auth);

    const [domainStats] = await this.db
      .select({ count: count() })
      .from(asmDomains)
      .where(and(eq(asmDomains.organizationId, organizationId), isNull(asmDomains.deletedAt)));

    const [assetStats] = await this.db
      .select({ count: count() })
      .from(asmAssets)
      .where(eq(asmAssets.organizationId, organizationId));

    return {
      domains: domainStats?.count ?? 0,
      assets: assetStats?.count ?? 0,
    };
  }
}
