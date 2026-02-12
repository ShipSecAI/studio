import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';

interface SetupTokenPayload {
  orgId: string;
  externalId: string;
  exp: number; // Unix timestamp
}

const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_DEV_SIGNING_KEY = 'fedcba9876543210fedcba9876543210';

@Injectable()
export class SetupTokenService {
  private readonly logger = new Logger(SetupTokenService.name);
  private readonly signingKey: string;

  constructor() {
    const key =
      process.env.INTEGRATION_STORE_MASTER_KEY ??
      process.env.SECRET_STORE_MASTER_KEY ??
      DEFAULT_DEV_SIGNING_KEY;

    if (!process.env.INTEGRATION_STORE_MASTER_KEY && !process.env.SECRET_STORE_MASTER_KEY) {
      this.logger.warn(
        'INTEGRATION_STORE_MASTER_KEY is not configured. Using insecure dev key for setup tokens.',
      );
    }

    this.signingKey = key;
  }

  generate(orgId: string, externalId: string): string {
    const payload: SetupTokenPayload = {
      orgId,
      externalId,
      exp: Date.now() + SETUP_TOKEN_TTL_MS,
    };
    const data = JSON.stringify(payload);
    const sig = createHmac('sha256', this.signingKey).update(data).digest('hex');
    // base64url(payload.sig)
    return Buffer.from(`${data}.${sig}`).toString('base64url');
  }

  verify(token: string, orgId: string, externalId: string): void {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Invalid setup token');
    }

    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx === -1) throw new BadRequestException('Invalid setup token format');

    const data = decoded.slice(0, dotIdx);
    const sig = decoded.slice(dotIdx + 1);

    const expectedSig = createHmac('sha256', this.signingKey).update(data).digest('hex');
    if (sig !== expectedSig) {
      throw new BadRequestException('Setup token signature invalid');
    }

    const payload: SetupTokenPayload = JSON.parse(data);
    if (Date.now() > payload.exp) {
      throw new BadRequestException('Setup token expired — please restart the connection setup');
    }
    if (payload.orgId !== orgId) {
      throw new BadRequestException('Setup token organization mismatch');
    }
    if (payload.externalId !== externalId) {
      throw new BadRequestException('External ID does not match setup token');
    }
  }
}
