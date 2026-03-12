import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}

interface OrgAccount {
  id: string;
  name: string;
  status: string;
  email: string;
}

interface OrgAccountsResult {
  accounts: OrgAccount[];
}

interface AssumedRoleCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

interface CachedPlatformSession {
  credentials: AssumedRoleCredentials;
  expiresAt: Date;
}

@Injectable()
export class AwsService implements OnModuleInit {
  private readonly logger = new Logger(AwsService.name);
  private static readonly DEFAULT_REGION = 'us-east-1';
  private static readonly REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

  private platformSession: CachedPlatformSession | null = null;
  private platformSessionPromise: Promise<AssumedRoleCredentials> | null = null;
  private bootstrapIsPlatformRole = false;

  private isStrictIdentityCheckEnabled(): boolean {
    return process.env.SHIPSEC_AWS_STRICT_IDENTITY_CHECK?.trim().toLowerCase() !== 'false';
  }

  private resolveRegion(preferred?: string): string {
    const region = (
      preferred ??
      process.env.SHIPSEC_AWS_REGION ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      AwsService.DEFAULT_REGION
    ).trim();

    return region || AwsService.DEFAULT_REGION;
  }

  // ── Startup self-check ──
  async onModuleInit(): Promise<void> {
    const platformArn = process.env.SHIPSEC_PLATFORM_ROLE_ARN;
    if (!platformArn) {
      this.logger.warn('SHIPSEC_PLATFORM_ROLE_ARN not set — AWS IAM role integration disabled');
      return;
    }
    try {
      const client = this.getBootstrapStsClient();
      const identity = await client.send(new GetCallerIdentityCommand({}));
      const callerArn = identity.Arn!;

      if (this.isPlatformRole(callerArn)) {
        // Already running as the platform role (e.g., EC2/ECS instance role)
        this.bootstrapIsPlatformRole = true;
        this.logger.log(`Platform identity verified: running as ${platformArn}`);
        return;
      }

      // Bootstrap identity differs — attempt to assume the platform role
      this.logger.log(
        `Bootstrap identity is ${callerArn} (not ${platformArn}) — attempting platform role assumption`,
      );
      await this.getPlatformSessionCredentials();
      this.logger.log(`Platform role assumed successfully: ${platformArn}`);
    } catch (error: any) {
      if (error?.message?.includes('Region is missing')) {
        this.logger.warn(
          'AWS region not configured — skipping platform identity verification. ' +
            'Set AWS_REGION or AWS_DEFAULT_REGION to enable.',
        );
        return;
      }
      if (!this.isStrictIdentityCheckEnabled()) {
        this.logger.warn(
          `AWS platform identity verification failed, but SHIPSEC_AWS_STRICT_IDENTITY_CHECK=false; continuing without platform-role bootstrap. Original: ${error?.message ?? error}`,
        );
        return;
      }
      this.logger.error('AWS platform identity verification failed', error);
      throw error;
    }
  }

  // ── Bootstrap STS client (env vars → default chain) ──
  private getBootstrapStsClient(region?: string): STSClient {
    const keyId = process.env.SHIPSEC_AWS_ACCESS_KEY_ID;
    const secret = process.env.SHIPSEC_AWS_SECRET_ACCESS_KEY;
    if ((keyId && !secret) || (!keyId && secret)) {
      throw new Error(
        'Both SHIPSEC_AWS_ACCESS_KEY_ID and SHIPSEC_AWS_SECRET_ACCESS_KEY must be set, or neither',
      );
    }
    const credentials =
      keyId && secret
        ? {
            accessKeyId: keyId,
            secretAccessKey: secret,
            ...(process.env.SHIPSEC_AWS_SESSION_TOKEN && {
              sessionToken: process.env.SHIPSEC_AWS_SESSION_TOKEN,
            }),
          }
        : undefined; // SDK default chain
    return new STSClient({
      ...(credentials && { credentials }),
      region: this.resolveRegion(region),
    });
  }

  // ── Platform role ARN (from env var) ──
  getPlatformRoleArn(): string {
    const arn = process.env.SHIPSEC_PLATFORM_ROLE_ARN;
    if (!arn) throw new Error('SHIPSEC_PLATFORM_ROLE_ARN is required');
    return arn;
  }

  // ── Check if caller ARN matches the platform role ──
  private isPlatformRole(callerArn: string): boolean {
    const platformArn = process.env.SHIPSEC_PLATFORM_ROLE_ARN;
    if (!platformArn) return false;
    return this.normalizeToRoleArn(callerArn) === platformArn;
  }

  // ── Get or refresh cached platform role session credentials ──
  private async getPlatformSessionCredentials(): Promise<AssumedRoleCredentials> {
    const now = Date.now();

    // Cache hit: credentials valid for more than 5 more minutes
    if (
      this.platformSession &&
      this.platformSession.expiresAt.getTime() - now > AwsService.REFRESH_BUFFER_MS
    ) {
      return this.platformSession.credentials;
    }

    // Coalesce concurrent refresh attempts
    if (this.platformSessionPromise) {
      return this.platformSessionPromise;
    }

    this.platformSessionPromise = (async () => {
      try {
        const platformArn = this.getPlatformRoleArn();
        const bootstrapClient = this.getBootstrapStsClient();

        const response = await bootstrapClient.send(
          new AssumeRoleCommand({
            RoleArn: platformArn,
            RoleSessionName: `shipsec-platform-${Date.now()}`,
            DurationSeconds: 3600,
          }),
        );

        if (!response.Credentials) {
          throw new Error('AssumeRole for platform role returned no credentials');
        }

        const creds: AssumedRoleCredentials = {
          accessKeyId: response.Credentials.AccessKeyId!,
          secretAccessKey: response.Credentials.SecretAccessKey!,
          sessionToken: response.Credentials.SessionToken!,
        };

        this.platformSession = {
          credentials: creds,
          expiresAt: response.Credentials.Expiration ?? new Date(now + 3600 * 1000),
        };

        return creds;
      } catch (error: any) {
        this.platformSession = null;
        const isAccessDenied =
          error.name === 'AccessDenied' || error.name === 'AccessDeniedException';
        if (isAccessDenied) {
          throw new Error(
            `Platform role assumption failed: the bootstrap identity does not have ` +
              `permission to assume ${process.env.SHIPSEC_PLATFORM_ROLE_ARN}. ` +
              `Grant sts:AssumeRole on that ARN to the bootstrap identity. ` +
              `Original: ${error.message}`,
          );
        }
        throw error;
      } finally {
        this.platformSessionPromise = null;
      }
    })();

    return this.platformSessionPromise;
  }

  // ── STS client using platform role session credentials ──
  private async getPlatformStsClient(region?: string): Promise<STSClient> {
    if (this.bootstrapIsPlatformRole) {
      // Bootstrap identity is already the platform role — use directly
      return this.getBootstrapStsClient(region);
    }
    const sessionCreds = await this.getPlatformSessionCredentials();
    return new STSClient({
      credentials: {
        accessKeyId: sessionCreds.accessKeyId,
        secretAccessKey: sessionCreds.secretAccessKey,
        sessionToken: sessionCreds.sessionToken,
      },
      region: this.resolveRegion(region),
    });
  }

  // ── Assume customer role via platform identity (with duration retry) ──
  async assumeRoleWithPlatformIdentity(
    roleArn: string,
    externalId?: string,
    region?: string,
  ): Promise<AssumedRoleCredentials> {
    const configured = parseInt(process.env.SHIPSEC_AWS_STS_DURATION_SECONDS || '3600', 10);
    const durations = [...new Set([Math.min(configured, 43200), 3600, 900])];
    let lastError: Error | undefined;
    for (const duration of durations) {
      try {
        const client = await this.getPlatformStsClient(region);
        const response = await client.send(
          new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: `shipsec-${Date.now()}`,
            DurationSeconds: duration,
            ...(externalId && { ExternalId: externalId }),
          }),
        );
        if (!response.Credentials) throw new Error('No credentials returned');
        return {
          accessKeyId: response.Credentials.AccessKeyId!,
          secretAccessKey: response.Credentials.SecretAccessKey!,
          sessionToken: response.Credentials.SessionToken!,
        };
      } catch (error: any) {
        lastError = error;
        if (error.name === 'ValidationError' && error.message?.includes('DurationSeconds')) {
          this.logger.warn(`STS duration=${duration}s too high for ${roleArn}, retrying lower`);
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error('All STS duration attempts failed');
  }

  // ── Normalize assumed-role ARN to role ARN ──
  private normalizeToRoleArn(arn: string): string {
    // arn:aws:sts::123456789012:assumed-role/RoleName/session
    // → arn:aws:iam::123456789012:role/RoleName
    const match = arn.match(/^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)/);
    if (match) return `arn:aws:iam::${match[1]}:role/${match[2]}`;
    return arn; // Already a role/user ARN
  }

  // ── Discovers AWS Organization accounts ──
  async discoverOrgAccounts(credentials: AwsCredentials): Promise<OrgAccountsResult> {
    try {
      const orgClient = new OrganizationsClient({
        region: this.resolveRegion(credentials.region),
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken && {
            sessionToken: credentials.sessionToken,
          }),
        },
      });

      const accounts: OrgAccount[] = [];

      const paginator = paginateListAccounts({ client: orgClient }, {});

      for await (const page of paginator) {
        if (page.Accounts) {
          for (const account of page.Accounts) {
            accounts.push({
              id: account.Id || '',
              name: account.Name || '',
              status: account.Status || '',
              email: account.Email || '',
            });
          }
        }
      }

      this.logger.log(`Successfully discovered ${accounts.length} organization accounts`);

      return { accounts };
    } catch (error) {
      this.logger.error('Failed to discover organization accounts', error);
      throw new Error((error as Error).message || 'Failed to discover organization accounts');
    }
  }
}
