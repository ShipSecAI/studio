import { Injectable, Logger, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { TemplateManifest } from '../database/schema/templates';

/**
 * Templates Service
 * Business logic for template operations
 *
 * Note: PR creation has been removed. The backend now serves templates
 * for browsing only. Users will create PRs through GitHub web flow.
 *
 * WorkflowRepository is optional since the GitHub web flow doesn't need it.
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly sanitizationService: WorkflowSanitizationService,
    private readonly templatesRepository: TemplatesRepository,
    @Optional() private readonly workflowsRepository?: any,
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
    throw new HttpException(
      'Template publishing via API is disabled. Please use the GitHub web flow from the frontend.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Use a template to create a new workflow
   *
   * Note: This is currently disabled since WorkflowRepository is not available.
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
    throw new HttpException(
      'Template usage is currently disabled. Use the GitHub web flow to access templates.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Sync templates from GitHub repository
   *
   * Note: This endpoint is now a no-op. GitHub sync has been removed.
   */
  async syncTemplates() {
    this.logger.warn('Template sync from GitHub has been disabled');

    return {
      synced: [],
      total: 0,
      message: 'GitHub sync has been disabled',
    };
  }

  /**
   * Get template submissions
   */
  async getSubmissions(userId: string) {
    return await this.templatesRepository.findSubmissionsByUser(userId);
  }
}
