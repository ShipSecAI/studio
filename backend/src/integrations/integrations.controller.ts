import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthContext } from '../auth/types';
import { InternalOnly } from '../common/guards/internal-only.guard';

import {
  AwsSetupInfoResponseDto,
  CompleteOAuthDto,
  ConnectionCredentialsResponseDto,
  ConnectionTokenResponseDto,
  CreateAwsConnectionDto,
  CreateSlackWebhookConnectionDto,
  DiscoverOrgAccountsResponseDto,
  IntegrationConnectionResponse,
  IntegrationProviderResponse,
  OAuthStartResponseDto,
  ProviderConfigurationResponse,
  StartOAuthDto,
  UpsertProviderConfigDto,
  ValidateAwsResponseDto,
} from './integrations.dto';
import { IntegrationsService } from './integrations.service';
import type { IntegrationProviderDefinition } from './integration-catalog';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly integrations: IntegrationsService) {}

  /* ------------------------------------------------------------------ */
  /*  Provider catalog (D5)                                              */
  /* ------------------------------------------------------------------ */

  @Get('catalog')
  @ApiOkResponse({ description: 'Returns the integration provider catalog (AWS + Slack)' })
  getCatalog(): IntegrationProviderDefinition[] {
    return this.integrations.getCatalog();
  }

  /* ------------------------------------------------------------------ */
  /*  OAuth provider listing & configuration (existing, unchanged)       */
  /* ------------------------------------------------------------------ */

  @Get('providers')
  @ApiOkResponse({ type: [IntegrationProviderResponse] })
  listProviders(): IntegrationProviderResponse[] {
    return this.integrations.listProviders().map((provider) => ({
      ...provider,
    }));
  }

  @Get('providers/:provider/config')
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async getProviderConfiguration(
    @Param('provider') provider: string,
  ): Promise<ProviderConfigurationResponse> {
    const configuration = await this.integrations.getProviderConfiguration(provider);
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Put('providers/:provider/config')
  @ApiOkResponse({ type: ProviderConfigurationResponse })
  async upsertProviderConfiguration(
    @Param('provider') provider: string,
    @Body() body: UpsertProviderConfigDto,
  ): Promise<ProviderConfigurationResponse> {
    await this.integrations.upsertProviderConfiguration(provider, {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });

    const configuration = await this.integrations.getProviderConfiguration(provider);
    return {
      provider: configuration.provider,
      clientId: configuration.clientId,
      hasClientSecret: configuration.hasClientSecret,
      configuredBy: configuration.configuredBy,
      updatedAt: configuration.updatedAt ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Delete('providers/:provider/config')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProviderConfiguration(@Param('provider') provider: string): Promise<void> {
    await this.integrations.deleteProviderConfiguration(provider);
  }

  /* ------------------------------------------------------------------ */
  /*  Connection listing (D16: userId from auth, not query param)        */
  /* ------------------------------------------------------------------ */

  @Get('connections')
  @ApiOkResponse({ type: [IntegrationConnectionResponse] })
  async listConnections(
    @CurrentAuth() auth: AuthContext | null,
    @Query('userId') queryUserId?: string,
  ): Promise<IntegrationConnectionResponse[]> {
    if (queryUserId) {
      this.logger.warn(
        'Deprecated: userId query parameter is ignored. User is derived from auth context.',
      );
    }

    const userId = auth?.userId;
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    const connections = await this.integrations.listConnections(userId);
    return connections.map((c) => this.toConnectionResponse(c));
  }

  /* ------------------------------------------------------------------ */
  /*  Org-scoped connection listing (D6, D17)                           */
  /* ------------------------------------------------------------------ */

  @Get('org/connections')
  @ApiOkResponse({ type: [IntegrationConnectionResponse] })
  async listOrgConnections(
    @CurrentAuth() auth: AuthContext | null,
    @Query('provider') provider?: string,
  ): Promise<IntegrationConnectionResponse[]> {
    if (!auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    const connections = await this.integrations.listConnectionsForOrg(auth, provider);
    return connections.map((c) => this.toConnectionResponse(c));
  }

  /* ------------------------------------------------------------------ */
  /*  OAuth flow (D16: userId from auth context)                        */
  /* ------------------------------------------------------------------ */

  @Post(':provider/start')
  @ApiOkResponse({ type: OAuthStartResponseDto })
  async startOAuth(
    @Param('provider') provider: string,
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: StartOAuthDto,
  ): Promise<OAuthStartResponseDto> {
    if (!auth?.userId) {
      throw new BadRequestException('Authentication required');
    }

    const organizationId = auth.organizationId ?? `workspace-${auth.userId}`;

    const response = await this.integrations.startOAuthSession(provider, {
      userId: auth.userId,
      organizationId,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
    });

    return {
      provider: response.provider,
      authorizationUrl: response.authorizationUrl,
      state: response.state,
      expiresIn: response.expiresIn,
    };
  }

  @Public()
  @Post(':provider/exchange')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async completeOAuth(
    @Param('provider') provider: string,
    @Body() body: CompleteOAuthDto,
  ): Promise<IntegrationConnectionResponse> {
    // The exchange endpoint is @Public because the OAuth callback may arrive on a
    // different origin (e.g. ngrok) where the Clerk session cookie is unavailable.
    // Security is enforced by the one-time state token created during startOAuth,
    // which binds the exchange to a specific userId and provider.
    const connection = await this.integrations.completeOAuthSession(provider, {
      code: body.code,
      state: body.state,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
    });

    return this.toConnectionResponse(connection);
  }

  /* ------------------------------------------------------------------ */
  /*  Refresh & disconnect (D16 + D18)                                  */
  /* ------------------------------------------------------------------ */

  @Post('connections/:id/refresh')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async refreshConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<IntegrationConnectionResponse> {
    if (!auth?.userId) {
      throw new BadRequestException('Authentication required');
    }

    const refreshed = await this.integrations.refreshConnection(id, auth);
    return this.toConnectionResponse(refreshed);
  }

  @Delete('connections/:id')
  @ApiOkResponse({ description: 'Connection removed' })
  async disconnectConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<void> {
    if (!auth?.userId) {
      throw new BadRequestException('Authentication required');
    }

    await this.integrations.disconnect(id, auth);
  }

  /* ------------------------------------------------------------------ */
  /*  Internal token endpoint (D4: @InternalOnly replaces inline check) */
  /* ------------------------------------------------------------------ */

  @Post('connections/:id/token')
  @InternalOnly()
  @ApiOkResponse({ type: ConnectionTokenResponseDto })
  async issueConnectionToken(@Param('id') id: string): Promise<ConnectionTokenResponseDto> {
    const token = await this.integrations.getConnectionToken(id);
    return {
      provider: token.provider,
      userId: token.userId,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      scopes: token.scopes,
      expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Credential resolution — internal only (D3, D4)                    */
  /* ------------------------------------------------------------------ */

  @Post('connections/:id/credentials')
  @InternalOnly()
  @ApiOkResponse({ type: ConnectionCredentialsResponseDto })
  async resolveCredentials(@Param('id') id: string): Promise<ConnectionCredentialsResponseDto> {
    const result = await this.integrations.resolveConnectionCredentials(id);
    return {
      credentialType: result.credentialType,
      provider: result.provider,
      data: result.data,
      accountId: result.accountId,
      region: result.region,
      displayName: result.displayName,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  AWS setup info & connections                                      */
  /* ------------------------------------------------------------------ */

  @Get('aws/setup-info')
  @ApiOkResponse({ type: AwsSetupInfoResponseDto })
  async getAwsSetupInfo(@CurrentAuth() auth: AuthContext | null): Promise<AwsSetupInfoResponseDto> {
    if (!auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }
    return this.integrations.getAwsSetupInfo(auth.organizationId);
  }

  @Post('aws/connections')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async createAwsConnection(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateAwsConnectionDto,
  ): Promise<IntegrationConnectionResponse> {
    if (!auth?.userId || !auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    const connection = await this.integrations.createAwsConnection(auth, body);
    return this.toConnectionResponse(connection);
  }

  @Post('aws/connections/:id/validate')
  @ApiOkResponse({ type: ValidateAwsResponseDto })
  async validateAwsConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<ValidateAwsResponseDto> {
    if (!auth?.userId || !auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    await this.integrations.assertConnectionOwnership(id, auth);
    const result = await this.integrations.validateConnection(id);

    return {
      valid: result.valid,
      error: result.error,
    };
  }

  @Post('aws/connections/:id/discover-org')
  @ApiOkResponse({ type: DiscoverOrgAccountsResponseDto })
  async discoverOrgAccounts(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<DiscoverOrgAccountsResponseDto> {
    if (!auth?.userId || !auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    await this.integrations.assertConnectionOwnership(id, auth);
    const result = await this.integrations.discoverOrgAccounts(id);

    return {
      accounts: result.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        email: a.email,
      })),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Slack connections (chunk 8)                                       */
  /* ------------------------------------------------------------------ */

  @Post('slack/connections')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async createSlackWebhookConnection(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateSlackWebhookConnectionDto,
  ): Promise<IntegrationConnectionResponse> {
    if (!auth?.userId || !auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    const connection = await this.integrations.createSlackWebhookConnection(auth, body);
    return this.toConnectionResponse(connection);
  }

  @Post('slack/connections/:id/test')
  @ApiOkResponse({ description: 'Test result for Slack connection' })
  async testSlackConnection(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!auth?.userId || !auth?.organizationId) {
      throw new BadRequestException('Authentication with organization context required');
    }

    await this.integrations.assertConnectionOwnership(id, auth);
    return this.integrations.validateConnection(id);
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  private toConnectionResponse(connection: {
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
  }): IntegrationConnectionResponse {
    return {
      id: connection.id,
      provider: connection.provider,
      providerName: connection.providerName,
      userId: connection.userId,
      credentialType: connection.credentialType,
      displayName: connection.displayName,
      organizationId: connection.organizationId,
      scopes: connection.scopes,
      tokenType: connection.tokenType,
      expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      lastValidatedAt: connection.lastValidatedAt ? connection.lastValidatedAt.toISOString() : null,
      lastValidationStatus: connection.lastValidationStatus ?? null,
      lastUsedAt: connection.lastUsedAt ? connection.lastUsedAt.toISOString() : null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
      status: connection.status,
      supportsRefresh: connection.supportsRefresh,
      hasRefreshToken: connection.hasRefreshToken,
      metadata: connection.metadata,
    };
  }
}
