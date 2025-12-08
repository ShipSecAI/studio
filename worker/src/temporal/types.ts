// Shared types between workflows and activities
// This file MUST NOT import anything that executes code or external libraries
import type { ExecutionTriggerMetadata } from '@shipsec/shared';

// Inline workflow definition types to avoid importing Zod
export interface WorkflowAction {
  ref: string;
  componentId: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  inputMappings: Record<
    string,
    {
      sourceRef: string;
      sourceHandle: string;
    }
  >;
}

export type WorkflowEdgeKind = 'success' | 'error';

export interface WorkflowEdge {
  id: string;
  sourceRef: string;
  targetRef: string;
  sourceHandle?: string;
  targetHandle?: string;
  kind: WorkflowEdgeKind;
}

export type WorkflowJoinStrategy = 'all' | 'any' | 'first';

export interface WorkflowNodeMetadata {
  ref: string;
  label?: string;
  joinStrategy?: WorkflowJoinStrategy;
  maxConcurrency?: number;
  groupId?: string;
  streamId?: string;
}

export interface WorkflowFailureMetadata {
  at: string;
  reason: {
    message: string;
    name?: string;
  };
}

export interface WorkflowDefinition {
  version: number;
  title: string;
  description?: string;
  entrypoint: { ref: string };
  nodes: Record<string, WorkflowNodeMetadata>;
  edges: WorkflowEdge[];
  dependencyCounts: Record<string, number>;
  actions: WorkflowAction[];
  config: {
    environment: string;
  timeoutSeconds: number;
  };
}

export interface RunComponentActivityInput {
  runId: string;
  workflowId: string;
  workflowVersionId?: string | null;
  organizationId?: string | null;
  action: {
    ref: string;
    componentId: string;
  };
  params: Record<string, unknown>;
  warnings?: Array<{
    target: string;
    sourceRef: string;
    sourceHandle: string;
  }>;
  metadata?: {
    streamId?: string;
    joinStrategy?: WorkflowJoinStrategy;
    groupId?: string;
    triggeredBy?: string;
    failure?: WorkflowFailureMetadata;
  };
}

export interface RunComponentActivityOutput {
  output: unknown;
}

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
  organizationId?: string | null;
}

export interface WorkflowRunResult {
  outputs: Record<string, unknown>;
  trace?: unknown[];
  success: boolean;
  error?: string;
}

// ========================
// Activity types
// ========================

export interface RunWorkflowActivityInput {
  runId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, unknown>;
  workflowVersionId?: string | null;
  workflowVersion?: number | null;
  organizationId?: string | null;
}

export interface RunWorkflowActivityOutput {
  outputs: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export type WorkflowLogStream = 'stdout' | 'stderr' | 'console';

export interface WorkflowLogMetadata {
  activityId?: string;
  attempt?: number;
  correlationId?: string;
  streamId?: string;
  joinStrategy?: WorkflowJoinStrategy;
  triggeredBy?: string;
  failure?: WorkflowFailureMetadata;
}

export interface WorkflowLogEntry {
  runId: string;
  nodeRef: string;
  stream: WorkflowLogStream;
  message: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  timestamp?: Date;
  metadata?: WorkflowLogMetadata;
  organizationId?: string | null;
}

export interface WorkflowLogSink {
  append(entry: WorkflowLogEntry): Promise<void>;
}

export interface PrepareRunPayloadActivityInput {
  workflowId: string;
  versionId?: string;
  version?: number;
  inputs?: Record<string, unknown>;
  nodeOverrides?: Record<string, Record<string, unknown>>;
  trigger?: ExecutionTriggerMetadata;
  runId?: string;
  organizationId?: string | null;
}
