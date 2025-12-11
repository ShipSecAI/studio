import { z } from 'zod';

import type {
  IArtifactService,
  IFileStorageService,
  ISecretsService,
  ITraceService,
  ExecutionContextMetadata,
  TraceEventLevel,
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
  data?: unknown;
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
  | 'artifact';

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
  trace?: ITraceService;
}

export interface ComponentDefinition<I = unknown, O = unknown> {
  id: string;
  label: string;
  category: ComponentCategory;
  runner: RunnerConfig;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  docs?: string;
  metadata?: ComponentUiMetadata;
  requiresSecrets?: boolean;
  execute: (params: I, context: ExecutionContext) => Promise<O>;
  resolvePorts?: (
    params: Record<string, unknown>,
  ) => {
    inputs?: ComponentPortMetadata[];
    outputs?: ComponentPortMetadata[];
  };
}
