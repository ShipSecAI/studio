import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  type WebhookConfiguration,
  type WebhookDelivery,
  type TestWebhookScriptResponse,
  type WebhookUrlResponse,
} from '@shipsec/shared';
import type { AuthContext } from '../auth/types';
import { WorkflowsService } from '../workflows/workflows.service';
import { TemporalService } from '../temporal/temporal.service';
import { WebhookRepository } from './repository/webhook.repository';
import { WebhookDeliveryRepository } from './repository/webhook-delivery.repository';
import type { WebhookConfigurationRecord, WebhookDeliveryRecord } from '../database/schema';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'https://api.shipsec.ai';
const WEBHOOK_PATH_PREFIX = 'wh_';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly repository: WebhookRepository,
    private readonly deliveryRepository: WebhookDeliveryRepository,
    private readonly workflowsService: WorkflowsService,
    private readonly temporalService: TemporalService,
  ) {}

  // Management methods (auth required)

  async list(auth: AuthContext | null): Promise<WebhookConfiguration[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.list({ organizationId });
    return records.map((r) => this.mapConfigurationRecord(r));
  }

  async get(auth: AuthContext | null, id: string): Promise<WebhookConfiguration> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findById(id, { organizationId });
    if (!record) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }
    return this.mapConfigurationRecord(record);
  }

  async create(
    auth: AuthContext | null,
    dto: {
      workflowId: string;
      workflowVersionId?: string;
      name: string;
      description?: string;
      parsingScript: string;
      expectedInputs: {
        id: string;
        label: string;
        type: string;
        required: boolean;
        description?: string;
      }[];
    },
  ): Promise<WebhookConfiguration> {
    // Validate workflow exists and user has admin access
    await this.workflowsService.ensureWorkflowAdminAccess(dto.workflowId, auth);

    // Get organization ID
    const organizationId = this.requireOrganizationId(auth);

    // Generate unique webhook path
    const webhookPath = this.generateWebhookPath();

    // Validate expected inputs against workflow's entry point
    await this.validateExpectedInputs(dto.workflowId, dto.expectedInputs, auth);

    const record = await this.repository.create({
      workflowId: dto.workflowId,
      workflowVersionId: dto.workflowVersionId ?? null,
      workflowVersion: null,
      name: dto.name,
      description: dto.description ?? null,
      webhookPath,
      parsingScript: dto.parsingScript,
      expectedInputs: dto.expectedInputs as any,
      status: 'active',
      organizationId,
      createdBy: auth?.userId ?? 'system',
    });

    this.logger.log(`Created webhook ${record.id} for workflow ${dto.workflowId}`);
    return this.mapConfigurationRecord(record);
  }

  async update(
    auth: AuthContext | null,
    id: string,
    dto: {
      workflowId?: string;
      workflowVersionId?: string;
      name?: string;
      description?: string;
      parsingScript?: string;
      expectedInputs?: {
        id: string;
        label: string;
        type: string;
        required: boolean;
        description?: string;
      }[];
      status?: 'active' | 'inactive';
    },
  ): Promise<WebhookConfiguration> {
    const existing = await this.repository.findById(id, { organizationId: auth?.organizationId });
    if (!existing) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }

    // Check access to workflow
    const workflowId = dto.workflowId ?? existing.workflowId;
    await this.workflowsService.ensureWorkflowAdminAccess(workflowId, auth);

    // Validate expected inputs if provided
    if (dto.expectedInputs) {
      await this.validateExpectedInputs(workflowId, dto.expectedInputs, auth);
    }

    const updated = await this.repository.update(
      id,
      {
        workflowId: dto.workflowId,
        workflowVersionId: dto.workflowVersionId ?? null,
        name: dto.name,
        description: dto.description !== undefined ? dto.description : undefined,
        parsingScript: dto.parsingScript,
        expectedInputs: dto.expectedInputs as any,
        status: dto.status,
      },
      { organizationId: auth?.organizationId },
    );

    if (!updated) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }

    this.logger.log(`Updated webhook ${id}`);
    return this.mapConfigurationRecord(updated);
  }

  async delete(auth: AuthContext | null, id: string): Promise<void> {
    const existing = await this.repository.findById(id, { organizationId: auth?.organizationId });
    if (!existing) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }

    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);

    await this.repository.delete(id, { organizationId: auth?.organizationId });
    this.logger.log(`Deleted webhook ${id}`);
  }

  async regeneratePath(auth: AuthContext | null, id: string): Promise<WebhookUrlResponse> {
    const existing = await this.repository.findById(id, { organizationId: auth?.organizationId });
    if (!existing) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }

    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);

    const newPath = this.generateWebhookPath();
    const updated = await this.repository.update(
      id,
      { webhookPath: newPath },
      { organizationId: auth?.organizationId },
    );

    if (!updated) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }

    this.logger.log(`Regenerated path for webhook ${id}: ${newPath}`);
    return {
      id: updated.id,
      name: updated.name,
      webhookPath: updated.webhookPath,
      url: this.buildWebhookUrl(updated.webhookPath),
    };
  }

  async getUrl(auth: AuthContext | null, id: string): Promise<WebhookUrlResponse> {
    const webhook = await this.get(auth, id);
    return {
      id: webhook.id,
      name: webhook.name,
      webhookPath: webhook.webhookPath,
      url: this.buildWebhookUrl(webhook.webhookPath),
    };
  }

  // Test parsing script

  async testParsingScript(
    auth: AuthContext | null,
    dto: {
      parsingScript: string;
      testPayload: Record<string, unknown>;
      testHeaders?: Record<string, string>;
      webhookId?: string; // Optional: validate against existing webhook's expected inputs
    },
  ): Promise<TestWebhookScriptResponse> {
    try {
      // Execute the parsing script
      const parsedData = await this.executeParsingScript(
        dto.parsingScript,
        dto.testPayload,
        dto.testHeaders ?? {},
      );

      // If webhookId provided, validate against expected inputs
      let validationErrors: { inputId: string; message: string }[] | undefined;
      if (dto.webhookId) {
        const webhook = await this.repository.findById(dto.webhookId, {
          organizationId: auth?.organizationId,
        });
        if (webhook) {
          validationErrors = this.validateParsedData(webhook.expectedInputs as any, parsedData);
        }
      }

      return {
        success: validationErrors === undefined || validationErrors.length === 0,
        parsedData,
        errorMessage: null,
        validationErrors,
      };
    } catch (error) {
      this.logger.error(`Parsing script test failed: ${error}`);
      return {
        success: false,
        parsedData: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        validationErrors: undefined,
      };
    }
  }

  // Delivery history

  async listDeliveries(auth: AuthContext | null, webhookId: string): Promise<WebhookDelivery[]> {
    const webhook = await this.repository.findById(webhookId, {
      organizationId: auth?.organizationId,
    });
    if (!webhook) {
      throw new NotFoundException(`Webhook ${webhookId} not found`);
    }

    const records = await this.deliveryRepository.listByWebhookId(webhookId);
    return records.map((r) => this.mapDeliveryRecord(r));
  }

  async getDelivery(auth: AuthContext | null, deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException(`Delivery ${deliveryId} not found`);
    }

    // Verify access to the webhook
    const webhook = await this.repository.findById(delivery.webhookId, {
      organizationId: auth?.organizationId,
    });
    if (!webhook) {
      throw new NotFoundException(`Parent webhook not found`);
    }

    return this.mapDeliveryRecord(delivery);
  }

  // Public inbound webhook receiver (no auth)

  async receiveWebhook(
    path: string,
    req: { body: unknown; headers: Record<string, string> },
  ): Promise<{ status: string; runId?: string }> {
    // Look up webhook by path
    const webhook = await this.repository.findByPath(path);
    if (!webhook) {
      this.logger.warn(`Webhook path not found: ${path}`);
      throw new NotFoundException('Webhook not found');
    }

    if (webhook.status !== 'active') {
      this.logger.warn(`Webhook ${webhook.id} is not active`);
      throw new BadRequestException('Webhook is not active');
    }

    // Create delivery record
    const delivery = await this.deliveryRepository.create({
      webhookId: webhook.id,
      workflowRunId: null,
      status: 'processing',
      payload: typeof req.body === 'object' ? (req.body as any) : {},
      headers: req.headers,
      parsedData: null,
      errorMessage: null,
      createdAt: new Date(),
      completedAt: null,
    });

    this.logger.log(`Received webhook ${webhook.id}, delivery ${delivery.id}`);

    try {
      // Execute parsing script
      const parsedData = await this.executeParsingScript(
        webhook.parsingScript,
        typeof req.body === 'object' ? (req.body as any) : {},
        req.headers,
      );

      // Validate parsed data against expected inputs
      const validationErrors = this.validateParsedData(webhook.expectedInputs as any, parsedData);
      if (validationErrors.length > 0) {
        throw new BadRequestException(
          `Parsed data validation failed: ${validationErrors.map((e) => e.message).join(', ')}`,
        );
      }

      // Trigger workflow with organization context from webhook
      const triggerAuth: AuthContext = {
        userId: 'webhook-trigger',
        organizationId: webhook.organizationId,
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'internal',
      };

      const prepared = await this.workflowsService.prepareRunPayload(
        webhook.workflowId,
        {
          inputs: parsedData,
          versionId: webhook.workflowVersionId ?? undefined,
        },
        triggerAuth,
        {
          trigger: {
            type: 'webhook',
            sourceId: webhook.id,
            label: webhook.name,
          },
        },
      );

      const runResult = await this.workflowsService.startPreparedRun(prepared);

      // Update delivery as successful
      await this.deliveryRepository.update(delivery.id, {
        status: 'delivered',
        parsedData,
        workflowRunId: runResult.runId,
        completedAt: new Date(),
      });

      this.logger.log(
        `Webhook ${webhook.id} delivered: runId=${runResult.runId}, deliveryId=${delivery.id}`,
      );

      return { status: 'delivered', runId: runResult.runId };
    } catch (error) {
      // Update delivery as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deliveryRepository.update(delivery.id, {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      });

      this.logger.error(`Webhook ${webhook.id} failed: ${errorMessage}`);
      throw error;
    }
  }

  // Private methods

  private async executeParsingScript(
    script: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    // Backend must never execute Docker. Delegate parsing to Temporal worker.
    const ref = await this.temporalService.startWorkflow({
      workflowType: 'webhookParsingWorkflow',
      workflowId: `webhook-parse-${randomUUID()}`,
      taskQueue: this.temporalService.getDefaultTaskQueue(),
      args: [
        {
          parsingScript: script,
          payload,
          headers,
          timeoutSeconds: 30,
        },
      ],
    });

    const result = await this.temporalService.getWorkflowResult({
      workflowId: ref.workflowId,
      runId: ref.runId,
    });

    if (!result || typeof result !== 'object') {
      throw new Error('Parsing script returned invalid result (expected object)');
    }

    return result as Record<string, unknown>;
  }

  private validateParsedData(
    expectedInputs: { id: string; label: string; type: string; required: boolean }[],
    parsedData: Record<string, unknown>,
  ): { inputId: string; message: string }[] {
    const errors: { inputId: string; message: string }[] = [];

    for (const inputDef of expectedInputs) {
      const value = parsedData[inputDef.id];

      if (inputDef.required && (value === undefined || value === null)) {
        errors.push({
          inputId: inputDef.id,
          message: `Required input '${inputDef.label}' is missing`,
        });
      }
    }

    return errors;
  }

  private async validateExpectedInputs(
    workflowId: string,
    expectedInputs: { id: string; label: string; type: string; required: boolean }[],
    auth: AuthContext | null,
  ): Promise<void> {
    // Get the workflow definition to check entry point
    const context = await this.workflowsService.getCompiledWorkflowContext(workflowId, {}, auth);
    const definition = context.definition;

    const entryAction = definition.actions.find(
      (a) => a.componentId === 'core.workflow.entrypoint',
    );
    if (!entryAction) {
      throw new BadRequestException('Workflow must have an Entry Point component to use webhooks');
    }

    const runtimeInputs: { id?: string; required?: boolean }[] = Array.isArray(
      entryAction.params?.runtimeInputs,
    )
      ? entryAction.params.runtimeInputs
      : [];

    // Verify all expected inputs match entry point's runtime inputs
    for (const expectedInput of expectedInputs) {
      const matchingRuntimeInput = runtimeInputs.find((ri) => ri.id === expectedInput.id);
      if (!matchingRuntimeInput) {
        throw new BadRequestException(
          `Expected input '${expectedInput.id}' does not match any runtime input in the workflow's Entry Point`,
        );
      }
    }

    // Verify all required runtime inputs are covered
    for (const runtimeInput of runtimeInputs) {
      if (!runtimeInput.id) continue;
      if (runtimeInput.required !== false) {
        const matchingExpectedInput = expectedInputs.find((ei) => ei.id === runtimeInput.id);
        if (!matchingExpectedInput) {
          throw new BadRequestException(
            `Required runtime input '${runtimeInput.id}' from Entry Point is not covered by expected inputs`,
          );
        }
      }
    }
  }

  private generateWebhookPath(): string {
    // Generate a cryptographically random path with wh_ prefix
    return `${WEBHOOK_PATH_PREFIX}${randomUUID()}`;
  }

  private buildWebhookUrl(path: string): string {
    return `${WEBHOOK_BASE_URL}/webhooks/inbound/${path}`;
  }

  private mapConfigurationRecord(record: WebhookConfigurationRecord): WebhookConfiguration {
    return {
      id: record.id,
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId ?? null,
      workflowVersion: record.workflowVersion ?? null,
      name: record.name,
      description: record.description ?? null,
      webhookPath: record.webhookPath,
      parsingScript: record.parsingScript,
      expectedInputs: record.expectedInputs as any,
      status: record.status,
      organizationId: record.organizationId ?? null,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapDeliveryRecord(record: WebhookDeliveryRecord): WebhookDelivery {
    return {
      id: record.id,
      webhookId: record.webhookId,
      workflowRunId: record.workflowRunId ?? null,
      status: record.status,
      payload: record.payload,
      headers: record.headers ?? undefined,
      parsedData: record.parsedData ?? null,
      errorMessage: record.errorMessage ?? null,
      createdAt: record.createdAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
    };
  }

  private requireOrganizationId(auth: AuthContext | null): string {
    if (!auth?.organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return auth.organizationId;
  }
}
