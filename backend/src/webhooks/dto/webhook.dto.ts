import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  WebhookConfigurationSchema,
  WebhookDeliverySchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
  TestWebhookScriptSchema,
  TestWebhookScriptResponseSchema,
  type CreateWebhook,
  type UpdateWebhook,
  type TestWebhookScript,
} from '@shipsec/shared';

// Existing DTO for backward compatibility
export const WebhookRunWorkflowSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  versionId: z.string().optional(),
  version: z.number().int().optional(),
});

export class WebhookRunWorkflowDto extends createZodDto(WebhookRunWorkflowSchema) {}

// Smart Webhooks DTOs

// Request DTOs
export const CreateWebhookRequestSchema = CreateWebhookSchema;
export const UpdateWebhookRequestSchema = UpdateWebhookSchema;
export const TestWebhookScriptRequestSchema = TestWebhookScriptSchema;

export class CreateWebhookRequestDto extends createZodDto(CreateWebhookRequestSchema) {}
export class UpdateWebhookRequestDto extends createZodDto(UpdateWebhookRequestSchema) {}
export class TestWebhookScriptRequestDto extends createZodDto(TestWebhookScriptRequestSchema) {}

// Response DTOs
export const WebhookConfigurationResponseSchema = WebhookConfigurationSchema;
export const WebhookDeliveryResponseSchema = WebhookDeliverySchema;

export class WebhookConfigurationResponseDto extends createZodDto(
  WebhookConfigurationResponseSchema,
) {}
export class WebhookDeliveryResponseDto extends createZodDto(WebhookDeliveryResponseSchema) {}
export class TestWebhookScriptResponseDto extends createZodDto(TestWebhookScriptResponseSchema) {}

// Additional DTOs
export const RegeneratePathResponseSchema = z.object({
  id: z.string().uuid(),
  webhookPath: z.string().startsWith('wh_'),
  url: z.string().url(),
});

export const GetWebhookUrlResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  webhookPath: z.string().startsWith('wh_'),
  url: z.string().url(),
});

export class RegeneratePathResponseDto extends createZodDto(RegeneratePathResponseSchema) {}
export class GetWebhookUrlResponseDto extends createZodDto(GetWebhookUrlResponseSchema) {}

// Types
export type CreateWebhookRequest = CreateWebhook;
export type UpdateWebhookRequest = UpdateWebhook;
export type TestWebhookScriptRequest = TestWebhookScript;
