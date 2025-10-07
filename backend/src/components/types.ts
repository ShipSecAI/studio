import { z } from 'zod';

export type RunnerKind = 'inline' | 'docker' | 'remote';

export interface InlineRunnerConfig {
  kind: 'inline';
  concurrency?: number;
}

export interface DockerRunnerConfig {
  kind: 'docker';
  image: string;
  command: string[];
  env?: Record<string, string>;
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

export interface ExecutionContext {
  runId: string;
  componentRef: string;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitProgress: (message: string) => void;
}

export interface ComponentDefinition<I, O> {
  id: string;
  label: string;
  category: 'trigger' | 'input' | 'discovery' | 'transform' | 'output';
  runner: RunnerConfig;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  docs?: string;
  execute: (params: I, context: ExecutionContext) => Promise<O>;
}
