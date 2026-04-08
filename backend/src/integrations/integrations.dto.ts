import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const IntegrationCatalogOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export class IntegrationCatalogOptionDto extends createZodDto(IntegrationCatalogOptionSchema) {}

export const IntegrationCatalogFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'password', 'select']),
  required: z.boolean(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  options: z.array(IntegrationCatalogOptionSchema).optional(),
});

export class IntegrationCatalogFieldDto extends createZodDto(IntegrationCatalogFieldSchema) {}

export const IntegrationCatalogAuthMethodSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  fields: z.array(IntegrationCatalogFieldSchema),
});

export class IntegrationCatalogAuthMethodDto extends createZodDto(
  IntegrationCatalogAuthMethodSchema,
) {}

export const IntegrationCatalogInstructionSectionSchema = z.object({
  title: z.string(),
  authMethodType: z.string(),
  scenario: z.string(),
  steps: z.array(z.string()),
});

export class IntegrationCatalogInstructionSectionDto extends createZodDto(
  IntegrationCatalogInstructionSectionSchema,
) {}

export const IntegrationCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  docsUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  authMethods: z.array(IntegrationCatalogAuthMethodSchema),
  supportsMultipleConnections: z.boolean(),
  setupInstructions: z.object({
    sections: z.array(IntegrationCatalogInstructionSectionSchema),
  }),
});

export class IntegrationCatalogEntryDto extends createZodDto(IntegrationCatalogEntrySchema) {}
export type IntegrationCatalogEntry = z.infer<typeof IntegrationCatalogEntrySchema>;

// --- OAuth DTOs (D16: userId removed, derived from auth context) ---

export const StartOAuthSchema = z.object({
  redirectUri: z.string().url().describe('Frontend callback URL that receives the OAuth code'),
  scopes: z.array(z.string()).describe('Optional override of scopes to request').optional(),
});
export class StartOAuthDto extends createZodDto(StartOAuthSchema) {}

export const CompleteOAuthSchema = StartOAuthSchema.extend({
  state: z.string().min(1).describe('Opaque OAuth state returned from the authorize redirect'),
  code: z.string().min(1).describe('Authorization code issued by the provider'),
});
export class CompleteOAuthDto extends createZodDto(CompleteOAuthSchema) {}

// D16: userId removed from these DTOs — now derived from @CurrentAuth()
export const RefreshConnectionSchema = z.object({});
export class RefreshConnectionDto extends createZodDto(RefreshConnectionSchema) {}

export const DisconnectConnectionSchema = z.object({});
export class DisconnectConnectionDto extends createZodDto(DisconnectConnectionSchema) {}

// --- Provider config DTOs ---

export const UpsertProviderConfigSchema = z.object({
  clientId: z.string().min(1).describe('OAuth client identifier used for this provider'),
  clientSecret: z
    .string()
    .min(1)
    .describe('OAuth client secret. Required when configuring the provider for the first time.')
    .optional(),
});
export class UpsertProviderConfigDto extends createZodDto(UpsertProviderConfigSchema) {}

// --- AWS connection DTOs ---

export const CreateAwsConnectionSchema = z.object({
  displayName: z.string().min(1).describe('Display name for this connection'),
  roleArn: z
    .string()
    .regex(
      /^arn:aws:iam::\d{12}:role\/.+$/,
      'roleArn must be a valid IAM role ARN (arn:aws:iam::<account-id>:role/<role-name>)',
    )
    .describe('IAM role ARN for ShipSec to assume'),
  region: z.string().describe('Default AWS region').optional(),
  externalId: z.string().min(1).describe('External ID from setup-info endpoint'),
  setupToken: z.string().min(1).describe('Signed setup token from setup-info endpoint'),
});
export class CreateAwsConnectionDto extends createZodDto(CreateAwsConnectionSchema) {}

export const AwsSetupInfoResponseSchema = z.object({
  platformRoleArn: z.string(),
  externalId: z.string(),
  setupToken: z.string(),
  trustPolicyTemplate: z.string(),
  externalIdDisplay: z.string().optional(),
});
export class AwsSetupInfoResponseDto extends createZodDto(AwsSetupInfoResponseSchema) {}

// --- Slack connection DTOs ---

export const CreateSlackWebhookConnectionSchema = z.object({
  displayName: z.string().min(1).describe('Display name for this webhook connection'),
  webhookUrl: z
    .string()
    .regex(
      /^https:\/\/hooks\.slack\.com\//,
      'webhookUrl must be a valid Slack webhook URL (https://hooks.slack.com/...)',
    )
    .describe('Slack incoming webhook URL'),
});
export class CreateSlackWebhookConnectionDto extends createZodDto(
  CreateSlackWebhookConnectionSchema,
) {}

// --- Jira connection DTOs ---

export const CreateJiraForgeConnectionSchema = z.object({
  displayName: z.string().min(1).describe('Display name for this Jira connection'),
  webTriggerUrl: z.string().url().describe('Forge web trigger URL for the Jira installation'),
  sharedSecret: z.string().optional().describe('Optional HMAC shared secret'),
});
export class CreateJiraForgeConnectionDto extends createZodDto(CreateJiraForgeConnectionSchema) {}

// --- Response DTOs ---

export const ProviderConfigurationResponseSchema = z.object({
  provider: z.string(),
  clientId: z.string().nullable().describe('Stored OAuth client identifier').optional(),
  hasClientSecret: z
    .boolean()
    .describe('True when a client secret has been stored for this provider'),
  configuredBy: z.enum(['environment', 'user']).describe('Origin of the credential configuration'),
  updatedAt: z.string().nullable().describe('Last update timestamp in ISO 8601 format').optional(),
});
export class ProviderConfigurationResponse extends createZodDto(
  ProviderConfigurationResponseSchema,
) {}

export const IntegrationProviderResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  docsUrl: z.string().optional(),
  defaultScopes: z.array(z.string()),
  supportsRefresh: z.boolean(),
  isConfigured: z
    .boolean()
    .describe('Indicates whether the provider has been configured with client credentials'),
});
export class IntegrationProviderResponse extends createZodDto(IntegrationProviderResponseSchema) {}

export const OAuthStartResponseSchema = z.object({
  provider: z.string(),
  authorizationUrl: z.string(),
  state: z.string(),
  expiresIn: z.number().describe('Suggested client-side TTL for the authorization URL'),
});
export class OAuthStartResponseDto extends createZodDto(OAuthStartResponseSchema) {}

export const IntegrationConnectionResponseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  providerName: z.string(),
  userId: z.string(),
  credentialType: z.string(),
  displayName: z.string(),
  organizationId: z.string().optional(),
  scopes: z.array(z.string()),
  tokenType: z.string(),
  expiresAt: z.string().nullable().optional(),
  lastValidatedAt: z.string().nullable().optional(),
  lastValidationStatus: z.string().nullable().optional(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['active', 'expired']),
  supportsRefresh: z.boolean(),
  hasRefreshToken: z.boolean(),
  metadata: z
    .record(z.string(), z.unknown())
    .describe('Provider-specific metadata saved alongside the connection')
    .optional(),
});
export class IntegrationConnectionResponse extends createZodDto(
  IntegrationConnectionResponseSchema,
) {}

export const ConnectionTokenResponseSchema = z.object({
  provider: z.string(),
  userId: z.string(),
  accessToken: z.string(),
  tokenType: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable().optional(),
});
export class ConnectionTokenResponseDto extends createZodDto(ConnectionTokenResponseSchema) {}

export const ValidateAwsResponseSchema = z.object({
  valid: z.boolean(),
  accountId: z.string().optional(),
  arn: z.string().optional(),
  error: z.string().optional(),
});
export class ValidateAwsResponseDto extends createZodDto(ValidateAwsResponseSchema) {}

export const OrgAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  email: z.string().optional(),
});
export class OrgAccountDto extends createZodDto(OrgAccountSchema) {}

export const DiscoverOrgAccountsResponseSchema = z.object({
  accounts: z.array(OrgAccountSchema),
});
export class DiscoverOrgAccountsResponseDto extends createZodDto(
  DiscoverOrgAccountsResponseSchema,
) {}

export const ConnectionCredentialsResponseSchema = z.object({
  credentialType: z.string().describe('Credential type discriminator'),
  provider: z.string(),
  data: z.record(z.string(), z.unknown()).describe('Type-specific credential data'),
  accountId: z
    .string()
    .describe('Provider account identifier (e.g. AWS 12-digit account ID)')
    .optional(),
  region: z.string().describe('Default region from the connection').optional(),
  displayName: z.string().describe('Display name of the connection').optional(),
});
export class ConnectionCredentialsResponseDto extends createZodDto(
  ConnectionCredentialsResponseSchema,
) {}
