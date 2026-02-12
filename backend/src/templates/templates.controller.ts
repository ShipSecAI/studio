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
  HttpException,
} from '@nestjs/common';
import { TemplateService } from './templates.service';
import { GitHubSyncService } from './github-sync.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Public } from '../auth/public.decorator';

/**
 * Templates Controller
 * Handles template library API endpoints
 */
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly githubSyncService: GitHubSyncService,
  ) {}

  /**
   * GET /templates - List all templates with optional filters (public)
   */
  @Public()
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
   * GET /templates/categories - List available categories (public)
   */
  @Public()
  @Get('categories')
  async getCategories() {
    return await this.templateService.getCategories();
  }

  /**
   * GET /templates/tags - List available tags (public)
   */
  @Public()
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
   * GET /templates/repo-info - Get GitHub repository information (public)
   * IMPORTANT: Must come before :id route to avoid route conflict
   */
  @Public()
  @Get('repo-info')
  async getRepoInfo() {
    return await this.githubSyncService.getRepositoryInfo();
  }

  /**
   * GET /templates/submissions - Get template submissions for current user
   * IMPORTANT: Must come before :id route to avoid route conflict
   */
  @Get('submissions')
  async getSubmissions(@CurrentAuth() auth: { userId?: string; organizationId?: string }) {
    return await this.templateService.getSubmissions(auth.userId || auth.organizationId || '');
  }

  /**
   * GET /templates/:id - Get template details by ID (public)
   * IMPORTANT: Must be last to avoid conflicting with specific routes
   */
  @Public()
  @Get(':id')
  async getTemplate(@Param('id') id: string) {
    const template = await this.templateService.getTemplateById(id);
    if (!template) {
      throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  /**
   * POST /templates/publish - Validate a workflow for template submission
   *
   * Note: This endpoint now only validates templates. PR creation has been removed.
   * Users should create PRs via GitHub web flow after validation.
   */
  @Post('publish')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
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
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
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
   *
   * Fetches templates from the GitHub repository and stores them in the database.
   */
  @Post('sync')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async syncTemplates(@CurrentAuth() _auth: { organizationId?: string }) {
    return await this.githubSyncService.syncTemplates();
  }
}
