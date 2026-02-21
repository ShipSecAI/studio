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
import { eq, and, isNull, desc, asc, ilike, count } from 'drizzle-orm';
import type { AuthContext } from '../auth/types';
import { WorkflowsService } from '../workflows/workflows.service';
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

    // Aggregate stats per domain
    const domainsWithStats = await Promise.all(
      domains.map(async (domain) => {
        const [assetStats] = await this.db
          .select({ count: count() })
          .from(asmAssets)
          .where(eq(asmAssets.domainId, domain.id));

        return {
          ...domain,
          assetCount: assetStats?.count ?? 0,
        };
      }),
    );

    return domainsWithStats;
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

    // Update lastScanAt
    await this.db
      .update(asmDomains)
      .set({ lastScanAt: new Date(), updatedAt: new Date() })
      .where(eq(asmDomains.id, domainId));

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

    // Look up system workflows to find one instantiated from this template
    const organizationId = this.requireOrganizationId(auth);
    const workflows = await this.workflowsService.list(auth);
    const systemWorkflow = workflows.find(
      (w: any) => w.templateId === template.id || w.slug === templateSlug,
    );

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
    // Find ASM workflow IDs
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

    // Get workflow runs from existing infrastructure
    const workflows = await this.workflowsService.list(auth);
    const asmWorkflowIds = workflows
      .filter((w: any) => {
        if (asmTemplateIds.includes(w.templateId)) return true;
        if (w.slug && asmTemplateSlugs.has(w.slug)) return true;
        return false;
      })
      .map((w: any) => w.id);

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
