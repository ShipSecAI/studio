import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'bun:test';
import type { WebhookConfigurationRecord, WebhookDeliveryRecord } from '../../database/schema';
import type { AuthContext } from '../../auth/types';
import type { WorkflowDefinition } from '../../dsl/types';
import type { WebhookRepository } from '../repository/webhook.repository';
import type { WebhookDeliveryRepository } from '../repository/webhook-delivery.repository';
import { WebhooksService } from '../webhooks.service';
import type { WorkflowsService } from '../../workflows/workflows.service';
import type { TemporalService } from '../../temporal/temporal.service';

const authContext: AuthContext = {
  userId: 'admin-user',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'local',
  isAuthenticated: true,
};

const workflowDefinition: WorkflowDefinition = {
  version: 2,
  title: 'Webhook workflow',
  description: 'Workflow with entry point for webhooks',
  entrypoint: { ref: 'entry' },
  nodes: {},
  edges: [],
  dependencyCounts: {
    entry: 0,
  },
  actions: [
    {
      ref: 'entry',
      componentId: 'core.workflow.entrypoint',
      params: {
        runtimeInputs: [
          { id: 'prTitle', label: 'PR Title', type: 'text', required: true },
          { id: 'prNumber', label: 'PR Number', type: 'number', required: true },
          { id: 'environment', label: 'Environment', type: 'text', required: false },
        ],
      },
      inputOverrides: {},
      dependsOn: [],
      inputMappings: {},
    },
  ],
  config: {
    environment: 'default',
    timeoutSeconds: 0,
  },
};

const makeWebhookRecord = (
  overrides: Partial<WebhookConfigurationRecord> = {},
): WebhookConfigurationRecord => {
  const now = new Date();
  return {
    id: overrides.id ?? 'webhook-1',
    workflowId: overrides.workflowId ?? 'workflow-1',
    workflowVersionId: overrides.workflowVersionId ?? null,
    workflowVersion: overrides.workflowVersion ?? null,
    name: overrides.name ?? 'GitHub PR Webhook',
    description: overrides.description ?? null,
    webhookPath: overrides.webhookPath ?? 'wh_550e8400-e29b-41d4-a716-446655440000',
    parsingScript: overrides.parsingScript ?? 'export async function script(input) { return {}; }',
    expectedInputs: overrides.expectedInputs ?? [
      { id: 'prTitle', label: 'PR Title', type: 'text', required: true },
      { id: 'prNumber', label: 'PR Number', type: 'number', required: true },
    ],
    status: overrides.status ?? 'active',
    organizationId: overrides.organizationId ?? 'org-1',
    createdBy: overrides.createdBy ?? 'admin-user',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

const makeDeliveryRecord = (
  overrides: Partial<WebhookDeliveryRecord> = {},
): WebhookDeliveryRecord => {
  const now = new Date();
  return {
    id: overrides.id ?? 'delivery-1',
    webhookId: overrides.webhookId ?? 'webhook-1',
    workflowRunId: overrides.workflowRunId ?? null,
    status: overrides.status ?? 'delivered',
    payload: overrides.payload ?? {},
    headers: overrides.headers,
    parsedData: overrides.parsedData ?? null,
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    completedAt: overrides.completedAt ?? null,
  };
};

class InMemoryWebhookRepository implements Partial<WebhookRepository> {
  private records = new Map<string, WebhookConfigurationRecord>();
  private pathIndex = new Map<string, string>();
  private seq = 0;

  async create(values: Partial<WebhookConfigurationRecord>): Promise<WebhookConfigurationRecord> {
    this.seq += 1;
    const record = makeWebhookRecord({
      ...values,
      id: values.id ?? `webhook-${this.seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.records.set(record.id, record);
    this.pathIndex.set(record.webhookPath, record.id);
    return record;
  }

  async update(
    id: string,
    values: Partial<WebhookConfigurationRecord>,
    options: { organizationId?: string | null } = {},
  ): Promise<WebhookConfigurationRecord | undefined> {
    const existing = await this.findById(id, options);
    if (!existing) {
      return undefined;
    }
    const updated = {
      ...existing,
      ...values,
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    // Update path index if path changed
    if (values.webhookPath && values.webhookPath !== existing.webhookPath) {
      this.pathIndex.delete(existing.webhookPath);
      this.pathIndex.set(values.webhookPath, id);
    }
    return updated;
  }

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WebhookConfigurationRecord | undefined> {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }
    if (options.organizationId && record.organizationId !== options.organizationId) {
      return undefined;
    }
    return record;
  }

  async findByPath(path: string): Promise<WebhookConfigurationRecord | undefined> {
    const id = this.pathIndex.get(path);
    if (!id) {
      return undefined;
    }
    return this.records.get(id);
  }

  async delete(id: string, options: { organizationId?: string | null } = {}): Promise<void> {
    const record = await this.findById(id, options);
    if (record) {
      this.records.delete(id);
      this.pathIndex.delete(record.webhookPath);
    }
  }

  async list(
    filters: { workflowId?: string; status?: string; organizationId?: string | null } = {},
  ) {
    return Array.from(this.records.values()).filter((record) => {
      if (filters.workflowId && record.workflowId !== filters.workflowId) {
        return false;
      }
      if (filters.status && record.status !== filters.status) {
        return false;
      }
      if (filters.organizationId && record.organizationId !== filters.organizationId) {
        return false;
      }
      return true;
    });
  }
}

class InMemoryWebhookDeliveryRepository implements Partial<WebhookDeliveryRepository> {
  private records = new Map<string, WebhookDeliveryRecord>();
  private seq = 0;
  private webhookIndex = new Map<string, string[]>();

  async create(values: Partial<WebhookDeliveryRecord>): Promise<WebhookDeliveryRecord> {
    this.seq += 1;
    const record = makeDeliveryRecord({
      ...values,
      id: values.id ?? `delivery-${this.seq}`,
      createdAt: new Date(),
    });
    this.records.set(record.id, record);

    // Update webhook index
    const webhookIds = this.webhookIndex.get(record.webhookId) ?? [];
    webhookIds.push(record.id);
    this.webhookIndex.set(record.webhookId, webhookIds);

    return record;
  }

  async update(
    id: string,
    values: Partial<WebhookDeliveryRecord>,
  ): Promise<WebhookDeliveryRecord | undefined> {
    const existing = this.records.get(id);
    if (!existing) {
      return undefined;
    }
    const updated = { ...existing, ...values };
    this.records.set(id, updated);
    return updated;
  }

  async findById(id: string): Promise<WebhookDeliveryRecord | undefined> {
    return this.records.get(id);
  }

  async findByRunId(runId: string): Promise<WebhookDeliveryRecord | undefined> {
    return Array.from(this.records.values()).find((r) => r.workflowRunId === runId);
  }

  async listByWebhookId(webhookId: string, limit = 100): Promise<WebhookDeliveryRecord[]> {
    const deliveryIds = this.webhookIndex.get(webhookId) ?? [];
    return deliveryIds
      .slice(-limit)
      .map((id) => this.records.get(id))
      .filter((r): r is WebhookDeliveryRecord => r !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

describe('WebhooksService', () => {
  let repository: InMemoryWebhookRepository;
  let deliveryRepository: InMemoryWebhookDeliveryRepository;
  let service: WebhooksService;

  const ensureWorkflowAdminAccessCalls: unknown[][] = [];
  const ensureWorkflowAdminAccess = async (...args: unknown[]) => {
    ensureWorkflowAdminAccessCalls.push(args);
  };

  const getCompiledWorkflowContextCalls: unknown[][] = [];
  const getCompiledWorkflowContext = async (...args: unknown[]) => {
    getCompiledWorkflowContextCalls.push(args);
    return {
      workflow: {
        id: 'workflow-1',
        name: 'Test workflow',
        organizationId: 'org-1',
      },
      version: {
        id: 'version-1',
        workflowId: 'workflow-1',
        version: 1,
      },
      definition: workflowDefinition,
      organizationId: 'org-1',
    };
  };

  const prepareRunPayloadCalls: unknown[][] = [];
  const prepareRunPayload = async (...args: unknown[]) => {
    prepareRunPayloadCalls.push(args);
    return {
      runId: 'shipsec-run-123',
      workflowId: 'workflow-1',
      definition: workflowDefinition,
      inputs: { prTitle: 'Test PR', prNumber: 42 },
      trigger: { type: 'webhook', sourceId: 'webhook-1', label: 'GitHub PR Webhook' },
      inputPreview: {
        runtimeInputs: {},
        nodeOverrides: { testNode: { params: {}, inputOverrides: {} } },
      },
    };
  };

  const startPreparedRunCalls: unknown[][] = [];
  const startPreparedRun = async (...args: unknown[]) => {
    startPreparedRunCalls.push(args);
    return { runId: 'shipsec-run-123', status: 'RUNNING' };
  };

  const workflowsService = {
    ensureWorkflowAdminAccess,
    getCompiledWorkflowContext,
    prepareRunPayload,
    startPreparedRun,
  } as unknown as WorkflowsService;

  const temporalStartCalls: unknown[][] = [];
  const temporalStartWorkflow = async (...args: unknown[]) => {
    temporalStartCalls.push(args);
    return { workflowId: 'webhook-parse-1', runId: 'run-1', taskQueue: 'shipsec-default' };
  };

  const temporalResultCalls: unknown[][] = [];
  const temporalGetWorkflowResult = async (...args: unknown[]) => {
    temporalResultCalls.push(args);
    return { prTitle: 'Test PR', prNumber: 42 };
  };

  const temporalService = {
    startWorkflow: temporalStartWorkflow,
    getWorkflowResult: temporalGetWorkflowResult,
    getDefaultTaskQueue: () => 'shipsec-default',
  } as unknown as TemporalService;

  const auditLogService = {
    record: () => {},
  };

  beforeEach(() => {
    repository = new InMemoryWebhookRepository();
    deliveryRepository = new InMemoryWebhookDeliveryRepository();
    service = new WebhooksService(
      repository as unknown as WebhookRepository,
      deliveryRepository as unknown as WebhookDeliveryRepository,
      workflowsService,
      temporalService,
      auditLogService as any,
    );
    ensureWorkflowAdminAccessCalls.length = 0;
    getCompiledWorkflowContextCalls.length = 0;
    prepareRunPayloadCalls.length = 0;
    startPreparedRunCalls.length = 0;
    temporalStartCalls.length = 0;
    temporalResultCalls.length = 0;
  });

  describe('list', () => {
    it('returns all webhooks for the organization', async () => {
      await repository.create({
        workflowId: 'workflow-1',
        name: 'Webhook 1',
        webhookPath: 'wh_1',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });
      await repository.create({
        workflowId: 'workflow-2',
        name: 'Webhook 2',
        webhookPath: 'wh_2',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-2',
        createdBy: 'user-2',
      });

      const results = await service.list(authContext);

      expect(results.length).toBe(1);
      expect(results[0]!.organizationId).toBe('org-1');
    });
  });

  describe('get', () => {
    it('returns webhook by id for the organization', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_test',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      const result = await service.get(authContext, webhook.id);

      expect(result?.id).toBe(webhook.id);
      expect(result?.organizationId).toBe('org-1');
    });

    it('throws NotFoundException for non-existent webhook', async () => {
      await expect(service.get(authContext, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for webhook from different organization', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_test',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'other-org',
        createdBy: 'user-1',
      });

      await expect(service.get(authContext, webhook.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a webhook with valid data', async () => {
      const result = await service.create(authContext, {
        workflowId: 'workflow-1',
        name: 'GitHub PR Webhook',
        parsingScript: 'export async function script(input) { return {}; }',
        expectedInputs: [
          { id: 'prTitle', label: 'PR Title', type: 'text', required: true },
          { id: 'prNumber', label: 'PR Number', type: 'number', required: true },
        ],
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('GitHub PR Webhook');
      expect(result.webhookPath).toMatch(/^wh_/);
      expect(ensureWorkflowAdminAccessCalls.length).toBe(1);
      expect(ensureWorkflowAdminAccessCalls[0]![0]!).toBe('workflow-1');
    });

    it('validates expected inputs against workflow entry point', async () => {
      await expect(
        service.create(authContext, {
          workflowId: 'workflow-1',
          name: 'Invalid Webhook',
          parsingScript: 'script',
          expectedInputs: [
            { id: 'nonExistentInput', label: 'Invalid', type: 'text', required: true },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates an existing webhook', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Original Name',
        webhookPath: 'wh_original',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      const result = await service.update(authContext, webhook.id, {
        name: 'Updated Name',
      });

      expect(result?.name).toBe('Updated Name');
    });

    it('throws NotFoundException for non-existent webhook', async () => {
      await expect(
        service.update(authContext, 'non-existent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an existing webhook', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'To Delete',
        webhookPath: 'wh_delete',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      await service.delete(authContext, webhook.id);

      const result = await repository.findById(webhook.id, { organizationId: 'org-1' });
      expect(result).toBeUndefined();
    });

    it('throws NotFoundException for non-existent webhook', async () => {
      await expect(service.delete(authContext, 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('regeneratePath', () => {
    it('regenerates webhook path', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_old_path',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      const result = await service.regeneratePath(authContext, webhook.id);

      expect(result.webhookPath).not.toBe('wh_old_path');
      expect(result.webhookPath).toMatch(/^wh_/);

      const updated = await repository.findById(webhook.id);
      expect(updated?.webhookPath).toBe(result.webhookPath);
    });
  });

  describe('getUrl', () => {
    it('returns webhook URL', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_test123',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      const result = await service.getUrl(authContext, webhook.id);

      expect(result.webhookPath).toBe('wh_test123');
      expect(result.url).toContain('wh_test123');
    });
  });

  describe('listDeliveries', () => {
    it('returns deliveries for a webhook', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_test',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      await deliveryRepository.create({
        webhookId: webhook.id,
        status: 'delivered',
        payload: {},
      });

      const results = await service.listDeliveries(authContext, webhook.id);

      expect(results.length).toBe(1);
      expect(results[0]!.webhookId).toBe(webhook.id);
    });
  });

  describe('getDelivery', () => {
    it('returns delivery by id', async () => {
      const webhook = await repository.create({
        workflowId: 'workflow-1',
        name: 'Test Webhook',
        webhookPath: 'wh_test',
        parsingScript: 'script',
        expectedInputs: [],
        organizationId: 'org-1',
        createdBy: 'user-1',
      });

      const delivery = await deliveryRepository.create({
        webhookId: webhook.id,
        status: 'delivered',
        payload: { test: 'data' },
      });

      const result = await service.getDelivery(authContext, delivery.id);

      expect(result?.id).toBe(delivery.id);
    });
  });
});
