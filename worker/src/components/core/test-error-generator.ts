import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  NetworkError,
  RateLimitError,
  ServiceError,
  TimeoutError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConfigurationError,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({});

const parameterSchema = parameters({
  mode: param(z.enum(['success', 'fail']).default('fail').describe('Whether to succeed or fail'), {
    label: 'Mode',
    editor: 'select',
    options: [
      { label: 'Always Fail', value: 'fail' },
      { label: 'Always Success', value: 'success' },
    ],
  }),
  errorType: param(
    z.string().default('ServiceError').describe('Class name of the error to throw'),
    {
      label: 'Error Type',
      editor: 'text',
      description:
        'Type of error: NetworkError, RateLimitError, ServiceError, TimeoutError, AuthenticationError, NotFoundError, ValidationError, ConfigurationError',
    },
  ),
  errorMessage: param(z.string().default('Simulated tool failure').describe('Error message'), {
    label: 'Error Message',
    editor: 'text',
  }),
  failUntilAttempt: param(
    z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('Keep failing until this attempt number is reached (exclusive)'),
    {
      label: 'Fail Until Attempt',
      editor: 'number',
      description: 'Retries will continue until this attempt index (1-based) is reached.',
      min: 1,
    },
  ),
  alwaysFail: param(
    z
      .boolean()
      .default(false)
      .describe('Always fail regardless of attempt number (for testing non-retryable errors)'),
    {
      label: 'Always Fail',
      editor: 'boolean',
      description: 'Force failure on every attempt to simulate non-retryable errors.',
    },
  ),
  errorDetails: param(
    z.record(z.string(), z.any()).optional().describe('Structured details for the error'),
    {
      label: 'Error Details',
      editor: 'json',
      description: 'Optional structured details injected into the error payload.',
    },
  ),
});

const outputSchema = outputs({
  result: port(z.unknown(), {
    label: 'Result',
    description: 'Result of the operation if it succeeds.',
    allowAny: true,
    reason: 'Test component returns variable output payloads.',
    connectionType: { kind: 'any' },
  }),
  success: port(z.boolean(), {
    label: 'Success',
    description: 'Whether the attempt completed successfully.',
  }),
  attempt: port(z.number(), {
    label: 'Attempt',
    description: 'Attempt number for the execution.',
  }),
});

// Shared execution logic
async function executeErrorGenerator(
  inputs: Record<string, never>,
  params: {
    mode: 'success' | 'fail';
    errorType: string;
    errorMessage: string;
    failUntilAttempt: number;
    alwaysFail: boolean;
    errorDetails?: Record<string, any>;
  },
  context: any,
) {
  const currentAttempt = context.metadata.attempt ?? 1;

  context.logger.info(`[Error Generator] Current attempt: ${currentAttempt}`);
  context.emitProgress(`Execution attempt ${currentAttempt}...`);

  if (params.mode === 'success') {
    return {
      result: { success: true, attempt: currentAttempt },
      success: true,
      attempt: currentAttempt,
    };
  }

  const shouldFail = params.alwaysFail || currentAttempt < params.failUntilAttempt;

  if (shouldFail) {
    const msg = params.alwaysFail
      ? `${params.errorMessage} (Permanent failure on attempt ${currentAttempt})`
      : `${params.errorMessage} (Attempt ${currentAttempt}/${params.failUntilAttempt})`;

    const details = {
      ...params.errorDetails,
      currentAttempt,
      targetAttempt: params.failUntilAttempt,
      alwaysFail: params.alwaysFail,
    };

    context.logger.warn(`[Error Generator] Raising ${params.errorType}: ${msg}`);

    switch (params.errorType) {
      case 'NetworkError':
        throw new NetworkError(msg, { details });
      case 'RateLimitError':
        throw new RateLimitError(msg, { details });
      case 'ServiceError':
        throw new ServiceError(msg, { details });
      case 'TimeoutError':
        throw new TimeoutError(msg, 10000, { details });
      case 'AuthenticationError':
        throw new AuthenticationError(msg, { details });
      case 'NotFoundError':
        throw new NotFoundError(msg, { details });
      case 'ValidationError':
        // Special case: simulate field errors
        throw new ValidationError(msg, {
          details,
          fieldErrors: params.errorDetails?.fieldErrors || {
            api_key: ['Invalid format', 'Must be at least 32 characters'],
            endpoint: ['Host unreachable'],
          },
        });
      case 'ConfigurationError':
        throw new ConfigurationError(msg, { details });
      default:
        throw new Error(msg);
    }
  }

  context.logger.info(`[Error Generator] Success reached on attempt ${currentAttempt}`);
  return {
    result: { success: true, attempt: currentAttempt },
    success: true,
    attempt: currentAttempt,
  };
}

const definition = defineComponent({
  id: 'test.error.generator',
  label: 'Error Generator',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'A test component that generates specific error types and simulates retry scenarios.',
  ui: {
    slug: 'test-error-generator',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description:
      'Generates programmed errors for E2E testing of the retry and error reporting system.',
    icon: 'AlertTriangle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
  },
  async execute({ inputs, params }, context) {
    return executeErrorGenerator(inputs, params, context);
  },
});

componentRegistry.register(definition);

const retryLimitedDefinition = defineComponent({
  id: 'test.error.retry-limited',
  label: 'Error Generator (Limited Retry)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  async execute({ inputs, params }, context) {
    return executeErrorGenerator(inputs, params, context);
  },
  ui: {
    ...definition.ui,
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    slug: 'test-error-retry-limited',
    description: 'Same as error generator but with a strict retry policy (max 2 attempts).',
  },
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 1,
    backoffCoefficient: 1,
  },
});

componentRegistry.register(retryLimitedDefinition);
