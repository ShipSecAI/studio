import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { GitHubTemplateService } from './github-template.service';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { WorkflowRepository } from '../workflows/repository/workflow.repository';
import { TemplateManifest } from '../database/schema/templates';

/**
 * Templates Service
 * Business logic for template operations
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly githubService: GitHubTemplateService,
    private readonly sanitizationService: WorkflowSanitizationService,
    private readonly templatesRepository: TemplatesRepository,
    private readonly workflowsRepository: WorkflowRepository,
  ) {}

  /**
   * List all templates with optional filters
   */
  async listTemplates(filters?: { category?: string; search?: string; tags?: string[] }) {
    return await this.templatesRepository.findAll(filters);
  }

  /**
   * Get template by ID
   */
  async getTemplateById(id: string) {
    return await this.templatesRepository.findById(id);
  }

  /**
   * Get user's submitted templates
   */
  async getMyTemplates(userId: string | undefined) {
    if (!userId) return [];
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }

  /**
   * Get template categories
   */
  async getCategories() {
    return await this.templatesRepository.getCategories();
  }

  /**
   * Get template tags
   */
  async getTags() {
    return await this.templatesRepository.getTags();
  }

  /**
   * Publish a workflow as a template (creates GitHub PR)
   */
  async publishTemplate(params: {
    workflowId: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    submittedBy: string;
    organizationId?: string;
  }) {
    const { workflowId, name, description, category, tags, author, submittedBy } = params;

    // Get workflow from database
    const workflow = await this.workflowsRepository.findById(workflowId);
    if (!workflow) {
      throw new HttpException('Workflow not found', HttpStatus.NOT_FOUND);
    }

    // Sanitize the workflow graph
    const { sanitizedGraph, requiredSecrets, removedSecrets } =
      this.sanitizationService.sanitizeWorkflow(workflow.graph as Record<string, unknown>);

    // Validate sanitized graph
    const validation = this.sanitizationService.validateSanitizedGraph(sanitizedGraph);
    if (!validation.valid) {
      throw new HttpException(
        `Invalid workflow graph: ${validation.errors.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Generate manifest
    const manifest = this.sanitizationService.generateManifest({
      name,
      description,
      category,
      tags,
      author,
      graph: sanitizedGraph,
      requiredSecrets,
    });

    // Get GitHub repo config
    const templateRepo = process.env.GITHUB_TEMPLATE_REPO || '';
    if (!templateRepo) {
      throw new HttpException(
        'Template repository not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Create GitHub PR
    const prResult = await this.githubService.createTemplatePR({
      templateName: name,
      description,
      category,
      tags,
      author,
      manifest,
      graph: sanitizedGraph,
      requiredSecrets,
    });

    // Create submission record
    await this.templatesRepository.createSubmission({
      templateName: name,
      description,
      category,
      repository: templateRepo,
      branch: prResult.branch,
      path: `templates/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
      pullRequestNumber: prResult.prNumber,
      pullRequestUrl: prResult.prUrl,
      submittedBy,
      organizationId: undefined,
      manifest: manifest as TemplateManifest,
      graph: sanitizedGraph,
    });

    this.logger.log(`Template published by ${submittedBy}: PR #${prResult.prNumber}`);

    return {
      templateId: `pending-${prResult.prNumber}`,
      pullRequestUrl: prResult.prUrl,
      pullRequestNumber: prResult.prNumber,
      sanitizedSecrets: removedSecrets,
      requiredSecrets,
    };
  }

  /**
   * Use a template to create a new workflow
   */
  async useTemplate(
    templateId: string,
    params: {
      workflowName: string;
      secretMappings?: Record<string, string>;
      userId?: string;
      organizationId?: string;
    },
  ) {
    const { workflowName, userId } = params;

    // Get template from database or GitHub
    const template = await this.templatesRepository.findById(templateId);
    let graph: Record<string, unknown>;

    if (template && template.graph) {
      graph = template.graph as Record<string, unknown>;
    } else {
      // Try to fetch from GitHub
      const templateContent = await this.githubService.getTemplateByName(templateId);
      if (!templateContent) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      graph = templateContent.graph as Record<string, unknown>;
    }

    // Create new workflow from template graph
    const newWorkflow = await this.workflowsRepository.create(
      {
        name: workflowName,
        description: `Created from template: ${templateId}`,
        nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
        edges: Array.isArray(graph.edges) ? graph.edges : [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      { organizationId: params.organizationId },
    );

    // Increment template popularity
    if (template) {
      await this.templatesRepository.incrementPopularity(template.id);
    }

    this.logger.log(
      `Template ${templateId} used by ${userId} to create workflow ${newWorkflow.id}`,
    );

    return {
      workflowId: newWorkflow.id,
      templateName: template?.name || templateId,
    };
  }

  /**
   * Sync templates from GitHub repository
   */
  async syncTemplates() {
    if (!this.githubService.isConfigured()) {
      throw new HttpException(
        'GitHub integration not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const templates = await this.githubService.getTemplatesFromRepo();
    const synced = [];

    for (const template of templates) {
      const { manifest, graph, requiredSecrets } = template.content;

      // Upsert template to database
      const upserted = await this.templatesRepository.upsert({
        name: (manifest as any).name as string,
        description: (manifest as any).description as string,
        category: (manifest as any).category as string,
        tags: (manifest as any).tags as string[],
        author: (manifest as any).author as string,
        repository: process.env.GITHUB_TEMPLATE_REPO!,
        path: template.path,
        branch: 'main',
        version: (manifest as any).version as string,
        manifest: manifest as TemplateManifest,
        graph: graph as Record<string, unknown>,
        requiredSecrets: requiredSecrets as {
          name: string;
          type: string;
          description?: string;
        }[],
        isOfficial: false,
        isVerified: false,
      });

      synced.push({
        id: upserted.id,
        name: upserted.name,
      });
    }

    this.logger.log(`Synced ${synced.length} templates from GitHub`);

    return {
      synced,
      total: synced.length,
    };
  }

  /**
   * Get template submissions
   */
  async getSubmissions(userId: string) {
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }
}
