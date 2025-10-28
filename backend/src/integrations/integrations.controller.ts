import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import {
  CompleteOAuthDto,
  DisconnectConnectionDto,
  IntegrationConnectionResponse,
  IntegrationProviderResponse,
  ProviderConfigurationResponse,
  OAuthStartResponseDto,
  RefreshConnectionDto,
  StartOAuthDto,
  UpsertProviderConfigDto,
} from './integrations.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

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

  @Get('connections')
  @ApiOkResponse({ type: [IntegrationConnectionResponse] })
  async listConnections(@Query('userId') userId?: string): Promise<IntegrationConnectionResponse[]> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const connections = await this.integrations.listConnections(userId);
    return connections.map((connection) => ({
      ...connection,
      expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    }));
  }

  @Post(':provider/start')
  @ApiOkResponse({ type: OAuthStartResponseDto })
  async startOAuth(
    @Param('provider') provider: string,
    @Body() body: StartOAuthDto,
  ): Promise<OAuthStartResponseDto> {
    const response = await this.integrations.startOAuthSession(provider, {
      userId: body.userId,
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

  @Post(':provider/exchange')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async completeOAuth(
    @Param('provider') provider: string,
    @Body() body: CompleteOAuthDto,
  ): Promise<IntegrationConnectionResponse> {
    const connection = await this.integrations.completeOAuthSession(provider, {
      userId: body.userId,
      code: body.code,
      state: body.state,
      redirectUri: body.redirectUri,
      scopes: body.scopes,
    });

    return {
      ...connection,
      expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }

  @Post('connections/:id/refresh')
  @ApiOkResponse({ type: IntegrationConnectionResponse })
  async refreshConnection(
    @Param('id') id: string,
    @Body() body: RefreshConnectionDto,
  ): Promise<IntegrationConnectionResponse> {
    const refreshed = await this.integrations.refreshConnection(id, body.userId);
    return {
      ...refreshed,
      expiresAt: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
      createdAt: refreshed.createdAt.toISOString(),
      updatedAt: refreshed.updatedAt.toISOString(),
    };
  }

  @Delete('connections/:id')
  @ApiOkResponse({ description: 'Connection removed' })
  async disconnectConnection(
    @Param('id') id: string,
    @Body() body: DisconnectConnectionDto,
  ): Promise<void> {
    await this.integrations.disconnect(id, body.userId);
  }
}
