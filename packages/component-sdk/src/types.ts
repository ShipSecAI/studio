import { z } from 'zod';

import type {
  IArtifactService,
  IFileStorageService,
  ISecretsService,
  ITraceService,
  TraceEvent,
  ExecutionContextMetadata,
  TraceEventLevel,
  TraceEventData,
} from './interfaces';

export type { ExecutionContextMetadata } from './interfaces';

export type RunnerKind = 'inline' | 'docker' | 'remote';

export interface InlineRunnerConfig {
  kind: 'inline';
  concurrency?: number;
}

export interface DockerRunnerConfig {
  kind: 'docker';
  image: string;
  command: string[];
  entrypoint?: string; // Override container's default entrypoint
  env?: Record<string, string>;
  network?: 'none' | 'bridge' | 'host'; // Network mode (default: none for security)
  platform?: string; // Optional platform to run under (e.g., 'linux/amd64')
  volumes?: Array<{
    source: string; // host path
    target: string; // container path
    readOnly?: boolean;
  }>; // Optional volume mounts
  timeoutSeconds?: number;
}

export interface RemoteRunnerConfig {
  kind: 'remote';
  endpoint: string;
  authSecretName?: string;
}

export type RunnerConfig =
  | InlineRunnerConfig
  | DockerRunnerConfig
  | RemoteRunnerConfig;

export interface TerminalChunkInput {
  runId: string;
  nodeRef: string;
  stream: 'stdout' | 'stderr' | 'console' | 'pty';
  chunkIndex: number;
  payload: string;
  recordedAt: string;
  deltaMs: number;
  origin?: string;
  runnerKind?: RunnerKind;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface ProgressEventInput {
  message: string;
  level?: TraceEventLevel;
  data?: TraceEventData;
}

export interface LogEventInput {
  runId: string;
  nodeRef: string;
  stream: 'stdout' | 'stderr' | 'console';
  message: string;
  level?: TraceEventLevel;
  timestamp: string;
  data?: unknown;
  metadata?: ExecutionContextMetadata;
}

export interface AgentTracePart {
  type: string;
  [key: string]: unknown;
}

export interface AgentTraceEvent {
  agentRunId: string;
  workflowRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: AgentTracePart;
  [key: string]: unknown;
}

export interface AgentTracePublisher {
  publish(event: AgentTraceEvent): Promise<void> | void;
}

export type PrimitivePortTypeName =
  | 'any'
  | 'text'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'file'
  | 'json';

export type PrimitiveCoercionSource = Exclude<
  PrimitivePortTypeName,
  'secret' | 'file'
>;

export interface PrimitivePortType {
  kind: 'primitive';
  name: PrimitivePortTypeName;
  coercion?: {
    from?: PrimitiveCoercionSource[];
  };
}

export interface ListPortType {
  kind: 'list';
  element: PrimitivePortType | ContractPortType;
}

export interface MapPortType {
  kind: 'map';
  value: PrimitivePortType;
}

export interface ContractPortType {
  kind: 'contract';
  name: string;
  credential?: boolean;
}

export type PortDataType =
  | PrimitivePortType
  | ListPortType
  | MapPortType
  | ContractPortType;

export interface ComponentPortMetadata {
  id: string;
  label: string;
  dataType: PortDataType;
  required?: boolean;
  description?: string;
  valuePriority?: 'manual-first' | 'connection-first';
  /** True if this port controls conditional execution (branching) */
  isBranching?: boolean;
  /** Custom color for branching ports: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'slate' */
  branchColor?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'slate';
}

export type ComponentParameterType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'json'
  | 'secret'
  | 'artifact'
  | 'variable-list'
  | 'form-fields'
  | 'selection-options'
  | 'browser-actions';

export interface ComponentParameterOption {
  label: string;
  value: unknown;
}

export interface ComponentParameterMetadata {
  id: string;
  label: string;
  type: ComponentParameterType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  helpText?: string;
  options?: ComponentParameterOption[];
  min?: number;
  max?: number;
  rows?: number;
  /** Conditional visibility: parameter is shown only when all conditions are met */
  visibleWhen?: Record<string, unknown>;
}

export type ComponentAuthorType = 'shipsecai' | 'community';

export interface ComponentAuthorMetadata {
  name: string;
  type: ComponentAuthorType;
  url?: string;
}

// Categories supported by the new functional grouping plus legacy values for backwards compatibility
export type ComponentCategory =
  | 'input'
  | 'transform'
  | 'ai'
  | 'security'
  | 'it_ops'
  | 'notification'
  | 'manual_action'
  | 'output';

export type ComponentUiType =
  | 'trigger'
  | 'input'
  | 'scan'
  | 'process'
  | 'output';

export interface ComponentUiMetadata {
  slug: string;
  version: string;
  type: ComponentUiType;
  category: ComponentCategory;
  description?: string;
  documentation?: string;
  documentationUrl?: string;
  icon?: string;
  logo?: string;
  author?: ComponentAuthorMetadata;
  isLatest?: boolean;
  deprecated?: boolean;
  example?: string;
  inputs?: ComponentPortMetadata[];
  outputs?: ComponentPortMetadata[];
  parameters?: ComponentParameterMetadata[];
  examples?: string[];
  /** UI-only component - should not be included in workflow execution */
  uiOnly?: boolean;
}

export interface ExecutionContext {
  runId: string;
  componentRef: string;
    logger: Logger;
  emitProgress: (progress: ProgressEventInput | string) => void;
  logCollector?: (entry: LogEventInput) => void;
  terminalCollector?: (chunk: TerminalChunkInput) => void;
  metadata: ExecutionContextMetadata;
  agentTracePublisher?: AgentTracePublisher;

  // Service interfaces - implemented by adapters
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: IScopedTraceService;
}

export type TraceEventInput = Omit<
  TraceEvent,
  'runId' | 'nodeRef' | 'timestamp' | 'context'
> & {
  runId?: string;
  nodeRef?: string;
  timestamp?: string;
  context?: ExecutionContextMetadata;
};

export interface IScopedTraceService {
  /**
   * Record a trace event. runId, nodeRef, and context are automatically injected.
   */
  record(event: TraceEventInput): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry Policy Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-error-type retry configuration
 */
export interface ErrorTypePolicy {
  /** Should this error type be retried? */
  retryable?: boolean;

  /** Override retry delay for this specific error (milliseconds) */
  retryDelayMs?: number;
}

/**
 * Component retry policy configuration.
 * Maps to Temporal's retry options for workflow activities.
 */
export interface ComponentRetryPolicy {
  /** Max retry attempts (0 = unlimited, 1 = no retry, undefined = use default) */
  maxAttempts?: number;

  /** Initial delay before first retry (seconds) */
  initialIntervalSeconds?: number;

  /** Max delay between retries (seconds) */
  maximumIntervalSeconds?: number;

  /** Exponential backoff multiplier (2.0 = double each time) */
  backoffCoefficient?: number;

  /** Error types that should NOT be retried (overrides default) */
  nonRetryableErrorTypes?: string[];

  /** Per-error type configuration (overrides defaults) */
  errorTypePolicies?: Record<string, ErrorTypePolicy>;
}

/**
 * Default retry policy applied when a component doesn't specify one.
 */
export const DEFAULT_RETRY_POLICY: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 1,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'NotFoundError',
    'ValidationError',
    'ConfigurationError',
    'PermissionError',
    'ContainerError',
  ],
};

export interface ComponentDefinition<I = unknown, O = unknown, P = Record<string, unknown>> {
  id: string;
  label: string;
  category: ComponentCategory;
  runner: RunnerConfig;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  docs?: string;
  parameters?: ComponentParameterMetadata[];
  metadata?: ComponentUiMetadata;
  requiresSecrets?: boolean;

  /** Retry policy for this component (optional, uses default if not specified) */
  retryPolicy?: ComponentRetryPolicy;

  execute: (params: I, context: ExecutionContext) => Promise<O>;
  resolvePorts?: (
    params: P,
  ) => {
    inputs?: ComponentPortMetadata[];
    outputs?: ComponentPortMetadata[];
  };
}
