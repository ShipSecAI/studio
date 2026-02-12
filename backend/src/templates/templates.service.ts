import { Injectable, Logger, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowGraphSchema } from '../workflows/dto/workflow-graph.dto';
import type { AuthContext } from '../auth/types';

/**
 * Templates Service
 * Business logic for template operations
 *
 * Note: PR creation has been removed. The backend now serves templates
 * for browsing only. Users will create PRs through GitHub web flow.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly sanitizationService: WorkflowSanitizationService,
    private readonly templatesRepository: TemplatesRepository,
    private readonly workflowsService: WorkflowsService,
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
   * Publish a workflow as a template
   *
   * Note: With GitHub web flow, this is now disabled. Users should use
   * the frontend modal which opens GitHub directly.
   */
  async publishTemplate(_params: {
    workflowId: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    submittedBy: string;
    organizationId?: string;
  }) {
    throw new HttpException(
      'Template publishing via API is disabled. Please use the GitHub web flow from the frontend.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Use a template to create a new workflow
   *
   * Fetches the template by ID, creates a new workflow from its graph data,
   * names it with the provided workflowName, and increments the template's
   * popularity counter.
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
    // 1. Find the template
    const template = await this.templatesRepository.findById(templateId);
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    // 2. Validate that the template has graph data
    if (!template.graph) {
      throw new HttpException(
        'Template does not contain workflow graph data',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // 3. Build the workflow graph from the template, overriding the name
    const graphData = {
      ...template.graph,
      name: params.workflowName,
    };

    // Parse through the WorkflowGraphSchema to ensure it conforms to the
    // expected shape (adds defaults for viewport, config, etc.)
    const workflowGraph = WorkflowGraphSchema.parse(graphData);

    // 4. Create the workflow via WorkflowsService
    const authContext: AuthContext = {
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'template',
    };

    this.logger.log(
      `Creating workflow "${params.workflowName}" from template "${template.name}" (${templateId})`,
    );

    const workflow = await this.workflowsService.create(workflowGraph, authContext);

    // 5. Increment the template's popularity counter
    await this.templatesRepository.incrementPopularity(templateId);

    this.logger.log(
      `Created workflow ${workflow.id} from template ${templateId}, popularity incremented`,
    );

    return {
      workflow,
      templateId,
      templateName: template.name,
    };
  }

  /**
   * Get template submissions
   */
  async getSubmissions(userId: string) {
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }
}
