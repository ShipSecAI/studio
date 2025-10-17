import { format } from 'node:util';

import type { ExecutionContext, Logger, ProgressEventInput, LogEventInput } from './types';
import type {
  IFileStorageService,
  ISecretsService,
  IArtifactService,
  ITraceService,
} from './interfaces';

export interface CreateContextOptions {
  runId: string;
  componentRef: string;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
  logCollector?: (entry: LogEventInput) => void;
}

export function createExecutionContext(options: CreateContextOptions): ExecutionContext {
  const { runId, componentRef, storage, secrets, artifacts, trace, logCollector } = options;

  const pushLog = (
    stream: LogEventInput['stream'],
    level: LogEventInput['level'],
    args: unknown[],
  ) => {
    if (args.length === 0) {
      return;
    }
    const message = format(...args);
    if (message.length === 0) {
      return;
    }
    const entry: LogEventInput = {
      runId,
      nodeRef: componentRef,
      stream,
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (logCollector) {
      logCollector(entry);
    }

    if (trace) {
      trace.record({
        type: 'NODE_PROGRESS',
        runId,
        nodeRef: componentRef,
        timestamp: entry.timestamp,
        level: level ?? 'info',
        message,
        data: { stream, origin: 'log' },
      });
    }
  };

  const logger: Logger = {
    info: (...args: unknown[]) => {
      pushLog('stdout', 'info', args);
      console.log(`[${componentRef}]`, ...args);
    },
    error: (...args: unknown[]) => {
      pushLog('stderr', 'error', args);
      console.error(`[${componentRef}]`, ...args);
    },
  };

  const emitProgress = (progress: ProgressEventInput | string) => {
    const normalized: ProgressEventInput =
      typeof progress === 'string' ? { message: progress, level: 'info' } : progress;
    const level = normalized.level ?? 'info';
    const message = normalized.message;

    console.log(`[${componentRef}] progress [${level}]: ${message}`);
    if (trace) {
      trace.record({
        type: 'NODE_PROGRESS',
        runId,
        nodeRef: componentRef,
        timestamp: new Date().toISOString(),
        level,
        message,
        data: normalized.data,
      });
    }
  };

  return {
    runId,
    componentRef,
    logger,
    emitProgress,
    storage,
    secrets,
    artifacts,
    trace,
    logCollector,
  };
}
