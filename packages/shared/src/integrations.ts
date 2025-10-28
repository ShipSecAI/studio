import { z } from 'zod';

export const IntegrationStatusSchema = z.enum(['active', 'expired']);

export const IntegrationProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  docsUrl: z.string().url().optional(),
  defaultScopes: z.array(z.string()),
  supportsRefresh: z.boolean(),
  isConfigured: z.boolean(),
});

export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const IntegrationProviderConfigurationSchema = z.object({
  provider: z.string(),
  clientId: z.string().nullable(),
  hasClientSecret: z.boolean(),
  configuredBy: z.enum(['environment', 'user']),
  updatedAt: z.string().datetime().nullable(),
});

export type IntegrationProviderConfiguration = z.infer<typeof IntegrationProviderConfigurationSchema>;

export const IntegrationConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  providerName: z.string(),
  userId: z.string(),
  scopes: z.array(z.string()),
  tokenType: z.string(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: IntegrationStatusSchema,
  supportsRefresh: z.boolean(),
  hasRefreshToken: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

export const OAuthStartResponseSchema = z.object({
  provider: z.string(),
  authorizationUrl: z.string().url(),
  state: z.string(),
  expiresIn: z.number().int().positive(),
});

export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;

export const ProviderTokenResponseSchema = z.object({
  provider: z.string(),
  userId: z.string(),
  accessToken: z.string(),
  tokenType: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
});

export type ProviderTokenResponse = z.infer<typeof ProviderTokenResponseSchema>;
