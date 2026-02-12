import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as crypto from 'crypto';

import { GitHubSyncService } from './github-sync.service';
import { Public } from '../auth/public.decorator';

interface GitHubWebhookPayload {
  action?: string;
  pull_request?: {
    merged?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * GitHub Webhook Controller
 * Handles GitHub webhook events for automatic template synchronization
 */
@ApiTags('templates')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly githubSyncService: GitHubSyncService) {}

  /**
   * Verify GitHub webhook signature
   * Uses HMAC SHA256 to verify the request came from GitHub
   */
  private verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header');
      return false;
    }

    // GitHub signature format: sha256=<hash>
    const signatureParts = signature.split('=');
    if (signatureParts.length !== 2 || signatureParts[0] !== 'sha256') {
      this.logger.warn(`Invalid signature format: ${signature}`);
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const hashBuffer = Buffer.from(signatureParts[1], 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (hashBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(hashBuffer, expectedBuffer);
  }

  /**
   * GitHub webhook endpoint
   * Receives webhook events from GitHub and triggers template sync on PR merge
   */
  @Public()
  @Post('github')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'GitHub webhook handler',
    description:
      'Receives webhook events from GitHub. Automatically syncs templates when a PR is merged.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async handleGitHubWebhook(
    @Body() payload: GitHubWebhookPayload,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<{ status: string; message: string }> {
    // Get webhook secret from environment
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.error('GITHUB_WEBHOOK_SECRET environment variable is not set');
      throw new BadRequestException('Webhook secret not configured');
    }

    // Verify signature
    const rawPayload = JSON.stringify(payload);
    if (!this.verifySignature(rawPayload, signature, webhookSecret)) {
      this.logger.warn('Invalid webhook signature received');
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.log('Received GitHub webhook');

    // Check if this is a pull_request event
    if (!payload.pull_request) {
      this.logger.debug('Ignoring non-pull_request event');
      return { status: 'ignored', message: 'Not a pull_request event' };
    }

    // Check if PR was merged
    if (payload.action !== 'closed' || !payload.pull_request.merged) {
      this.logger.debug(
        `Ignoring PR event: action=${payload.action}, merged=${payload.pull_request.merged}`,
      );
      return { status: 'ignored', message: 'PR not merged' };
    }

    this.logger.log('Detected merged PR, triggering template sync...');

    try {
      // Trigger template sync
      const result = await this.githubSyncService.syncTemplates();

      this.logger.log(
        `Template sync completed: ${result.synced.length} synced, ${result.failed.length} failed`,
      );

      return {
        status: 'success',
        message: `Synced ${result.synced.length} templates${
          result.failed.length > 0 ? `, ${result.failed.length} failed` : ''
        }`,
      };
    } catch (error) {
      this.logger.error('Failed to sync templates after PR merge', error);
      throw error;
    }
  }
}
