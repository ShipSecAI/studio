import { vi } from 'bun:test';
import { ExecutionContext, ISecretsService } from '@shipsec/component-sdk';

export function createMockExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  const defaultSecrets: ISecretsService = {
    get: vi.fn(),
    list: vi.fn(),
  };

  const defaultContext: ExecutionContext = {
    runId: 'test-run-id',
    componentRef: 'test-component-ref',
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    emitProgress: vi.fn(),
    secrets: defaultSecrets,
    // Add other default mock implementations as needed
    storage: undefined,
    artifacts: undefined,
    trace: undefined,
    logCollector: undefined,
    metadata: { runId: 'test-run-id', componentRef: 'test-component-ref' },
  };

  const mergedSecrets: ISecretsService = {
    get: overrides.secrets?.get ?? defaultSecrets.get,
    list: overrides.secrets?.list ?? defaultSecrets.list,
  };

  return {
    ...defaultContext,
    ...overrides,
    logger: { ...defaultContext.logger, ...overrides.logger },
    secrets: mergedSecrets,
  };
}
