import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { GithubAppService } from './github.service';
import { GithubWebhookService } from './github-webhook.service';

@Controller('webhooks/github')
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name);

  constructor(
    private readonly githubApp: GithubAppService,
    private readonly webhookService: GithubWebhookService,
  ) {}

  @Post('app')
  @HttpCode(202)
  async handleGithubAppWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-github-event') eventName: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ ok: true }> {
    const rawBody =
      (req as any).rawBody ??
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}), 'utf8');

    if (!this.githubApp.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }

    const normalizedBody = typeof body === 'string' ? JSON.parse(body) : body ?? {};
    const event = eventName ?? 'unknown';
    const delivery = deliveryId ?? 'missing-delivery-id';

    if (userAgent !== undefined) {
      this.logger.debug(`GitHub webhook user-agent: ${userAgent}`);
    }

    const envelope = this.webhookService.normalizePayload(normalizedBody, {
      event,
      deliveryId: delivery,
      signature,
    });

    await this.webhookService.handleWebhook(envelope);

    return { ok: true };
  }
}
