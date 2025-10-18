import { z } from 'zod';

import type {
  IArtifactService,
  IFileStorageService,
  ISecretsService,
  ITraceService,
  TraceEventLevel,
} from './interfaces';

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

export interface Logger {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
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
}

export type ComponentPortType = 'string' | 'array' | 'object' | 'file' | 'any';

export interface ComponentPortMetadata {
  id: string;
  label: string;
  type: ComponentPortType;
  required?: boolean;
  description?: string;
}

export type ComponentParameterType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'json';

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

export type ComponentUiCategory =
  | 'security-tool'
  | 'building-block'
  | 'input-output'
  | 'trigger';

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
  category: ComponentUiCategory;
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
}

/**
 * Execution context provided to components during execution
 * Contains service interfaces (not concrete implementations)
 */
export interface ExecutionContext {
  runId: string;
  componentRef: string;
  logger: Logger;
  emitProgress: (progress: ProgressEventInput | string) => void;
  logCollector?: (entry: LogEventInput) => void;

  // Service interfaces - implemented by adapters
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
}

export interface ComponentDefinition<I = unknown, O = unknown> {
  id: string;
  label: string;
  category: 'trigger' | 'input' | 'discovery' | 'transform' | 'output';
  runner: RunnerConfig;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  docs?: string;
  metadata?: ComponentUiMetadata;
  execute: (params: I, context: ExecutionContext) => Promise<O>;
}
