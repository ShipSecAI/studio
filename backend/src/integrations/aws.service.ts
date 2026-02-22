import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
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

@Injectable()
export class AwsService implements OnModuleInit {
  private readonly logger = new Logger(AwsService.name);

  // ── Startup self-check ──
  async onModuleInit(): Promise<void> {
    const platformArn = process.env.SHIPSEC_PLATFORM_ROLE_ARN;
    if (!platformArn) {
      this.logger.warn('SHIPSEC_PLATFORM_ROLE_ARN not set — AWS IAM role integration disabled');
      return;
    }
    try {
      const client = this.getPlatformStsClient();
      const identity = await client.send(new GetCallerIdentityCommand({}));
      const callerArn = identity.Arn!;
      const normalizedCaller = this.normalizeToRoleArn(callerArn);
      if (normalizedCaller !== platformArn) {
        const msg =
          `Platform identity mismatch: SHIPSEC_PLATFORM_ROLE_ARN=${platformArn} ` +
          `but actual caller is ${callerArn} (normalized: ${normalizedCaller})`;
        if (process.env.SHIPSEC_AWS_STRICT_IDENTITY_CHECK === 'true') {
          throw new Error(msg);
        }
        this.logger.warn(
          msg + ' — continuing anyway (set SHIPSEC_AWS_STRICT_IDENTITY_CHECK=true to enforce)',
        );
      } else {
        this.logger.log(`Platform identity verified: ${platformArn}`);
      }
    } catch (error) {
      this.logger.error('AWS platform identity verification failed', error);
      throw error; // Prevent app from starting with invalid AWS creds
    }
  }

  // ── Platform STS client (env vars → default chain) ──
  private getPlatformStsClient(region?: string): STSClient {
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
    return new STSClient({ ...(credentials && { credentials }), ...(region && { region }) });
  }

  // ── Platform role ARN (from env var) ──
  getPlatformRoleArn(): string {
    const arn = process.env.SHIPSEC_PLATFORM_ROLE_ARN;
    if (!arn) throw new Error('SHIPSEC_PLATFORM_ROLE_ARN is required');
    return arn;
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
        const client = this.getPlatformStsClient(region);
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
