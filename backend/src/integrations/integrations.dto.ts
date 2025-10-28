import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class StartOAuthDto {
  @ApiProperty({ description: 'Application user identifier to associate the connection with' })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({ description: 'Frontend callback URL that receives the OAuth code' })
  @IsString()
  @IsUrl()
  redirectUri!: string;

  @ApiPropertyOptional({ description: 'Optional override of scopes to request', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

export class CompleteOAuthDto extends StartOAuthDto {
  @ApiProperty({ description: 'Opaque OAuth state returned from the authorize redirect' })
  @IsString()
  @MinLength(1)
  state!: string;

  @ApiProperty({ description: 'Authorization code issued by the provider' })
  @IsString()
  @MinLength(1)
  code!: string;
}

export class RefreshConnectionDto {
  @ApiProperty({ description: 'Application user identifier that owns the connection' })
  @IsString()
  @MinLength(1)
  userId!: string;
}

export class DisconnectConnectionDto {
  @ApiProperty({ description: 'Application user identifier that owns the connection' })
  @IsString()
  @MinLength(1)
  userId!: string;
}

export class UpsertProviderConfigDto {
  @ApiProperty({ description: 'OAuth client identifier used for this provider' })
  @IsString()
  @MinLength(1)
  clientId!: string;

  @ApiPropertyOptional({
    description: 'OAuth client secret. Required when configuring the provider for the first time.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  clientSecret?: string;
}

export class ProviderConfigurationResponse {
  @ApiProperty()
  provider!: string;

  @ApiPropertyOptional({ description: 'Stored OAuth client identifier' })
  clientId?: string | null;

  @ApiProperty({ description: 'True when a client secret has been stored for this provider' })
  hasClientSecret!: boolean;

  @ApiProperty({
    enum: ['environment', 'user'],
    description: 'Origin of the credential configuration',
  })
  configuredBy!: 'environment' | 'user';

  @ApiPropertyOptional({ description: 'Last update timestamp in ISO 8601 format' })
  updatedAt?: string | null;
}

export class IntegrationProviderResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional()
  docsUrl?: string;

  @ApiProperty({ type: [String] })
  defaultScopes!: string[];

  @ApiProperty()
  supportsRefresh!: boolean;

  @ApiProperty({
    description: 'Indicates whether the provider has been configured with client credentials',
  })
  isConfigured!: boolean;
}

export class OAuthStartResponseDto {
  @ApiProperty()
  provider!: string;

  @ApiProperty()
  authorizationUrl!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty({ description: 'Suggested client-side TTL for the authorization URL', example: 300 })
  expiresIn!: number;
}

export class IntegrationConnectionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  providerName!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty()
  tokenType!: string;

  @ApiPropertyOptional()
  expiresAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ enum: ['active', 'expired'] })
  status!: 'active' | 'expired';

  @ApiProperty()
  supportsRefresh!: boolean;

  @ApiProperty()
  hasRefreshToken!: boolean;

  @ApiPropertyOptional({ description: 'Provider-specific metadata saved alongside the connection' })
  metadata?: Record<string, unknown>;
}
