// Shared types between workflows and activities
// This file MUST NOT import anything that executes code or external libraries

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

export interface WorkflowDefinition {
  title: string;
  description?: string;
  entrypoint: { ref: string };
  actions: WorkflowAction[];
  config: {
    environment: string;
    timeoutSeconds: number;
  };
}

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
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
}

export interface RunWorkflowActivityOutput {
  outputs: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export type WorkflowLogStream = 'stdout' | 'stderr' | 'console';

export interface WorkflowLogEntry {
  runId: string;
  nodeRef: string;
  stream: WorkflowLogStream;
  message: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  timestamp?: Date;
}

export interface WorkflowLogSink {
  append(entry: WorkflowLogEntry): Promise<void>;
}
