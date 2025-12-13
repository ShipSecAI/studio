import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsService.name);
  private posthog?: PostHog;
  private analyticsEnabled = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeAnalytics();
  }

  private initializeAnalytics() {
    const apiKey = this.configService.get<string>('POSTHOG_API_KEY');
    const apiHost = this.configService.get<string>('POSTHOG_HOST');
    const disabled = this.configService.get<string>('DISABLE_ANALYTICS') === 'true';

    this.analyticsEnabled = Boolean(apiKey && apiHost && !disabled);

    if (this.analyticsEnabled) {
      this.posthog = new PostHog(apiKey!, {
        host: apiHost!,
        requestTimeout: 10000, // 10 seconds
        flushAt: 1, // Flush immediately for server-side
        flushInterval: 0,
      });

      this.logger.log('📊 Backend analytics enabled - PostHog is collecting usage data');
    } else {
      this.logger.log('📊 Backend analytics disabled - No usage data will be collected');
    }
  }

  isEnabled(): boolean {
    return this.analyticsEnabled;
  }

  // Track workflow execution events
  trackWorkflowStarted(properties: {
    workflowId: string;
    workflowVersionId: string;
    workflowVersion: number;
    runId: string;
    organizationId: string;
    nodeCount: number;
    inputCount: number;
    triggerType?: string;
    triggerSource?: string;
    triggerLabel?: string;
  }) {
    if (!this.analyticsEnabled || !this.posthog) return;

    try {
      this.posthog.capture({
        distinctId: `org_${properties.organizationId}`,
        event: 'backend_workflow_started',
        properties: {
          workflow_id: properties.workflowId,
          workflow_version_id: properties.workflowVersionId,
          workflow_version: properties.workflowVersion,
          run_id: properties.runId,
          organization_id: properties.organizationId,
          node_count: properties.nodeCount,
          input_count: properties.inputCount,
          trigger_type: properties.triggerType,
          trigger_source: properties.triggerSource,
          trigger_label: properties.triggerLabel,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track workflow started: ${error}`);
    }
  }

  trackWorkflowCompleted(properties: {
    workflowId: string;
    runId: string;
    organizationId: string;
    durationMs: number;
    nodeCount: number;
    success: boolean;
    failureReason?: string;
  }) {
    if (!this.analyticsEnabled || !this.posthog) return;

    try {
      this.posthog.capture({
        distinctId: `org_${properties.organizationId}`,
        event: properties.success ? 'backend_workflow_completed' : 'backend_workflow_failed',
        properties: {
          workflow_id: properties.workflowId,
          run_id: properties.runId,
          organization_id: properties.organizationId,
          duration_ms: properties.durationMs,
          node_count: properties.nodeCount,
          success: properties.success,
          failure_reason: properties.failureReason,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track workflow completed: ${error}`);
    }
  }

  // Track API usage
  trackApiCall(properties: {
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    organizationId?: string;
    userId?: string;
  }) {
    if (!this.analyticsEnabled || !this.posthog) return;

    try {
      const distinctId = properties.organizationId
        ? `org_${properties.organizationId}`
        : properties.userId || 'anonymous';

      this.posthog.capture({
        distinctId,
        event: 'backend_api_call',
        properties: {
          method: properties.method,
          path: properties.path,
          status_code: properties.statusCode,
          duration_ms: properties.durationMs,
          organization_id: properties.organizationId,
          user_id: properties.userId,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track API call: ${error}`);
    }
  }

  // Track component usage
  trackComponentExecuted(properties: {
    componentSlug: string;
    runId: string;
    workflowId: string;
    organizationId: string;
    durationMs: number;
    success: boolean;
    outputSize?: number;
  }) {
    if (!this.analyticsEnabled || !this.posthog) return;

    try {
      this.posthog.capture({
        distinctId: `org_${properties.organizationId}`,
        event: 'backend_component_executed',
        properties: {
          component_slug: properties.componentSlug,
          run_id: properties.runId,
          workflow_id: properties.workflowId,
          organization_id: properties.organizationId,
          duration_ms: properties.durationMs,
          success: properties.success,
          output_size: properties.outputSize,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track component executed: ${error}`);
    }
  }

  // Generic event tracking
  track(event: string, properties: Record<string, any>, distinctId?: string) {
    if (!this.analyticsEnabled || !this.posthog) return;

    try {
      this.posthog.capture({
        distinctId: distinctId || 'system',
        event: `backend_${event}`,
        properties,
      });
    } catch (error) {
      this.logger.warn(`Failed to track event ${event}: ${error}`);
    }
  }

  async onModuleDestroy() {
    if (this.posthog) {
      await this.posthog.shutdown();
    }
  }
}