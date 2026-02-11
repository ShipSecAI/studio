import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TemplateService } from './templates.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { RequireWorkflowRole } from '../workflows/workflow-role.guard';

/**
 * Templates Controller
 * Handles template library API endpoints
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * GET /templates - List all templates with optional filters
   */
  @Get()
  async listTemplates(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string,
  ) {
    const filters: {
      category?: string;
      search?: string;
      tags?: string[];
    } = {};

    if (category) filters.category = category;
    if (search) filters.search = search;
    if (tags) filters.tags = tags.split(',');

    return await this.templateService.listTemplates(filters);
  }

  /**
   * GET /templates/categories - List available categories
   */
  @Get('categories')
  async getCategories() {
    return await this.templateService.getCategories();
  }

  /**
   * GET /templates/tags - List available tags
   */
  @Get('tags')
  async getTags() {
    return await this.templateService.getTags();
  }

  /**
   * GET /templates/my - Get user's submitted templates
   */
  @Get('my')
  async getMyTemplates(@CurrentAuth() auth: { userId?: string; organizationId?: string }) {
    return await this.templateService.getMyTemplates(auth.userId || auth.organizationId);
  }

  /**
   * GET /templates/:id - Get template details by ID
   */
  @Get(':id')
  async getTemplate(@Param('id') id: string) {
    const template = await this.templateService.getTemplateById(id);
    if (!template) {
      throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  /**
   * POST /templates/publish - Publish a workflow as a template (creates PR)
   */
  @Post('publish')
  @UseGuards(RequireWorkflowRole('ADMIN'))
  @HttpCode(HttpStatus.ACCEPTED)
  async publishTemplate(
    @CurrentAuth() auth: { userId?: string; organizationId?: string },
    @Body()
    dto: {
      workflowId: string;
      name: string;
      description: string;
      category: string;
      tags: string[];
      author: string;
    },
  ) {
    return await this.templateService.publishTemplate({
      ...dto,
      submittedBy: auth.userId || auth.organizationId || 'unknown',
      organizationId: auth.organizationId,
    });
  }

  /**
   * POST /templates/:id/use - Use a template to create a new workflow
   */
  @Post(':id/use')
  @UseGuards(RequireWorkflowRole('ADMIN'))
  async useTemplate(
    @Param('id') id: string,
    @CurrentAuth() auth: { userId?: string; organizationId?: string },
    @Body()
    dto: {
      workflowName: string;
      secretMappings?: Record<string, string>;
    },
  ) {
    return await this.templateService.useTemplate(id, {
      ...dto,
      userId: auth.userId || auth.organizationId,
      organizationId: auth.organizationId,
    });
  }

  /**
   * POST /templates/sync - Sync templates from GitHub (admin only)
   */
  @Post('sync')
  @UseGuards(RequireWorkflowRole('ADMIN'))
  async syncTemplates(@CurrentAuth() _auth: { organizationId?: string }) {
    return await this.templateService.syncTemplates();
  }

  /**
   * GET /templates/submissions - Get template submissions for current user
   */
  @Get('submissions')
  async getSubmissions(@CurrentAuth() auth: { userId?: string; organizationId?: string }) {
    return await this.templateService.getSubmissions(auth.userId || auth.organizationId || '');
  }
}

class HttpException extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
