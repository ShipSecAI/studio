import { z } from 'zod';
import { withPortMeta } from '@shipsec/component-sdk';
import { DestinationConfigSchema } from '@shipsec/shared';

export const awsCredentialContractName = 'core.credential.aws';
export const awsCredentialSchema = () =>
  withPortMeta(
    z.object({
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
      sessionToken: z.string().optional(),
      region: z.string().optional(),
    }),
    { schemaName: awsCredentialContractName, isCredential: true }
  );

export type AwsCredential = z.infer<ReturnType<typeof awsCredentialSchema>>;

export const llmProviderContractName = 'core.ai.llm-provider.v1';

const buildLlmProviderSchema = () =>
  z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('openai'),
      modelId: z.string(),
      apiKey: z.string().optional(),
      apiKeySecretId: z.string().optional(),
      baseUrl: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      provider: z.literal('gemini'),
      modelId: z.string(),
      apiKey: z.string().optional(),
      apiKeySecretId: z.string().optional(),
      baseUrl: z.string().optional(),
      projectId: z.string().optional(),
    }),
    z.object({
      provider: z.literal('openrouter'),
      modelId: z.string(),
      apiKey: z.string().optional(),
      apiKeySecretId: z.string().optional(),
      baseUrl: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      provider: z.literal('zai-coding-plan'),
      modelId: z.string(),
      apiKey: z.string().optional(),
      apiKeySecretId: z.string().optional(),
      baseUrl: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  ]);

export const LLMProviderSchema = () =>
  withPortMeta(buildLlmProviderSchema(), {
    schemaName: llmProviderContractName,
    isCredential: true,
  });

export type LlmProviderConfig = z.infer<ReturnType<typeof LLMProviderSchema>>;

export const mcpToolContractName = 'core.ai.mcp-tool.v1';

export const McpToolArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  required: z.boolean().default(true),
  enum: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .nonempty()
    .optional()
    .describe('Optional set of allowed values for dropdown-like arguments.'),
});

const buildMcpToolDefinitionSchema = () =>
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    endpoint: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    metadata: z
      .object({
        toolName: z.string().optional(),
        source: z.string().optional(),
      })
      .optional(),
    arguments: z.array(McpToolArgumentSchema).optional(),
  });

export const McpToolDefinitionSchema = () =>
  withPortMeta(buildMcpToolDefinitionSchema(), { schemaName: mcpToolContractName });

export type McpToolDefinition = z.infer<ReturnType<typeof McpToolDefinitionSchema>>;

export const consoleLogResultContractName = 'core.console-log.result.v1';
export const consoleLogResultSchema = () =>
  withPortMeta(
    z.object({
      logged: z.boolean(),
      preview: z.string(),
    }),
    { schemaName: consoleLogResultContractName }
  );

export type ConsoleLogResult = z.infer<ReturnType<typeof consoleLogResultSchema>>;

export const secretMetadataContractName = 'core.secret-fetch.metadata.v1';
export const secretMetadataSchema = () =>
  withPortMeta(
    z.object({
      secretId: z.string(),
      version: z.number(),
      format: z.enum(['raw', 'json']),
    }),
    { schemaName: secretMetadataContractName }
  );

export type SecretMetadata = z.infer<ReturnType<typeof secretMetadataSchema>>;

export const fileContractName = 'shipsec.file.v1';
export const fileContractSchema = () =>
  withPortMeta(
    z.object({
      id: z.string(),
      name: z.string(),
      mimeType: z.string(),
      size: z.number(),
      content: z.string(),
    }),
    { schemaName: fileContractName }
  );

export type FileContract = z.infer<ReturnType<typeof fileContractSchema>>;

export const destinationWriterContractName = 'destination.writer';
export const destinationWriterSchema = () =>
  withPortMeta(
    z.object(DestinationConfigSchema.shape),
    { schemaName: destinationWriterContractName }
  );

export type DestinationWriter = z.infer<ReturnType<typeof destinationWriterSchema>>;

export const manualApprovalPendingContractName = 'core.manual-approval.pending.v1';
export const manualApprovalPendingSchema = () =>
  withPortMeta(
    z.object({
      approved: z.boolean(),
      rejected: z.boolean(),
      respondedBy: z.string(),
      responseNote: z.string().optional(),
      respondedAt: z.string(),
      requestId: z.string(),
    }),
    { schemaName: manualApprovalPendingContractName }
  );

export type ManualApprovalPending = z.infer<ReturnType<typeof manualApprovalPendingSchema>>;

export const manualFormPendingContractName = 'core.manual-form.pending.v1';
export const manualFormPendingSchema = () =>
  withPortMeta(z.record(z.string(), z.any()), { schemaName: manualFormPendingContractName });

export type ManualFormPending = z.infer<ReturnType<typeof manualFormPendingSchema>>;

export const manualSelectionPendingContractName = 'core.manual-selection.pending.v1';
export const manualSelectionPendingSchema = () =>
  withPortMeta(
    z.object({
      selection: z.any(),
      approved: z.boolean(),
      rejected: z.boolean(),
      respondedBy: z.string(),
      responseNote: z.string().optional(),
      respondedAt: z.string(),
      requestId: z.string(),
    }),
    { schemaName: manualSelectionPendingContractName }
  );

export type ManualSelectionPending = z.infer<ReturnType<typeof manualSelectionPendingSchema>>;
