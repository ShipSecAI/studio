import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUrl, Matches, MinLength } from 'class-validator';

// --- OAuth DTOs (D16: userId removed, derived from auth context) ---

export class StartOAuthDto {
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

// D16: userId removed from these DTOs — now derived from @CurrentAuth()
export class RefreshConnectionDto {}

export class DisconnectConnectionDto {}

// --- Provider config DTOs ---

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

// --- AWS connection DTOs ---

export class CreateAwsConnectionDto {
  @ApiProperty({ description: 'Display name for this connection' })
  @IsString()
  @MinLength(1)
  displayName!: string;

  @ApiProperty({ description: 'IAM role ARN for ShipSec to assume' })
  @IsString()
  @Matches(/^arn:aws:iam::\d{12}:role\/.+$/, {
    message: 'roleArn must be a valid IAM role ARN (arn:aws:iam::<account-id>:role/<role-name>)',
  })
  roleArn!: string;

  @ApiPropertyOptional({ description: 'Default AWS region' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({ description: 'External ID from setup-info endpoint' })
  @IsString()
  @MinLength(1)
  externalId!: string;

  @ApiProperty({ description: 'Signed setup token from setup-info endpoint' })
  @IsString()
  @MinLength(1)
  setupToken!: string;
}

export class AwsSetupInfoResponseDto {
  @ApiProperty()
  platformRoleArn!: string;

  @ApiProperty()
  externalId!: string;

  @ApiProperty()
  setupToken!: string;

  @ApiProperty()
  trustPolicyTemplate!: string;

  @ApiPropertyOptional()
  externalIdDisplay?: string;
}

// --- Slack connection DTOs ---

export class CreateSlackWebhookConnectionDto {
  @ApiProperty({ description: 'Display name for this webhook connection' })
  @IsString()
  @MinLength(1)
  displayName!: string;

  @ApiProperty({ description: 'Slack incoming webhook URL' })
  @IsString()
  @IsUrl()
  webhookUrl!: string;
}

// --- Response DTOs ---

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

  @ApiProperty()
  credentialType!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional()
  organizationId?: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty()
  tokenType!: string;

  @ApiPropertyOptional()
  expiresAt?: string | null;

  @ApiPropertyOptional()
  lastValidatedAt?: string | null;

  @ApiPropertyOptional()
  lastValidationStatus?: string | null;

  @ApiPropertyOptional()
  lastUsedAt?: string | null;

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

export class ConnectionTokenResponseDto {
  @ApiProperty()
  provider!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  tokenType!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiPropertyOptional()
  expiresAt?: string | null;
}

export class ValidateAwsResponseDto {
  @ApiProperty()
  valid!: boolean;

  @ApiPropertyOptional()
  accountId?: string;

  @ApiPropertyOptional()
  arn?: string;

  @ApiPropertyOptional()
  error?: string;
}

export class OrgAccountDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  email?: string;
}

export class DiscoverOrgAccountsResponseDto {
  @ApiProperty({ type: [OrgAccountDto] })
  accounts!: OrgAccountDto[];
}

export class ConnectionCredentialsResponseDto {
  @ApiProperty({ description: 'Credential type discriminator' })
  credentialType!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ description: 'Type-specific credential data' })
  data!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Provider account identifier (e.g. AWS 12-digit account ID)',
  })
  accountId?: string;

  @ApiPropertyOptional({ description: 'Default region from the connection' })
  region?: string;

  @ApiPropertyOptional({ description: 'Display name of the connection' })
  displayName?: string;
}
