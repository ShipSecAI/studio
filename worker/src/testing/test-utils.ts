import { vi } from 'bun:test';
import { ExecutionContext, ISecretsService } from '@shipsec/component-sdk';

export function createMockExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  const defaultContext: ExecutionContext = {
    runId: 'test-run-id',
    componentRef: 'test-component-ref',
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    emitProgress: vi.fn(),
    secrets: undefined,
    // Add other default mock implementations as needed
    storage: undefined,
    artifacts: undefined,
    trace: undefined,
    logCollector: undefined,
    metadata: { runId: 'test-run-id', componentRef: 'test-component-ref' },
    http: {
      fetch: vi.fn(async () => new Response()),
      toCurl: vi.fn(() => ''),
    },
  };

  return {
    ...defaultContext,
    ...overrides,
    logger: { ...defaultContext.logger, ...overrides.logger },
  };
}

export function createMockSecretsService(secrets: Record<string, string> = {}): ISecretsService {
  return {
    get: vi.fn().mockImplementation((secretId: string) => {
      const secretValue = secrets[secretId];
      return secretValue ? Promise.resolve({ value: secretValue }) : Promise.resolve(null);
    }),
    list: vi.fn().mockResolvedValue([]),
  };
}

export function createMockTrace(): any {
  const events: any[] = [];
  return {
    record: vi.fn().mockImplementation((event) => {
      events.push(event);
      console.log('TRACE:', event.type, event.nodeRef, event.message);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    setRunMetadata: vi.fn(),
    finalizeRun: vi.fn(),
    events,
  };
}

export function createMockLogCollector(): any {
  const logs: any[] = [];
  return {
    append: vi.fn().mockImplementation((log) => {
      logs.push(log);
      console.log('LOG:', log.level, log.message);
      return Promise.resolve();
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    logs,
  };
}
