import { ExecutionContext } from './types';

export function createDefaultExecutionContext(componentRef: string): ExecutionContext {
  return {
    runId: 'local-run',
    componentRef,
    logger: {
      info: (...args: unknown[]) => console.log(`[${componentRef}]`, ...args),
      error: (...args: unknown[]) => console.error(`[${componentRef}]`, ...args),
    },
    emitProgress: (message: string) => console.log(`[${componentRef}] progress: ${message}`),
  };
}
