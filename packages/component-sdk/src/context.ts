import { format } from 'node:util';

import type {
  ExecutionContext,
  ExecutionContextMetadata,
  Logger,
  ProgressEventInput,
  LogEventInput,
} from './types';
import type {
  IFileStorageService,
  ISecretsService,
  IArtifactService,
  ITraceService,
} from './interfaces';

export interface CreateContextOptions {
  runId: string;
  componentRef: string;
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
  logCollector?: (entry: LogEventInput) => void;
}

export function createExecutionContext(options: CreateContextOptions): ExecutionContext {
  const { runId, componentRef, metadata: metadataInput, storage, secrets, artifacts, trace, logCollector } =
    options;
  const metadata = createMetadata(runId, componentRef, metadataInput);
  const scopedTrace = trace ? createScopedTrace(trace, metadata) : undefined;

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
      metadata,
    };

    if (logCollector) {
      logCollector(entry);
    }

    if (scopedTrace) {
      scopedTrace.record({
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

  const logger: Logger = Object.freeze({
    info: (...args: unknown[]) => {
      pushLog('stdout', 'info', args);
      console.log(`[${componentRef}]`, ...args);
    },
    error: (...args: unknown[]) => {
      pushLog('stderr', 'error', args);
      console.error(`[${componentRef}]`, ...args);
    },
  }) as Logger;

  const emitProgress = (progress: ProgressEventInput | string) => {
    const normalized: ProgressEventInput =
      typeof progress === 'string' ? { message: progress, level: 'info' } : progress;
    const level = normalized.level ?? 'info';
    const message = normalized.message;

    console.log(`[${componentRef}] progress [${level}]: ${message}`);
    if (scopedTrace) {
      scopedTrace.record({
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

  const context: ExecutionContext = {
    runId,
    componentRef,
    logger,
    emitProgress,
    storage,
    secrets,
    artifacts,
    trace: scopedTrace,
    logCollector,
    metadata,
  };

  return Object.freeze(context) as ExecutionContext;
}

function createMetadata(
  runId: string,
  componentRef: string,
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>,
): ExecutionContextMetadata {
  const scoped: ExecutionContextMetadata = {
    runId,
    componentRef,
    activityId: metadata?.activityId,
    attempt: metadata?.attempt,
    correlationId: metadata?.correlationId,
    streamId: metadata?.streamId,
    joinStrategy: metadata?.joinStrategy,
    triggeredBy: metadata?.triggeredBy,
    failure: metadata?.failure,
  };

  return Object.freeze(scoped);
}

function createScopedTrace(
  trace: ITraceService,
  metadata: ExecutionContextMetadata,
): ITraceService {
  return {
    record(event) {
      const enriched = {
        ...event,
        runId: metadata.runId,
        nodeRef: metadata.componentRef,
        context: metadata,
      };

      trace.record(enriched);
    },
  };
}
