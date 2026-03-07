import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { GitHubAppService } from './github-app.service';
import { Public } from '../auth/public.decorator';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import {
  CompleteInstallationDto,
  CompleteInstallationSchema,
  CreateTriggerRuleSchema,
  CreateTriggerRuleDto,
  GitHubBranchDto,
  GitHubInstallationDto,
  GitHubRepoDto,
  GitHubScanResultDto,
  GitHubScanResultsQueryDto,
  GitHubScanResultsQuerySchema,
  GitHubStatusResponseDto,
  InstallationTokenResponseDto,
  QuickScanWorkflowDto,
  SyncRepositoriesResponseDto,
  ToggleRepoScansDto,
  ToggleRepoScansSchema,
  TriggerRuleDto,
  GitHubTriggerScanDto,
  GitHubTriggerScanSchema,
  TriggerScanResponseDto,
  UpdateTriggerRuleSchema,
  UpdateTriggerRuleDto,
  type GitHubWebhookEvent,
  type GitHubPullRequestEvent,
  type GitHubPushEvent,
} from './dto/github-app.dto';
import type { GitHubAppConfig } from '../config/github-app.config';

@ApiTags('github')
@Controller('github')
export class GitHubAppController {
  private readonly logger = new Logger(GitHubAppController.name);
  private readonly config: GitHubAppConfig;

  constructor(
    private readonly githubAppService: GitHubAppService,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<GitHubAppConfig>('githubApp')!;
  }

  // ============ Configuration ============

  @Get('status')
  @ApiOkResponse({ type: GitHubStatusResponseDto })
  getStatus(@CurrentAuth() _auth: AuthContext) {
    return {
      configured: this.githubAppService.isConfigured(),
      installUrl: this.githubAppService.isConfigured()
        ? this.githubAppService.getInstallUrl()
        : null,
    };
  }

  // ============ Installations ============

  @Get('installations')
  @ApiOkResponse({ type: [GitHubInstallationDto] })
  async listInstallations(@CurrentAuth() auth: AuthContext) {
    return this.githubAppService.listInstallations(auth);
  }

  // ============ Repositories ============

  @Get('repos')
  @ApiOkResponse({ type: [GitHubRepoDto] })
  async listRepositories(@CurrentAuth() auth: AuthContext) {
    return this.githubAppService.listRepositories(auth);
  }

  @Get('repos/:id')
  @ApiOkResponse({ type: GitHubRepoDto })
  async getRepository(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.githubAppService.getRepository(id, auth);
  }

  @Get('repos/:id/branches')
  @ApiOkResponse({ type: [GitHubBranchDto] })
  async listBranches(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.githubAppService.listBranches(id, auth);
  }

  @Patch('repos/:id/scans')
  @ApiOkResponse({ type: GitHubRepoDto })
  async toggleRepoScans(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ToggleRepoScansSchema)) body: ToggleRepoScansDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.githubAppService.toggleRepoScans(id, body.enabled, auth);
  }

  /**
   * Handle GitHub App post-installation setup callback.
   * Called by the frontend after the user is redirected back from GitHub App installation.
   * Ensures the installation record exists and repositories are synced.
   */
  @Post('installations/setup')
  @ApiOkResponse({ type: GitHubInstallationDto })
  async setupInstallation(
    @Body(new ZodValidationPipe(CompleteInstallationSchema)) body: CompleteInstallationDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    if (!body.installationId || typeof body.installationId !== 'number') {
      throw new BadRequestException('installationId (number) is required');
    }

    return this.githubAppService.setupInstallation(body.installationId, auth);
  }

  /**
   * Get an installation token for worker components
   * This endpoint is used by worker components to authenticate with GitHub
   * when cloning private repositories or making API calls
   */
  @Post('installations/:installationId/token')
  @ApiOkResponse({ type: InstallationTokenResponseDto })
  async getInstallationToken(
    @Param('installationId') installationId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    const id = parseInt(installationId, 10);
    if (isNaN(id)) {
      throw new BadRequestException('Invalid installation ID');
    }

    const token = await this.githubAppService.getInstallationTokenForOrg(id, auth);
    return { token };
  }

  @Get('quick-scan-workflows')
  @ApiOkResponse({ type: [QuickScanWorkflowDto] })
  async getQuickScanWorkflows(@CurrentAuth() auth: AuthContext) {
    return this.githubAppService.getQuickScanWorkflows(auth);
  }

  @Post('repos/:id/scan')
  @ApiCreatedResponse({ type: TriggerScanResponseDto })
  async triggerScan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GitHubTriggerScanSchema)) body: GitHubTriggerScanDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    if (!body.workflowId) {
      throw new BadRequestException('workflowId is required');
    }

    // Get repository to determine default branch if not provided
    const repository = await this.githubAppService.getRepository(id, auth);
    const branch = body.branch || repository.defaultBranch || undefined;

    return this.githubAppService.triggerScan(id, body.workflowId, branch, auth);
  }

  @Post('repos/sync')
  @ApiOkResponse({ type: SyncRepositoriesResponseDto })
  async syncRepositories(@CurrentAuth() auth: AuthContext) {
    // Get all installations for the organization
    const installations = await this.githubAppService.listInstallations(auth);

    // Sync repositories for each installation
    let totalSynced = 0;
    for (const installation of installations) {
      const count = await this.githubAppService.syncInstallationRepositories(
        installation.id,
        installation.installationId,
        installation.organizationId,
        { forceRefreshToken: true },
      );
      totalSynced += count;
    }

    return { synced: totalSynced };
  }

  // ============ Trigger Rules ============

  @Get('triggers')
  @ApiOkResponse({ type: [TriggerRuleDto] })
  async listTriggerRules(@CurrentAuth() auth: AuthContext) {
    return this.githubAppService.listTriggerRules(auth);
  }

  @Get('triggers/:id')
  @ApiOkResponse({ type: TriggerRuleDto })
  async getTriggerRule(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.githubAppService.getTriggerRule(id, auth);
  }

  @Post('triggers')
  @ApiCreatedResponse({ type: TriggerRuleDto })
  async createTriggerRule(
    @Body(new ZodValidationPipe(CreateTriggerRuleSchema)) body: CreateTriggerRuleDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.githubAppService.createTriggerRule(body, auth);
  }

  @Patch('triggers/:id')
  @ApiOkResponse({ type: TriggerRuleDto })
  async updateTriggerRule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTriggerRuleSchema)) body: UpdateTriggerRuleDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.githubAppService.updateTriggerRule(id, body, auth);
  }

  @Delete('triggers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteTriggerRule(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    await this.githubAppService.deleteTriggerRule(id, auth);
  }

  // ============ Scan Results ============

  @Get('scans')
  @ApiOkResponse({ type: [GitHubScanResultDto] })
  async listScanResults(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(GitHubScanResultsQuerySchema))
    query: GitHubScanResultsQueryDto,
  ) {
    const statuses = query.status
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return this.githubAppService.listScanResults(auth, {
      repositoryId: query.repositoryId,
      statuses: statuses && statuses.length > 0 ? statuses : undefined,
      source: query.source,
      scheduleId: query.scheduleId,
      triggerRuleId: query.triggerRuleId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('scans/:id')
  @ApiOkResponse({ type: GitHubScanResultDto })
  async getScanResult(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.githubAppService.getScanResult(id, auth);
  }

  // ============ Webhook Handler ============

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-github-event') eventType: string,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    this.logger.log(`Received GitHub webhook: ${eventType} (${deliveryId})`);

    // Verify signature
    if (!this.verifyWebhookSignature(req.rawBody, signature)) {
      this.logger.warn(`Invalid webhook signature for delivery ${deliveryId}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload = JSON.parse(req.rawBody?.toString() ?? '{}');

    // Resolve organization context from the installation record in our DB.
    // For installation.created events the record does not exist yet — the
    // authenticated POST /github/installations/setup endpoint handles that.
    const githubInstallationId: number | undefined = payload.installation?.id;
    let webhookAuth: AuthContext | null = null;

    if (githubInstallationId) {
      webhookAuth = await this.githubAppService.resolveWebhookAuth(githubInstallationId);
    }

    try {
      switch (eventType) {
        case 'installation':
          return this.handleInstallationEvent(payload, webhookAuth);

        case 'installation_repositories':
          if (!webhookAuth) {
            this.logger.warn('installation_repositories webhook for unknown installation');
            return { status: 'unknown_installation' };
          }
          return this.handleInstallationRepositoriesEvent(payload, webhookAuth);

        case 'pull_request':
          if (!webhookAuth) {
            this.logger.warn('pull_request webhook for unknown installation');
            return { status: 'unknown_installation' };
          }
          return this.handlePullRequestEvent(payload as GitHubPullRequestEvent, webhookAuth);

        case 'push':
          if (!webhookAuth) {
            this.logger.warn('push webhook for unknown installation');
            return { status: 'unknown_installation' };
          }
          return this.handlePushEvent(payload as GitHubPushEvent, webhookAuth);

        case 'ping':
          this.logger.log('Received ping webhook');
          return { status: 'pong' };

        default:
          this.logger.log(`Unhandled event type: ${eventType}`);
          return { status: 'ignored', event: eventType };
      }
    } catch (error) {
      this.logger.error(`Error handling webhook: ${error}`);
      throw error;
    }
  }

  // ============ Webhook Event Handlers ============

  private async handleInstallationEvent(
    payload: GitHubWebhookEvent,
    _webhookAuth: AuthContext | null,
  ) {
    const action = payload.action;
    this.logger.log(`Installation event: ${action}`);

    switch (action) {
      case 'created':
        // Organization context is not available from the webhook payload.
        // The authenticated POST /github/installations/setup endpoint
        // (called by the frontend after the user is redirected back) will
        // create the installation record with the correct organizationId.
        this.logger.log(
          `Installation created webhook received for ${payload.installation?.id}, awaiting setup callback`,
        );
        return { status: 'pending_setup' };

      case 'deleted':
        await this.githubAppService.handleInstallationDeleted(payload);
        return { status: 'deleted' };

      case 'suspend':
        await this.githubAppService.handleInstallationSuspended(payload);
        return { status: 'suspended' };

      case 'unsuspend':
        await this.githubAppService.handleInstallationUnsuspended(payload);
        return { status: 'unsuspended' };

      default:
        return { status: 'ignored', action };
    }
  }

  private async handleInstallationRepositoriesEvent(
    payload: GitHubWebhookEvent,
    auth: AuthContext,
  ) {
    const action = payload.action;
    this.logger.log(`Installation repositories event: ${action}`);

    switch (action) {
      case 'added':
        return this.githubAppService.handleRepositoriesAdded(payload, auth);

      case 'removed':
        await this.githubAppService.handleRepositoriesRemoved(payload);
        return { status: 'repositories_removed' };

      default:
        return { status: 'ignored', action };
    }
  }

  private async handlePullRequestEvent(payload: GitHubPullRequestEvent, auth: AuthContext) {
    return this.githubAppService.handlePullRequestEvent(payload, auth);
  }

  private async handlePushEvent(payload: GitHubPushEvent, auth: AuthContext) {
    return this.githubAppService.handlePushEvent(payload, auth);
  }

  // ============ Signature Verification ============

  private verifyWebhookSignature(
    payload: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    if (!this.config.webhookSecret) {
      this.logger.error('Webhook secret not configured; rejecting unsigned webhook');
      return false;
    }

    if (!payload || !signature) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex')}`;

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }
}
