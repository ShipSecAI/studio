import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

@Injectable()
export class SlackSigningGuard implements CanActivate {
  private readonly logger = new Logger(SlackSigningGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      this.logger.error('SLACK_SIGNING_SECRET is not configured');
      throw new UnauthorizedException('Slack signing not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();

    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      throw new UnauthorizedException('Missing Slack signature headers');
    }

    // Reject requests older than 5 minutes (replay attack prevention)
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_AGE_SECONDS) {
      throw new UnauthorizedException('Slack request timestamp too old');
    }

    // Compute expected signature
    // rawBody is attached by NestJS raw body middleware
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      this.logger.error('Raw body not available — ensure rawBody middleware is enabled');
      throw new UnauthorizedException('Cannot verify request signature');
    }

    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected = 'v0=' + createHmac('sha256', signingSecret).update(baseString).digest('hex');

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    return true;
  }
}
