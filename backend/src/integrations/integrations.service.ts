import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SecretEncryptionMaterial } from '@shipsec/shared';
import { randomBytes, createHash } from 'crypto';

import { IntegrationConnectedEvent } from './events/integration.events';

import {
  IntegrationProviderConfig,
  IntegrationProviderSummary,
  generateState,
  loadIntegrationProviders,
  summarizeProvider,
} from './integration-providers';
import { getCatalog, type IntegrationProviderDefinition } from './integration-catalog';
import { IntegrationsRepository } from './integrations.repository';
import { TokenEncryptionService } from './token.encryption';
import { AwsService } from './aws.service';
import { SlackService } from './slack.service';
import { SetupTokenService } from './setup-token.service';
import { generateExternalId, formatExternalIdForDisplay } from './external-id-generator';
import { ForgeDiscoveryService } from './forge-discovery.service';
import type { CreateAwsConnectionDto } from './integrations.dto';
import type { IntegrationTokenRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

export interface OAuthStartResponse {
  provider: string;
  authorizationUrl: string;
  state: string;
  expiresIn: number;
}

export interface IntegrationConnection {
  id: string;
  provider: string;
  providerName: string;
  userId: string;
  credentialType: string;
  displayName: string;
  organizationId: string;
  scopes: string[];
  tokenType: string;
  expiresAt: Date | null;
  lastValidatedAt: Date | null;
  lastValidationStatus: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'expired';
  supportsRefresh: boolean;
  hasRefreshToken: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderTokenResponse {
  provider: string;
  userId: string;
  accessToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: Date | null;
}

type ResolvedProviderConfig = IntegrationProviderConfig & {
  clientId: string;
  clientSecret: string;
};

const TOKEN_REFRESH_BUFFER_MS = 60_000; // proactively refresh 1 minute before expiry

interface TokenRequestOptions {
  grantType: 'authorization_code' | 'refresh_token';
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  codeVerifier?: string | null;
  scopes?: string[];
  additionalParams?: Record<string, string>;
}

interface ProviderCredentialOverride {
  provider: string;
  clientId: string;
  clientSecret: SecretEncryptionMaterial;
  updatedAt: Date;
}

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly providers: Record<string, IntegrationProviderConfig>;
  private providerOverrides = new Map<string, ProviderCredentialOverride>();

  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly encryption: TokenEncryptionService,
    private readonly awsService: AwsService,
    private readonly slackService: SlackService,
    private readonly setupTokenService: SetupTokenService,
    private readonly eventEmitter: EventEmitter2,
    private readonly forgeDiscovery: ForgeDiscoveryService,
  ) {
    this.providers = loadIntegrationProviders();
  }

  async onModuleInit(): Promise<void> {
    await this.reloadProviderOverrides();
  }

  /* ------------------------------------------------------------------ */
  /*  Catalog                                                           */
  /* ------------------------------------------------------------------ */

  getCatalog(): IntegrationProviderDefinition[] {
    return getCatalog();
  }

  /* ------------------------------------------------------------------ */
  /*  Provider listing & configuration                                  */
  /* ------------------------------------------------------------------ */

  listProviders(): IntegrationProviderSummary[] {
    return Object.values(this.providers).map((config) =>
      summarizeProvider(this.mergeProviderConfig(config)),
    );
  }

  private async reloadProviderOverrides(): Promise<void> {
    const records = await this.repository.listProviderConfigs();
    this.providerOverrides = new Map(
      records.map((record) => [
        record.provider,
        {
          provider: record.provider,
          clientId: record.clientId,
          clientSecret: record.clientSecret as SecretEncryptionMaterial,
          updatedAt: new Date(record.updatedAt),
        },
      ]),
    );
  }

  private mergeProviderConfig(config: IntegrationProviderConfig): IntegrationProviderConfig {
    const override = this.providerOverrides.get(config.id);
    if (!override) {
      return config;
    }

    return {
      ...config,
      clientId: override.clientId,
      clientSecret: 'configured',
    };
  }

  async getProviderConfiguration(providerId: string): Promise<{
    provider: string;
    clientId: string | null;
    hasClientSecret: boolean;
    configuredBy: 'environment' | 'user';
    updatedAt: Date | null;
  }> {
    const base = this.requireProvider(providerId);
    const override = this.providerOverrides.get(providerId);

    if (override) {
      return {
        provider: providerId,
        clientId: override.clientId,
        hasClientSecret: true,
        configuredBy: 'user',
        updatedAt: override.updatedAt,
      };
    }

    const envClientId = base.clientId ?? null;
    const envClientSecret = base.clientSecret ?? null;
    const configuredBy = envClientId && envClientSecret ? 'environment' : 'user';

    return {
      provider: providerId,
      clientId: envClientId,
      hasClientSecret: Boolean(envClientSecret),
      configuredBy,
      updatedAt: null,
    };
  }

  async upsertProviderConfiguration(
    providerId: string,
    input: {
      clientId: string;
      clientSecret?: string;
    },
  ): Promise<void> {
    this.requireProvider(providerId);

    const trimmedClientId = input.clientId.trim();
    if (!trimmedClientId) {
      throw new BadRequestException('clientId is required');
    }

    const override = this.providerOverrides.get(providerId);
    const providedSecret = input.clientSecret?.trim();

    let secretMaterial: SecretEncryptionMaterial | null = null;
    if (providedSecret && providedSecret.length > 0) {
      secretMaterial = await this.encryption.encrypt(providedSecret);
    } else if (override) {
      secretMaterial = override.clientSecret;
    }

    if (!secretMaterial) {
      throw new BadRequestException('clientSecret is required');
    }

    const record = await this.repository.upsertProviderConfig({
      provider: providerId,
      clientId: trimmedClientId,
      clientSecret: secretMaterial,
    });

    this.providerOverrides.set(providerId, {
      provider: record.provider,
      clientId: record.clientId,
      clientSecret: record.clientSecret as SecretEncryptionMaterial,
      updatedAt: new Date(record.updatedAt),
    });
  }

  async deleteProviderConfiguration(providerId: string): Promise<void> {
    this.requireProvider(providerId);

    await this.repository.deleteProviderConfig(providerId);
    this.providerOverrides.delete(providerId);
  }

  /* ------------------------------------------------------------------ */
  /*  Connection listing                                                */
  /* ------------------------------------------------------------------ */

  async listConnections(userId: string, organizationId?: string): Promise<IntegrationConnection[]> {
    const records = await this.repository.listConnections(userId, organizationId);
    return records.map((record) => this.toConnection(record));
  }

  async listConnectionsForOrg(
    auth: AuthContext,
    provider?: string,
  ): Promise<IntegrationConnection[]> {
    const records = await this.repository.listConnectionsByOrg(auth.organizationId!, provider);
    return records.map((record) => this.toConnection(record));
  }

  /* ------------------------------------------------------------------ */
  /*  OAuth flow                                                        */
  /* ------------------------------------------------------------------ */

  async startOAuthSession(
    providerId: string,
    input: { userId: string; organizationId: string; redirectUri: string; scopes?: string[] },
  ): Promise<OAuthStartResponse> {
    const provider = await this.resolveProviderForAuth(providerId);

    const state = generateState();
    const scopes = this.normalizeScopes(input.scopes, provider);

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', scopes.join(provider.scopeSeparator));
    url.searchParams.set('state', state);

    let codeVerifier: string | undefined;
    if (provider.usesPkce) {
      codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    if (provider.extraAuthorizeParams) {
      for (const [key, value] of Object.entries(provider.extraAuthorizeParams)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    await this.repository.createOAuthState({
      state,
      userId: input.userId,
      provider: providerId,
      organizationId: input.organizationId,
      codeVerifier,
    });

    // OAuth states are short-lived (5 minutes) but we rely on DB TTL/cleanup.
    return {
      provider: providerId,
      authorizationUrl: url.toString(),
      state,
      expiresIn: 300,
    };
  }

  async completeOAuthSession(
    providerId: string,
    input: {
      state: string;
      code: string;
      redirectUri: string;
      scopes?: string[];
    },
  ): Promise<IntegrationConnection> {
    this.logger.log(
      `[completeOAuth] Starting exchange for provider=${providerId}, redirectUri=${input.redirectUri}`,
    );
    const provider = await this.resolveProviderForAuth(providerId);
    const stateRecord = await this.repository.consumeOAuthState(input.state);

    if (!stateRecord) {
      throw new BadRequestException('OAuth state is missing or has already been used');
    }
    if (stateRecord.provider !== providerId) {
      throw new BadRequestException('OAuth state does not match the provider');
    }

    // userId derived from the state record (created during startOAuth with auth context).
    // The exchange endpoint is @Public() — the one-time state token is the proof of identity.
    const userId = stateRecord.userId;
    const organizationId = stateRecord.organizationId ?? `workspace-${userId}`;
    const scopes = this.normalizeScopes(input.scopes, provider);

    this.logger.log(`[completeOAuth] Requesting tokens from ${provider.tokenUrl}`);
    const rawResponse = await this.requestTokens(provider, {
      grantType: 'authorization_code',
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: stateRecord.codeVerifier,
      scopes,
    });

    // For Slack, extract workspace name from the token response for a better display name
    const displayName = rawResponse?.team?.name ?? rawResponse?.team_name ?? providerId;

    // For Slack, fetch the workspace icon via team.info (best-effort, non-blocking)
    if (providerId === 'slack' && rawResponse?.access_token) {
      try {
        const teamInfo = await this.slackService.getTeamInfo(rawResponse.access_token);
        if (teamInfo.ok && teamInfo.icon) {
          rawResponse._teamIcon = teamInfo.icon;
        }
      } catch {
        // Non-critical — icon will simply be absent
      }
    }

    const previous = await this.repository.findByUserAndProvider(userId, providerId);
    const persisted = await this.persistTokenResponse({
      userId,
      organizationId,
      credentialType: 'oauth',
      displayName,
      provider,
      scopes,
      rawResponse,
      previous,
    });
    this.logger.log(`[completeOAuth] Connection persisted: ${persisted.id}`);

    this.emitConnectionEvent({
      connectionId: persisted.id,
      provider: providerId,
      credentialType: 'oauth',
      organizationId,
      userId,
      isReconnect: Boolean(previous),
    });

    return this.toConnection(persisted);
  }

  /* ------------------------------------------------------------------ */
  /*  Refresh & disconnect                                              */
  /* ------------------------------------------------------------------ */

  async refreshConnection(id: string, auth: AuthContext): Promise<IntegrationConnection> {
    const record = await this.assertConnectionOwnership(id, auth);
    const refreshed = await this.refreshTokenRecord(record);
    return this.toConnection(refreshed);
  }

  async disconnect(id: string, auth: AuthContext): Promise<void> {
    await this.assertConnectionOwnership(id, auth);

    if (!auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only admins can disconnect integrations');
    }

    await this.repository.deleteConnection(id);
  }

  /* ------------------------------------------------------------------ */
  /*  Token retrieval                                                   */
  /* ------------------------------------------------------------------ */

  async getProviderToken(providerId: string, userId: string): Promise<ProviderTokenResponse> {
    const record = await this.repository.findByUserAndProvider(userId, providerId);
    if (!record) {
      throw new NotFoundException(`No credentials found for provider ${providerId}`);
    }

    const provider = this.requireProvider(providerId);
    const hydratedRecord = await this.ensureFreshToken(record, provider);

    const accessToken = await this.encryption.decrypt(
      hydratedRecord.accessToken as SecretEncryptionMaterial,
    );

    return {
      provider: providerId,
      userId,
      accessToken,
      tokenType: hydratedRecord.tokenType ?? 'Bearer',
      scopes: hydratedRecord.scopes ?? [],
      expiresAt: this.parseDate(hydratedRecord.expiresAt),
    };
  }

  async getConnectionToken(connectionId: string): Promise<ProviderTokenResponse> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    const provider = this.requireProvider(record.provider);
    const hydratedRecord = await this.ensureFreshToken(record, provider);

    const accessToken = await this.encryption.decrypt(
      hydratedRecord.accessToken as SecretEncryptionMaterial,
    );

    return {
      provider: record.provider,
      userId: hydratedRecord.userId,
      accessToken,
      tokenType: hydratedRecord.tokenType ?? 'Bearer',
      scopes: hydratedRecord.scopes ?? [],
      expiresAt: this.parseDate(hydratedRecord.expiresAt),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  AWS connection                                                    */
  /* ------------------------------------------------------------------ */

  async getAwsSetupInfo(
    orgId: string,
    userId: string,
  ): Promise<{
    platformRoleArn: string;
    externalId: string;
    setupToken: string;
    trustPolicyTemplate: string;
    externalIdDisplay: string;
  }> {
    let platformRoleArn: string;
    try {
      platformRoleArn = this.awsService.getPlatformRoleArn();
    } catch {
      throw new BadRequestException(
        'AWS integration is not configured. Set the SHIPSEC_PLATFORM_ROLE_ARN environment variable and restart the backend.',
      );
    }
    const externalId = await this.getOrCreateAwsExternalId(userId);
    const setupToken = this.setupTokenService.generate(orgId, externalId);
    const trustPolicyTemplate = JSON.stringify(
      {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: platformRoleArn },
            Action: 'sts:AssumeRole',
            Condition: { StringEquals: { 'sts:ExternalId': externalId } },
          },
        ],
      },
      null,
      2,
    );
    return {
      platformRoleArn,
      externalId,
      setupToken,
      trustPolicyTemplate,
      externalIdDisplay: formatExternalIdForDisplay(externalId),
    };
  }

  private async getOrCreateAwsExternalId(userId: string): Promise<string> {
    const existing = await this.repository.getUserAwsExternalId(userId);
    if (existing) {
      return existing;
    }

    const fromConnection = await this.repository.findLatestAwsExternalIdFromConnections(userId);
    if (fromConnection) {
      await this.repository.insertUserAwsExternalId(userId, fromConnection);
      return fromConnection;
    }

    const generated = generateExternalId();
    const inserted = await this.repository.insertUserAwsExternalId(userId, generated);
    if (inserted) {
      return inserted;
    }

    const afterInsert = await this.repository.getUserAwsExternalId(userId);
    if (afterInsert) {
      return afterInsert;
    }

    this.logger.error(`[AWS] Failed to persist externalId for user ${userId}`);
    throw new BadRequestException('Unable to generate AWS ExternalId for this user');
  }

  async createAwsConnection(
    auth: AuthContext,
    input: CreateAwsConnectionDto,
  ): Promise<IntegrationConnection> {
    const orgId = auth.organizationId!;
    const userId = auth.userId!;
    const accountId = input.roleArn.match(/^arn:aws:iam::(\d{12}):role\/.+$/)?.[1];

    // Verify setup token — cryptographically binds externalId to this org
    this.setupTokenService.verify(input.setupToken, orgId, input.externalId);

    // Validate: can platform identity assume this role with this externalId?
    try {
      await this.awsService.assumeRoleWithPlatformIdentity(
        input.roleArn,
        input.externalId,
        input.region,
      );
    } catch (error: any) {
      const platformArn = this.awsService.getPlatformRoleArn();
      throw new BadRequestException(
        `Cannot assume role ${input.roleArn}. Ensure the trust policy includes: ` +
          `Principal {"AWS": "${platformArn}"} and Condition sts:ExternalId: "${input.externalId}". ` +
          `Error: ${error.message}`,
      );
    }

    if (accountId) {
      const existing = await this.repository.findAwsConnectionByAccountId(accountId);
      if (existing && existing.organizationId !== orgId) {
        throw new BadRequestException(
          `AWS account ${accountId} is already connected to another organization. Shared-account isolation is not supported in the current Cartography model.`,
        );
      }
    }

    // Store: roleArn + externalId + region only — no customer secrets
    const encryptedCreds = await this.encryption.encrypt(
      JSON.stringify({
        roleArn: input.roleArn,
        externalId: input.externalId,
        region: input.region,
      }),
    );

    const { record, isNew } = await this.repository.insertConnection({
      userId,
      provider: 'aws',
      organizationId: orgId,
      credentialType: 'iam_role',
      displayName: input.displayName,
      scopes: [],
      accessToken: encryptedCreds,
      refreshToken: null,
      tokenType: 'Bearer',
      expiresAt: null,
      lastValidatedAt: new Date(),
      lastValidationStatus: 'valid',
      metadata: {
        roleArn: input.roleArn,
        externalId: input.externalId,
        region: input.region ?? null,
        accountId: accountId ?? null,
      },
    });

    this.emitConnectionEvent({
      connectionId: record.id,
      provider: 'aws',
      credentialType: 'iam_role',
      organizationId: orgId,
      userId,
      isReconnect: !isNew,
      region: input.region,
    });

    return this.toConnection(record);
  }

  async listAwsAccountIdentifiersForOrg(organizationId: string): Promise<string[]> {
    const records = await this.repository.listConnectionsByOrg(organizationId, 'aws');
    const accountIds = new Set<string>();

    for (const record of records) {
      if (record.credentialType !== 'iam_role') continue;
      const metadata = this.coerceMetadata(record.metadata);

      const accountId =
        (typeof metadata.accountId === 'string' && metadata.accountId.trim()) ||
        (typeof metadata.roleArn === 'string'
          ? metadata.roleArn.match(/^arn:aws:iam::(\d{12}):role\/.+$/)?.[1]
          : undefined);

      if (accountId) {
        accountIds.add(accountId);
      }
    }

    return Array.from(accountIds);
  }

  /* ------------------------------------------------------------------ */
  /*  Slack webhook connection                                          */
  /* ------------------------------------------------------------------ */

  async createSlackWebhookConnection(
    auth: AuthContext,
    input: { displayName: string; webhookUrl: string },
  ): Promise<IntegrationConnection> {
    const userId = auth.userId!;
    const organizationId = auth.organizationId!;

    // Defense-in-depth: validate webhook URL domain even though DTO already validates
    this.slackService.assertSafeWebhookUrl(input.webhookUrl);

    // Encrypt the webhook URL as a JSON payload
    const encryptedCreds = await this.encryption.encrypt(
      JSON.stringify({ webhookUrl: input.webhookUrl }),
    );

    const { record, isNew } = await this.repository.insertConnection({
      userId,
      provider: 'slack',
      organizationId,
      credentialType: 'webhook',
      displayName: input.displayName,
      scopes: [],
      accessToken: encryptedCreds,
      refreshToken: null,
      tokenType: 'Bearer',
      expiresAt: null,
      metadata: {},
    });

    this.emitConnectionEvent({
      connectionId: record.id,
      provider: 'slack',
      credentialType: 'webhook',
      organizationId,
      userId,
      isReconnect: !isNew,
    });

    return this.toConnection(record);
  }

  async createJiraForgeConnection(
    auth: AuthContext,
    input: { displayName: string; webTriggerUrl: string; sharedSecret?: string },
  ): Promise<IntegrationConnection> {
    const userId = auth.userId!;
    const organizationId = auth.organizationId!;

    // Test the connection by calling the MCP initialize endpoint
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (input.sharedSecret) {
        headers['x-shipsec-secret'] = input.sharedSecret;
      }
      const testResponse = await fetch(input.webTriggerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      if (!testResponse.ok) {
        throw new BadRequestException(
          `Jira Forge app connection test failed: HTTP ${testResponse.status}`,
        );
      }
      const rpcResult = await testResponse.json();
      if (rpcResult.error) {
        throw new BadRequestException(
          `Jira Forge app connection test failed: ${rpcResult.error.message}`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `Could not connect to Jira Forge app: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Encrypt the credentials as a JSON payload
    const encryptedCreds = await this.encryption.encrypt(
      JSON.stringify({ webTriggerUrl: input.webTriggerUrl, sharedSecret: input.sharedSecret }),
    );

    const { record, isNew } = await this.repository.insertConnection({
      userId,
      provider: 'jira',
      organizationId,
      credentialType: 'forge_app',
      displayName: input.displayName,
      scopes: [],
      accessToken: encryptedCreds,
      refreshToken: null,
      tokenType: 'Bearer',
      expiresAt: null,
      metadata: {
        webTriggerUrl: input.webTriggerUrl,
        sharedSecret: input.sharedSecret || undefined,
      },
    });

    this.emitConnectionEvent({
      connectionId: record.id,
      provider: 'jira',
      credentialType: 'forge_app',
      organizationId,
      userId,
      isReconnect: !isNew,
    });

    return this.toConnection(record);
  }

  /* ------------------------------------------------------------------ */
  /*  Jira Forge auto-registration (called by Forge app on install)    */
  /* ------------------------------------------------------------------ */

  async autoRegisterJiraForge(input: {
    installationId: string;
    appId: string;
    appVersion: string;
    environmentId?: string;
    webTriggerUrl: string;
    installerAccountId?: string;
  }): Promise<void> {
    this.logger.log(`Auto-registering Jira Forge installation: ${input.installationId}`);

    // Test the connection
    try {
      const testResponse = await fetch(input.webTriggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      if (!testResponse.ok) {
        this.logger.warn(`Jira Forge connection test failed: HTTP ${testResponse.status}`);
      }
    } catch (err) {
      this.logger.warn(`Jira Forge connection test error: ${err}`);
    }

    // Encrypt the webTriggerUrl as the accessToken (same pattern as createJiraForgeConnection)
    const encryptedCreds = await this.encryption.encrypt(
      JSON.stringify({ webTriggerUrl: input.webTriggerUrl }),
    );

    const organizationId = DEFAULT_ORGANIZATION_ID;
    const userId = 'system';

    const { isNew } = await this.repository.insertConnection({
      userId,
      provider: 'jira',
      organizationId,
      credentialType: 'forge_app',
      displayName: 'Jira (auto-configured)',
      scopes: [],
      accessToken: encryptedCreds,
      refreshToken: null,
      tokenType: 'Bearer',
      expiresAt: null,
      metadata: {
        webTriggerUrl: input.webTriggerUrl,
        forgeInstallationId: input.installationId,
        forgeAppId: input.appId,
        forgeAppVersion: input.appVersion,
        forgeEnvironmentId: input.environmentId,
        autoRegistered: true,
      },
    });

    this.emitConnectionEvent({
      connectionId: input.installationId,
      provider: 'jira',
      credentialType: 'forge_app',
      organizationId,
      userId,
      isReconnect: !isNew,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Jira Forge discovery (zero-config via GraphQL API)               */
  /* ------------------------------------------------------------------ */

  async discoverJiraInstallation(siteHostname: string): Promise<{
    found: boolean;
    hostname?: string;
    environment?: string;
    webTriggerUrl?: string;
  }> {
    if (!this.forgeDiscovery.isConfigured()) {
      throw new BadRequestException(
        'Forge discovery is not configured (FORGE_EMAIL/FORGE_API_TOKEN missing)',
      );
    }

    const result = await this.forgeDiscovery.discoverForSite(siteHostname);
    if (!result) {
      return { found: false };
    }

    return {
      found: true,
      hostname: result.hostname,
      environment: result.environment,
      webTriggerUrl: result.webTriggerUrl ?? undefined,
    };
  }

  async connectJiraViaSiteDiscovery(
    auth: AuthContext,
    siteHostname: string,
  ): Promise<IntegrationConnection> {
    const discovery = await this.discoverJiraInstallation(siteHostname);
    if (!discovery.found || !discovery.webTriggerUrl) {
      throw new BadRequestException(
        discovery.found
          ? 'App is installed but web trigger URL could not be resolved'
          : `ShipSec.ai app not found on ${siteHostname}. Please install it first.`,
      );
    }

    // Create the connection using the existing method
    return this.createJiraForgeConnection(auth, {
      displayName: `Jira · ${discovery.hostname}`,
      webTriggerUrl: discovery.webTriggerUrl,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Connection validation                                             */
  /* ------------------------------------------------------------------ */

  async validateConnection(connectionId: string): Promise<{ valid: boolean; error?: string }> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    const decrypted = await this.encryption.decrypt(record.accessToken as SecretEncryptionMaterial);

    let result: { valid: boolean; error?: string };

    if (record.provider === 'aws' && record.credentialType === 'iam_role') {
      const creds = JSON.parse(decrypted);
      try {
        await this.awsService.assumeRoleWithPlatformIdentity(
          creds.roleArn,
          creds.externalId,
          creds.region,
        );
        result = { valid: true };
      } catch (error: any) {
        result = { valid: false, error: error.message };
      }
    } else if (record.provider === 'slack' && record.credentialType === 'webhook') {
      const creds = JSON.parse(decrypted);
      const webhookResult = await this.slackService.testWebhook(creds.webhookUrl);
      result = { valid: webhookResult.ok, error: webhookResult.error };
    } else if (record.provider === 'slack' && record.credentialType === 'oauth') {
      // Validate the OAuth bot token by calling Slack's auth.test API
      const authResult = await this.slackService.authTest(decrypted);
      result = { valid: authResult.ok, error: authResult.error };

      // Best-effort: enrich metadata with workspace icon if missing
      if (authResult.ok) {
        try {
          const existingMeta = this.coerceMetadata(record.metadata);
          const payload = (existingMeta.providerPayload ?? {}) as Record<string, any>;
          if (!payload._teamIcon) {
            const teamInfo = await this.slackService.getTeamInfo(decrypted);
            if (teamInfo.ok && teamInfo.icon) {
              payload._teamIcon = teamInfo.icon;
              const updatedMeta = { ...existingMeta, providerPayload: payload };
              await this.repository.updateConnectionHealth(connectionId, {
                lastValidatedAt: new Date(),
                lastValidationStatus: 'valid',
                metadata: updatedMeta,
              });
              return result;
            }
          }
        } catch {
          // Non-critical — icon enrichment failure doesn't affect validation
        }
      }
    } else {
      // For other types, we cannot generically validate; treat as valid.
      result = { valid: true };
    }

    // Update health fields
    await this.repository.updateConnectionHealth(connectionId, {
      lastValidatedAt: new Date(),
      lastValidationStatus: result.valid ? 'valid' : 'invalid',
      lastValidationError: result.error ?? null,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  AWS Org discovery                                                 */
  /* ------------------------------------------------------------------ */

  async discoverOrgAccounts(
    connectionId: string,
  ): Promise<{ accounts: { id: string; name: string; status: string; email: string }[] }> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    const decrypted = await this.encryption.decrypt(record.accessToken as SecretEncryptionMaterial);
    const creds = JSON.parse(decrypted);

    const assumed = await this.awsService.assumeRoleWithPlatformIdentity(
      creds.roleArn,
      creds.externalId,
      creds.region,
    );
    return this.awsService.discoverOrgAccounts({
      accessKeyId: assumed.accessKeyId,
      secretAccessKey: assumed.secretAccessKey,
      sessionToken: assumed.sessionToken,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Credential resolution (for worker / internal use)                 */
  /* ------------------------------------------------------------------ */

  async resolveConnectionCredentials(connectionId: string): Promise<{
    credentialType: string;
    provider: string;
    data: Record<string, unknown>;
    accountId?: string;
    region?: string;
    displayName?: string;
  }> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    let decrypted: string;
    try {
      decrypted = await this.encryption.decrypt(record.accessToken as SecretEncryptionMaterial);
    } catch (error: unknown) {
      const errorName = (error as { name?: string }).name ?? 'UnknownError';
      this.logger.error(
        `Failed to decrypt credentials for connection ${connectionId}: [${errorName}]`,
      );
      throw new UnprocessableEntityException(
        `Failed to decrypt credentials for connection ${connectionId}. The stored credentials may be corrupted or the encryption key may have changed.`,
      );
    }

    let data: Record<string, unknown>;
    let accountId: string | undefined;
    let region: string | undefined;

    switch (record.credentialType) {
      case 'oauth': {
        // Existing OAuth flow: decrypt + optional refresh, return access token
        const provider = this.providers[record.provider];
        let hydratedRecord = record;
        if (provider) {
          hydratedRecord = await this.ensureFreshToken(record, provider);
        }
        let accessToken: string;
        try {
          accessToken = await this.encryption.decrypt(
            hydratedRecord.accessToken as SecretEncryptionMaterial,
          );
        } catch (error: unknown) {
          const errorName = (error as { name?: string }).name ?? 'UnknownError';
          this.logger.error(
            `Failed to decrypt OAuth token for connection ${connectionId}: [${errorName}]`,
          );
          throw new UnprocessableEntityException(
            `Failed to decrypt OAuth token for connection ${connectionId}. The stored token may be corrupted or the encryption key may have changed.`,
          );
        }
        data = {
          accessToken,
          tokenType: hydratedRecord.tokenType ?? 'Bearer',
        };
        break;
      }
      case 'iam_role': {
        let creds: { roleArn: string; externalId: string; region?: string };
        try {
          creds = JSON.parse(decrypted);
        } catch {
          throw new UnprocessableEntityException(
            `Failed to parse IAM role credentials for connection ${connectionId}. The stored credentials are malformed.`,
          );
        }
        try {
          const assumed = await this.awsService.assumeRoleWithPlatformIdentity(
            creds.roleArn,
            creds.externalId,
            creds.region,
          );
          data = {
            accessKeyId: assumed.accessKeyId,
            secretAccessKey: assumed.secretAccessKey,
            sessionToken: assumed.sessionToken,
            region: creds.region,
          };
        } catch (error: unknown) {
          const errorName = (error as { name?: string }).name ?? 'Unknown';
          const errorCode = (error as { code?: string }).code ?? errorName;
          this.logger.error(
            `Failed to assume IAM role for connection ${connectionId}: [${errorCode}] ${errorName}`,
          );
          // Deterministic IAM errors that won't self-resolve — fail fast with 422
          const deterministic = new Set([
            'AccessDenied',
            'AccessDeniedException',
            'InvalidIdentityToken',
            'MalformedPolicyDocument',
            'PackedPolicyTooLarge',
            'RegionDisabledException',
          ]);
          if (deterministic.has(errorName) || deterministic.has(errorCode)) {
            throw new UnprocessableEntityException(
              `Failed to assume IAM role for connection ${connectionId}. Verify that the role ARN and external ID are correct and that the platform has permission to assume the role.`,
            );
          }
          // Transient errors (Throttling, ServiceUnavailable, network) — re-throw so NestJS returns 500 and worker retries
          throw error;
        }
        // Extract account ID from role ARN (arn:aws:iam::<account-id>:role/...)
        const arnMatch =
          typeof creds.roleArn === 'string' ? creds.roleArn.match(/^arn:aws:iam::(\d{12}):/) : null;
        accountId = arnMatch?.[1];
        region = creds.region ?? undefined;
        break;
      }
      case 'webhook': {
        let creds: { webhookUrl: string };
        try {
          creds = JSON.parse(decrypted);
        } catch {
          throw new UnprocessableEntityException(
            `Failed to parse webhook credentials for connection ${connectionId}. The stored credentials are malformed.`,
          );
        }
        data = {
          webhookUrl: creds.webhookUrl,
        };
        break;
      }
      default:
        throw new BadRequestException(`Unsupported credential type: ${record.credentialType}`);
    }

    // Update lastUsedAt
    await this.repository.updateLastUsedAt(connectionId);

    return {
      credentialType: record.credentialType,
      provider: record.provider,
      data,
      accountId,
      region,
      displayName: record.displayName ?? undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Ownership assertion                                               */
  /* ------------------------------------------------------------------ */

  async assertConnectionOwnership(
    connectionId: string,
    auth: AuthContext,
  ): Promise<IntegrationTokenRecord> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    if (record.organizationId !== auth.organizationId) {
      throw new ForbiddenException('You do not have access to this connection');
    }

    return record;
  }

  /**
   * Lightweight org check for internal (worker) endpoints.
   * If the caller provides an org ID, verify the connection belongs to that org.
   */
  async assertConnectionBelongsToOrg(connectionId: string, organizationId: string): Promise<void> {
    const record = await this.repository.findById(connectionId);
    if (!record) {
      throw new NotFoundException(`Connection ${connectionId} was not found`);
    }

    if (record.organizationId !== organizationId) {
      throw new ForbiddenException(
        `Connection ${connectionId} does not belong to organization ${organizationId}`,
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: event emission                                   */
  /* ------------------------------------------------------------------ */

  private emitConnectionEvent(params: {
    connectionId: string;
    provider: string;
    credentialType: string;
    organizationId: string;
    userId: string;
    isReconnect: boolean;
    region?: string;
  }): void {
    try {
      const event = new IntegrationConnectedEvent(
        params.connectionId,
        params.provider,
        params.credentialType,
        params.organizationId,
        params.userId,
        params.isReconnect,
        params.region,
      );
      this.eventEmitter.emit(IntegrationConnectedEvent.EVENT_NAME, event);
    } catch (error) {
      this.logger.error(
        `Failed to emit integration.connected event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: scopes                                           */
  /* ------------------------------------------------------------------ */

  private cleanScopes(scopes: string[]): string[] {
    return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean))).sort();
  }

  private parseScopeString(scope: string, separator: string): string[] {
    if (separator === ' ') {
      return this.cleanScopes(scope.split(/\s+/));
    }
    return this.cleanScopes(scope.split(separator));
  }

  private normalizeScopes(
    scopes: string[] | undefined,
    provider: IntegrationProviderConfig,
  ): string[] {
    const source = scopes && scopes.length > 0 ? scopes : provider.defaultScopes;
    return this.cleanScopes(source);
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: provider resolution                              */
  /* ------------------------------------------------------------------ */

  private async resolveProviderForAuth(providerId: string): Promise<ResolvedProviderConfig> {
    const base = this.requireProvider(providerId);
    const override = this.providerOverrides.get(providerId);

    const clientId = (override?.clientId ?? base.clientId ?? '').trim();
    const decryptedSecret = override
      ? await this.encryption.decrypt(override.clientSecret)
      : (base.clientSecret ?? '');
    const clientSecret = decryptedSecret.trim();

    if (!clientId || !clientSecret) {
      throw new BadRequestException(`Provider ${providerId} is not configured for OAuth`);
    }

    return {
      ...base,
      clientId,
      clientSecret,
    };
  }

  private requireProvider(providerId: string): IntegrationProviderConfig {
    const provider = this.providers[providerId];
    if (!provider) {
      throw new NotFoundException(`Unknown provider '${providerId}'`);
    }
    return provider;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: record ↔ connection mapping                      */
  /* ------------------------------------------------------------------ */

  private toConnection(record: IntegrationTokenRecord): IntegrationConnection {
    const provider = this.providers[record.provider];
    const providerName = provider?.name ?? record.provider;
    const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
    const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;

    return {
      id: record.id,
      provider: record.provider,
      providerName,
      userId: record.userId,
      credentialType: record.credentialType ?? 'oauth',
      displayName: record.displayName ?? record.provider,
      organizationId: record.organizationId,
      scopes: record.scopes ?? [],
      tokenType: record.tokenType ?? 'Bearer',
      expiresAt,
      lastValidatedAt: record.lastValidatedAt ? new Date(record.lastValidatedAt) : null,
      lastValidationStatus: record.lastValidationStatus ?? null,
      lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      status: isExpired ? 'expired' : 'active',
      supportsRefresh: provider?.supportsRefresh ?? false,
      hasRefreshToken: Boolean(record.refreshToken),
      metadata: this.coerceMetadata(record.metadata),
    };
  }

  private coerceMetadata(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }
    return metadata as Record<string, unknown>;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: PKCE                                             */
  /* ------------------------------------------------------------------ */

  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: token exchange                                   */
  /* ------------------------------------------------------------------ */

  private async requestTokens(
    provider: IntegrationProviderConfig,
    options: TokenRequestOptions,
  ): Promise<Record<string, any>> {
    if (!provider.clientId || !provider.clientSecret) {
      throw new BadRequestException(`Provider ${provider.id} is not configured for OAuth`);
    }

    const params: Record<string, string> = {
      grant_type: options.grantType,
      ...(provider.extraTokenParams ?? {}),
      ...(options.additionalParams ?? {}),
    };

    if (options.code) {
      params.code = options.code;
    }
    if (options.redirectUri) {
      params.redirect_uri = options.redirectUri;
    }
    if (options.refreshToken) {
      params.refresh_token = options.refreshToken;
    }
    if (options.codeVerifier) {
      params.code_verifier = options.codeVerifier;
    }
    if (options.scopes && options.scopes.length > 0) {
      params.scope = options.scopes.join(provider.scopeSeparator);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const bodyParams = { ...params };

    if (provider.tokenAuthMethod === 'client_secret_post') {
      bodyParams.client_id = provider.clientId;
      bodyParams.client_secret = provider.clientSecret;
    } else if (provider.tokenAuthMethod === 'client_secret_basic') {
      headers.Authorization = `Basic ${Buffer.from(
        `${provider.clientId}:${provider.clientSecret}`,
      ).toString('base64')}`;
      bodyParams.client_id = provider.clientId;
    }

    let response: Response;
    try {
      if (provider.tokenRequestEncoding === 'json') {
        headers['Content-Type'] = 'application/json';
        response = await fetch(provider.tokenUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyParams),
        });
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        response = await fetch(provider.tokenUrl, {
          method: 'POST',
          headers,
          body: new URLSearchParams(bodyParams).toString(),
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Token request to ${provider.id} failed: ${error.message ?? String(error)}`,
      );
      throw new BadRequestException(`Failed to contact ${provider.name} token endpoint`);
    }

    const rawPayload = await response.text();

    let payload: Record<string, any> = {};
    try {
      payload = rawPayload ? JSON.parse(rawPayload) : {};
    } catch {
      payload = Object.fromEntries(new URLSearchParams(rawPayload));
    }

    if (!response.ok) {
      const message =
        payload.error_description ??
        payload.error ??
        `${provider.name} token exchange failed with ${response.status}`;
      throw new BadRequestException(message);
    }

    return payload;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: persist & refresh token records                   */
  /* ------------------------------------------------------------------ */

  private async persistTokenResponse(input: {
    userId: string;
    organizationId: string;
    credentialType: string;
    displayName: string;
    provider: IntegrationProviderConfig;
    scopes: string[];
    rawResponse: Record<string, any>;
    previous?: IntegrationTokenRecord | undefined;
  }): Promise<IntegrationTokenRecord> {
    const accessToken = this.extractToken(input.rawResponse.access_token, 'access_token');
    const refreshToken = this.extractOptionalToken(input.rawResponse.refresh_token);
    const tokenType =
      typeof input.rawResponse.token_type === 'string'
        ? input.rawResponse.token_type
        : (input.previous?.tokenType ?? 'Bearer');

    const expiresAt = this.resolveExpiry(input.rawResponse.expires_in, input.previous?.expiresAt);
    const grantedScopes = this.resolveScopes(
      input.rawResponse.scope,
      input.scopes,
      input.provider.scopeSeparator,
    );

    const accessMaterial = await this.encryption.encrypt(accessToken);
    const refreshMaterial = refreshToken ? await this.encryption.encrypt(refreshToken) : null;

    const metadata = this.mergeMetadata(input.previous?.metadata, {
      providerPayload: this.safeProviderPayload(input.rawResponse),
      lastTokenSync: new Date().toISOString(),
      lastGrantType: 'authorization_code',
    });

    return this.repository.upsertConnection({
      userId: input.userId,
      organizationId: input.organizationId,
      credentialType: input.credentialType,
      displayName: input.displayName,
      provider: input.provider.id,
      scopes: grantedScopes,
      accessToken: accessMaterial,
      refreshToken: refreshMaterial,
      tokenType,
      expiresAt,
      metadata,
    });
  }

  private async refreshTokenRecord(
    record: IntegrationTokenRecord,
  ): Promise<IntegrationTokenRecord> {
    const provider = await this.resolveProviderForAuth(record.provider);

    if (!provider.supportsRefresh) {
      throw new BadRequestException(`${provider.name} tokens cannot be refreshed`);
    }
    if (!record.refreshToken) {
      throw new BadRequestException(`No refresh token stored for ${provider.name}`);
    }

    const refreshToken = await this.encryption.decrypt(
      record.refreshToken as SecretEncryptionMaterial,
    );

    const payload = await this.requestTokens(provider, {
      grantType: 'refresh_token',
      refreshToken,
      scopes: record.scopes ?? provider.defaultScopes,
    });

    const nextRefreshToken = this.extractOptionalToken(payload.refresh_token) ?? refreshToken;

    const accessToken = this.extractToken(payload.access_token, 'access_token');
    const tokenType =
      typeof payload.token_type === 'string' ? payload.token_type : (record.tokenType ?? 'Bearer');
    const expiresAt = this.resolveExpiry(payload.expires_in, record.expiresAt);

    const grantedScopes = this.resolveScopes(
      payload.scope,
      record.scopes ?? provider.defaultScopes,
      provider.scopeSeparator,
    );

    const accessMaterial = await this.encryption.encrypt(accessToken);
    const refreshMaterial = nextRefreshToken
      ? await this.encryption.encrypt(nextRefreshToken)
      : null;

    const metadata = this.mergeMetadata(record.metadata, {
      providerPayload: this.safeProviderPayload(payload),
      lastTokenSync: new Date().toISOString(),
      lastGrantType: 'refresh_token',
    });

    return this.repository.upsertConnection({
      userId: record.userId,
      organizationId: record.organizationId,
      credentialType: record.credentialType ?? 'oauth',
      displayName: record.displayName ?? record.provider,
      provider: record.provider,
      scopes: grantedScopes,
      accessToken: accessMaterial,
      refreshToken: refreshMaterial,
      tokenType,
      expiresAt,
      metadata,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers: token extraction & expiry                        */
  /* ------------------------------------------------------------------ */

  private extractToken(value: unknown, field: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    throw new BadRequestException(`OAuth provider did not return a valid ${field}`);
  }

  private extractOptionalToken(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    return null;
  }

  private resolveExpiry(expiresIn: unknown, fallback?: Date | string | null): Date | null {
    const parsed =
      typeof expiresIn === 'number'
        ? expiresIn
        : typeof expiresIn === 'string'
          ? Number(expiresIn)
          : null;

    if (parsed && Number.isFinite(parsed)) {
      return new Date(Date.now() + parsed * 1000);
    }

    if (!fallback) {
      return null;
    }

    return new Date(fallback);
  }

  private resolveScopes(scopeValue: unknown, defaults: string[], separator: string): string[] {
    if (typeof scopeValue !== 'string' || scopeValue.trim().length === 0) {
      return this.cleanScopes(defaults);
    }

    return this.parseScopeString(scopeValue, separator);
  }

  private mergeMetadata(
    existing: unknown,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...this.coerceMetadata(existing),
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    };
  }

  private safeProviderPayload(payload: Record<string, any>): Record<string, unknown> {
    const { access_token, refresh_token, id_token, ...rest } = payload;
    return rest;
  }

  private async ensureFreshToken(
    record: IntegrationTokenRecord,
    provider: IntegrationProviderConfig,
  ): Promise<IntegrationTokenRecord> {
    if (this.shouldRefreshToken(record, provider)) {
      return this.refreshTokenRecord(record);
    }
    return record;
  }

  private shouldRefreshToken(
    record: IntegrationTokenRecord,
    provider: IntegrationProviderConfig,
  ): boolean {
    if (!provider.supportsRefresh || !record.refreshToken) {
      return false;
    }

    const expiresAt = this.parseDate(record.expiresAt);
    if (!expiresAt) {
      return false;
    }

    return expiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;
  }

  private parseDate(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp);
  }
}
