import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  SecretEncryptionMaterial,
} from '@shipsec/shared';
import { randomBytes, createHash } from 'crypto';

import {
  IntegrationProviderConfig,
  IntegrationProviderSummary,
  generateState,
  loadIntegrationProviders,
  summarizeProvider,
} from './integration-providers';
import { IntegrationsRepository } from './integrations.repository';
import { TokenEncryptionService } from './token.encryption';
import type { IntegrationTokenRecord } from '../database/schema';

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
  scopes: string[];
  tokenType: string;
  expiresAt: Date | null;
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
  ) {
    this.providers = loadIntegrationProviders();
  }

  async onModuleInit(): Promise<void> {
    await this.reloadProviderOverrides();
  }

  listProviders(): IntegrationProviderSummary[] {
    return Object.values(this.providers).map((config) => summarizeProvider(this.mergeProviderConfig(config)));
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

  async upsertProviderConfiguration(providerId: string, input: {
    clientId: string;
    clientSecret?: string;
  }): Promise<void> {
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

  async listConnections(userId: string): Promise<IntegrationConnection[]> {
    const records = await this.repository.listConnections(userId);
    return records.map((record) => this.toConnection(record));
  }

  async startOAuthSession(
    providerId: string,
    input: { userId: string; redirectUri: string; scopes?: string[] },
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
      userId: string;
      state: string;
      code: string;
      redirectUri: string;
      scopes?: string[];
    },
  ): Promise<IntegrationConnection> {
    const provider = await this.resolveProviderForAuth(providerId);
    const stateRecord = await this.repository.consumeOAuthState(input.state);

    if (!stateRecord) {
      throw new BadRequestException('OAuth state is missing or has already been used');
    }
    if (stateRecord.userId !== input.userId) {
      throw new BadRequestException('OAuth state does not match the requesting user');
    }
    if (stateRecord.provider !== providerId) {
      throw new BadRequestException('OAuth state does not match the provider');
    }

    const scopes = this.normalizeScopes(input.scopes, provider);

    const rawResponse = await this.requestTokens(provider, {
      grantType: 'authorization_code',
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: stateRecord.codeVerifier,
      scopes,
    });

    const persisted = await this.persistTokenResponse({
      userId: input.userId,
      provider,
      scopes,
      rawResponse,
      previous: await this.repository.findByProvider(input.userId, providerId),
    });

    return this.toConnection(persisted);
  }

  async refreshConnection(id: string, userId: string): Promise<IntegrationConnection> {
    const record = await this.repository.findById(id);
    if (!record || record.userId !== userId) {
      throw new NotFoundException(`Connection ${id} was not found for user ${userId}`);
    }

    const refreshed = await this.refreshTokenRecord(record);
    return this.toConnection(refreshed);
  }

  async disconnect(id: string, userId: string): Promise<void> {
    await this.repository.deleteConnection(id, userId);
  }

  async getProviderToken(providerId: string, userId: string): Promise<ProviderTokenResponse> {
    const record = await this.repository.findByProvider(userId, providerId);
    if (!record) {
      throw new NotFoundException(`No credentials found for provider ${providerId}`);
    }

    let hydratedRecord = record;
    const provider = this.requireProvider(providerId);
    const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;

    if (
      expiresAt &&
      provider.supportsRefresh &&
      record.refreshToken &&
      expiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS
    ) {
      hydratedRecord = await this.refreshTokenRecord(record);
    }

    const accessToken = await this.encryption.decrypt(
      hydratedRecord.accessToken as SecretEncryptionMaterial,
    );

    return {
      provider: providerId,
      userId,
      accessToken,
      tokenType: hydratedRecord.tokenType ?? 'Bearer',
      scopes: hydratedRecord.scopes ?? [],
      expiresAt: hydratedRecord.expiresAt ? new Date(hydratedRecord.expiresAt) : null,
    };
  }

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

  private async resolveProviderForAuth(providerId: string): Promise<IntegrationProviderConfig> {
    const base = this.requireProvider(providerId);
    const override = this.providerOverrides.get(providerId);

    const clientId = override?.clientId ?? base.clientId ?? null;
    const clientSecret = override
      ? await this.encryption.decrypt(override.clientSecret)
      : base.clientSecret ?? null;

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

  private toConnection(record: IntegrationTokenRecord): IntegrationConnection {
    const provider = this.requireProvider(record.provider);
    const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
    const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;

    return {
      id: record.id,
      provider: record.provider,
      providerName: provider.name,
      userId: record.userId,
      scopes: record.scopes ?? [],
      tokenType: record.tokenType ?? 'Bearer',
      expiresAt,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      status: isExpired ? 'expired' : 'active',
      supportsRefresh: provider.supportsRefresh,
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

  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

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

  private async persistTokenResponse(input: {
    userId: string;
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
        : input.previous?.tokenType ?? 'Bearer';

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

    const nextRefreshToken =
      this.extractOptionalToken(payload.refresh_token) ?? refreshToken;

    const accessToken = this.extractToken(payload.access_token, 'access_token');
    const tokenType =
      typeof payload.token_type === 'string'
        ? payload.token_type
        : record.tokenType ?? 'Bearer';
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
      provider: record.provider,
      scopes: grantedScopes,
      accessToken: accessMaterial,
      refreshToken: refreshMaterial,
      tokenType,
      expiresAt,
      metadata,
    });
  }

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

  private resolveExpiry(
    expiresIn: unknown,
    fallback?: Date | string | null,
  ): Date | null {
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

  private resolveScopes(
    scopeValue: unknown,
    defaults: string[],
    separator: string,
  ): string[] {
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
      ...(this.coerceMetadata(existing)),
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    };
  }

  private safeProviderPayload(payload: Record<string, any>): Record<string, unknown> {
    const { access_token, refresh_token, id_token, ...rest } = payload;
    return rest;
  }
}
