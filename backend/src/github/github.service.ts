import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { GithubAppConfig } from '../config/github-app.config';

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);

  constructor(private readonly configService: ConfigService) {}

  private get config(): GithubAppConfig {
    return this.configService.get<GithubAppConfig>('githubApp') ?? {
      appId: null,
      privateKey: null,
      webhookSecret: null,
    };
  }

  verifySignature(payload: Buffer | string, signatureHeader: string | undefined): boolean {
    const secret = this.config.webhookSecret;

    if (!secret) {
      this.logger.warn('GitHub webhook secret is not configured; skipping signature verification');
      return true;
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      this.logger.warn('Missing or malformed X-Hub-Signature-256 header');
      return false;
    }

    const expected = this.signPayload(payload, secret);
    const received = Buffer.from(signatureHeader.replace('sha256=', ''), 'hex');

    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private signPayload(payload: Buffer | string, secret: string): Buffer {
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    return hmac.digest();
  }
}
