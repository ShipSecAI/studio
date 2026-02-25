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
    //    Templates may lack node positions (stripped during publish to reduce size)
    //    so we add default positions in a grid layout before schema validation.
    let graphData: Record<string, unknown> = {
      ...template.graph,
      name: params.workflowName,
    };

    if (Array.isArray(graphData.nodes)) {
      graphData.nodes = (graphData.nodes as Record<string, unknown>[]).map((node, idx) => {
        if (!node.position || typeof node.position !== 'object') {
          return { ...node, position: { x: 250, y: idx * 150 } };
        }
        return node;
      });
    }

    if (params.secretMappings && template.requiredSecrets && template.requiredSecrets.length > 0) {
      graphData = this.applySecretMappings(
        graphData,
        params.secretMappings,
        template.requiredSecrets,
      );
    }

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

  private applySecretMappings(
    graph: Record<string, unknown>,
    secretMappings: Record<string, string>,
    requiredSecrets: { name: string; type: string; description?: string; placeholder?: string }[],
  ): Record<string, unknown> {
    if (!secretMappings || Object.keys(secretMappings).length === 0) {
      return graph;
    }

    const json = JSON.stringify(graph);

    if (requiredSecrets.length === 1 && secretMappings[requiredSecrets[0].name]) {
      const replaced = json.replace(
        /\{\{SECRET_PLACEHOLDER\}\}/g,
        secretMappings[requiredSecrets[0].name],
      );
      return JSON.parse(replaced);
    }

    const result = JSON.parse(json);
    this.traverseAndApplySecrets(result, secretMappings);
    return result;
  }

  private traverseAndApplySecrets(obj: unknown, secretMappings: Record<string, string>): void {
    if (typeof obj !== 'object' || obj === null) return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.traverseAndApplySecrets(item, secretMappings);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    const secretKeys = ['secretId', 'secret_name', 'secretName', 'secretRef', 'secret_ref'];
    for (const key of secretKeys) {
      if (record[key] === '{{SECRET_PLACEHOLDER}}') {
        const possibleNameKeys = ['label', 'name', 'key', 'displayName'];
        for (const nameKey of possibleNameKeys) {
          const nameValue = record[nameKey];
          if (typeof nameValue === 'string' && secretMappings[nameValue]) {
            record[key] = secretMappings[nameValue];
            break;
          }
        }

        if (record[key] === '{{SECRET_PLACEHOLDER}}') {
          const firstAvailable = Object.values(secretMappings)[0];
          if (firstAvailable) {
            record[key] = firstAvailable;
          }
        }
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.includes('{{SECRET_PLACEHOLDER}}')) {
        const firstAvailable = Object.values(secretMappings)[0];
        if (firstAvailable) {
          record[key] = value.replace(/\{\{SECRET_PLACEHOLDER\}\}/g, firstAvailable);
        }
      } else if (typeof value === 'object' && value !== null) {
        this.traverseAndApplySecrets(value, secretMappings);
      }
    }
  }
}
