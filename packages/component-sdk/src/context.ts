// Simple format function to avoid webpack issues with node:util
function format(...args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg === null || arg === undefined) return String(arg);
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

import type {
  ExecutionContext,
  ExecutionContextMetadata,
  Logger,
  ProgressEventInput,
  LogEventInput,
  TerminalChunkInput,
  AgentTracePublisher,
  IScopedTraceService,
  TraceEventInput,
} from './types';
import type {
  IFileStorageService,
  ISecretsService,
  IArtifactService,
  ITraceService,
  TraceEvent,
} from './interfaces';
import { createHttpClient } from './http/instrumented-fetch';

// --- Run context constants (shared with workflow merge logic) ---
export const RUN_CONTEXT_ALLOWED_KEYS = new Set([
  'repository', 'branch', 'commitSha',
  'provider', 'accountId', 'connectionName',
]);
export const RUN_CONTEXT_MAX_VALUE_LENGTH = 256;
export const RUN_CONTEXT_MAX_ENTRIES = 16;

// WeakMap to hold contributions per context instance (not on the frozen object)
const contextContributions = new WeakMap<ExecutionContext, Map<string, string>>();

/** Retrieve contributions collected by a context instance */
export function getRunContextContributions(ctx: ExecutionContext): Record<string, string> {
  const map = contextContributions.get(ctx);
  return map ? Object.fromEntries(map) : {};
}

export interface CreateContextOptions {
  runId: string;
  componentRef: string;
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
  logCollector?: (entry: LogEventInput) => void;
  terminalCollector?: (chunk: TerminalChunkInput) => void;
  agentTracePublisher?: AgentTracePublisher;
  workflowId?: string;
  workflowName?: string;
  organizationId?: string | null;
  triggerSource?: string | null;
  triggerType?: string | null;
  runContext?: Record<string, string>;
}

export function createExecutionContext(options: CreateContextOptions): ExecutionContext {
  const { runId, componentRef, metadata: metadataInput, storage, secrets, artifacts, trace, logCollector, terminalCollector, agentTracePublisher, workflowId, workflowName, organizationId, triggerSource, triggerType, runContext: runContextInput } =
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
    debug: (...args: unknown[]) => {
      pushLog('stdout', 'debug', args);
      console.debug(`[${componentRef}]`, ...args);
    },
    info: (...args: unknown[]) => {
      pushLog('stdout', 'info', args);
      console.log(`[${componentRef}]`, ...args);
    },
    warn: (...args: unknown[]) => {
      pushLog('stdout', 'warn', args);
      console.warn(`[${componentRef}]`, ...args);
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

  const contributions = new Map<string, string>();

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
    terminalCollector,
    metadata,
    agentTracePublisher,
    workflowId,
    workflowName,
    organizationId,
    triggerSource,
    triggerType,
    runContext: runContextInput ? Object.freeze({ ...runContextInput }) : undefined,
    contributeRunContext: (key: string, value: string) => {
      if (!RUN_CONTEXT_ALLOWED_KEYS.has(key)) {
        logger.warn(`[RunContext] Ignored unknown key "${key}" — not in allowlist`);
        return;
      }
      if (!value || value.length === 0) return;
      const trimmed = value.slice(0, RUN_CONTEXT_MAX_VALUE_LENGTH);
      if (contributions.size >= RUN_CONTEXT_MAX_ENTRIES) {
        logger.warn(`[RunContext] Max entries (${RUN_CONTEXT_MAX_ENTRIES}) reached, ignoring key "${key}"`);
        return;
      }
      contributions.set(key, trimmed);
    },
    http: undefined as unknown as ExecutionContext['http'],
  };

  contextContributions.set(context, contributions);

  (context as ExecutionContext).http = createHttpClient(context);

  // Override logger methods to use logCollector instead of trace.record
  if (logCollector) {
    const loggerWithCollector: Logger = Object.freeze({
      debug: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'debug',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.debug(`[${componentRef}]`, ...args);
      },
      info: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'info',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.log(`[${componentRef}]`, ...args);
      },
      warn: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stdout',
          level: 'warn',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.warn(`[${componentRef}]`, ...args);
      },
      error: (...args: unknown[]) => {
        logCollector({
          runId,
          nodeRef: componentRef,
          stream: 'stderr',
          level: 'error',
          message: format(...args),
          timestamp: new Date().toISOString(),
          metadata,
        });
        console.error(`[${componentRef}]`, ...args);
      },
    }) as Logger;

    // Replace the logger in context
    (context as any).logger = loggerWithCollector;
  }

  return Object.freeze(context) as ExecutionContext;
}

function createMetadata(
  runId: string,
  componentRef: string,
  metadata?: Partial<Omit<ExecutionContextMetadata, 'runId' | 'componentRef'>>,
): ExecutionContextMetadata {
  const scoped: ExecutionContextMetadata = {
    ...metadata,
    runId,
    componentRef,
  };

  return Object.freeze(scoped);
}

function createScopedTrace(
  trace: ITraceService,
  metadata: ExecutionContextMetadata,
): IScopedTraceService {
  return {
    record(event: TraceEventInput) {
      const enriched: TraceEvent = {
        timestamp: new Date().toISOString(),
        ...event,
        runId: metadata.runId,
        nodeRef: metadata.componentRef,
        context: metadata,
      } as TraceEvent;

      trace.record(enriched);
    },
  };
}
