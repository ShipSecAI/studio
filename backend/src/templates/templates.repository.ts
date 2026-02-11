import { Inject, Injectable } from '@nestjs/common';
import {
  templatesTable,
  templatesSubmissionsTable,
  type TemplateManifest,
} from '../database/schema/templates';
import { eq, and, desc, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_TOKEN } from '../database/database.module';

/**
 * Templates Repository
 * Handles database operations for templates
 */
@Injectable()
export class TemplatesRepository {
  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  /**
   * Find all active templates
   */
  async findAll(filters?: { category?: string; search?: string; tags?: string[] }) {
    const query = this.db.select().from(templatesTable).where(eq(templatesTable.isActive, true));

    // Apply filters if provided
    if (filters?.category) {
      return (query as any).where(eq(templatesTable.category, filters.category)).execute();
    }

    if (filters?.search) {
      // Search in name and description
      return (query as any)
        .where(
          sql`${templatesTable.name} ILIKE ${`%${filters.search}%`} OR ${templatesTable.description} ILIKE ${`%${filters.search}%`}`,
        )
        .execute();
    }

    return (query as any).orderBy(desc(templatesTable.popularity)).execute();
  }

  /**
   * Find template by ID
   */
  async findById(id: string) {
    const results = await this.db
      .select()
      .from(templatesTable)
      .where(eq(templatesTable.id, id))
      .limit(1)
      .execute();

    return results[0] || null;
  }

  /**
   * Find template by repository and path
   */
  async findByRepoAndPath(repository: string, path: string) {
    const results = await this.db
      .select()
      .from(templatesTable)
      .where(and(eq(templatesTable.repository, repository), eq(templatesTable.path, path)))
      .limit(1)
      .execute();

    return results[0] || null;
  }

  /**
   * Create or update a template
   */
  async upsert(template: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    author?: string;
    repository: string;
    path: string;
    branch?: string;
    version?: string;
    commitSha?: string;
    manifest: TemplateManifest;
    graph?: Record<string, unknown>;
    requiredSecrets?: { name: string; type: string; description?: string }[];
    isOfficial?: boolean;
    isVerified?: boolean;
  }) {
    // Check if template already exists
    const existing = await this.findByRepoAndPath(template.repository, template.path);

    if (existing) {
      // Update existing template
      const results = await this.db
        .update(templatesTable)
        .set({
          ...template,
          updatedAt: new Date(),
        })
        .where(eq(templatesTable.id, existing.id))
        .returning()
        .execute();

      return results[0];
    } else {
      // Create new template
      const results = await this.db.insert(templatesTable).values(template).returning().execute();

      return results[0];
    }
  }

  /**
   * Increment popularity counter
   */
  async incrementPopularity(id: string) {
    await this.db
      .update(templatesTable)
      .set({
        popularity: sql`${templatesTable.popularity} + 1`,
      })
      .where(eq(templatesTable.id, id))
      .execute();
  }

  /**
   * Get all categories with counts
   */
  async getCategories() {
    const results = await this.db
      .select({
        category: templatesTable.category,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(templatesTable)
      .where(eq(templatesTable.isActive, true))
      .groupBy(templatesTable.category)
      .execute();

    return results;
  }

  /**
   * Get all tags
   */
  async getTags() {
    const templates = await this.db
      .select({
        tags: templatesTable.tags,
      })
      .from(templatesTable)
      .where(eq(templatesTable.isActive, true))
      .execute();

    const tagSet = new Set<string>();
    for (const template of templates) {
      if (Array.isArray(template.tags)) {
        for (const tag of template.tags) {
          tagSet.add(tag);
        }
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * Create a template submission record
   */
  async createSubmission(submission: {
    templateName: string;
    description?: string;
    category?: string;
    repository: string;
    branch?: string;
    path: string;
    commitSha?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    submittedBy: string;
    organizationId?: string;
    manifest?: TemplateManifest;
    graph?: Record<string, unknown>;
  }) {
    const results = await this.db.insert(templatesSubmissionsTable).values(submission).returning();

    return results[0];
  }

  /**
   * Find submission by PR number
   */
  async findSubmissionByPR(prNumber: number) {
    const results = await this.db
      .select()
      .from(templatesSubmissionsTable)
      .where(eq(templatesSubmissionsTable.pullRequestNumber, prNumber))
      .limit(1)
      .execute();

    return results[0] || null;
  }

  /**
   * Update submission status
   */
  async updateSubmissionStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected' | 'merged',
    reviewedBy?: string,
    feedback?: string,
  ) {
    const results = await this.db
      .update(templatesSubmissionsTable)
      .set({
        status,
        reviewedBy,
        feedback,
        reviewedAt: reviewedBy ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(templatesSubmissionsTable.id, id))
      .returning()
      .execute();

    return results[0];
  }

  /**
   * Get submissions by user
   */
  async findSubmissionsByUser(submittedBy: string) {
    return await this.db
      .select()
      .from(templatesSubmissionsTable)
      .where(eq(templatesSubmissionsTable.submittedBy, submittedBy))
      .orderBy(desc(templatesSubmissionsTable.createdAt))
      .execute();
  }
}
