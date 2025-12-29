import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  NetworkError,
  RateLimitError,
  ServiceError,
  TimeoutError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConfigurationError,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  mode: z.enum(['success', 'fail']).default('fail').describe('Whether to succeed or fail'),
  errorType: z.string().default('ServiceError').describe('Class name of the error to throw'),
  errorMessage: z.string().default('Simulated tool failure').describe('Error message'),
  errorDetails: z.record(z.string(), z.any()).optional().describe('Structured details for the error'),
  failUntilAttempt: z.number().int().min(1).default(1).describe('Keep failing until this attempt number is reached (exclusive)'),
  alwaysFail: z.boolean().default(false).describe('Always fail regardless of attempt number (for testing non-retryable errors)'),
});

type Input = z.infer<typeof inputSchema>;
type Output = {
  success: boolean;
  attempt: number;
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'test.error.generator',
  label: 'Error Generator',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    attempt: z.number(),
  }),
  docs: 'A test component that generates specific error types and simulates retry scenarios.',
  metadata: {
    slug: 'test-error-generator',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Generates programmed errors for E2E testing of the retry and error reporting system.',
    icon: 'AlertTriangle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [
      {
        id: 'result',
        label: 'Result',
        dataType: port.any(),
        description: 'Result of the operation if it succeeds.',
      },
    ],
    parameters: [
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { label: 'Always Fail', value: 'fail' },
          { label: 'Always Success', value: 'success' },
        ],
        required: true,
        default: 'fail',
      },
      {
        id: 'errorType',
        label: 'Error Type',
        type: 'text',
        required: true,
        default: 'ServiceError',
        description: 'Type of error: NetworkError, RateLimitError, ServiceError, TimeoutError, AuthenticationError, NotFoundError, ValidationError, ConfigurationError',
      },
      {
        id: 'errorMessage',
        label: 'Error Message',
        type: 'text',
        required: true,
        default: 'Simulated tool failure',
      },
      {
        id: 'failUntilAttempt',
        label: 'Fail Until Attempt',
        type: 'number',
        required: true,
        default: 1,
        description: 'Retries will continue until this attempt index (1-based) is reached.',
      },
    ],
  },
  async execute(params, context) {
    const currentAttempt = context.metadata.attempt ?? 1;
    
    context.logger.info(`[Error Generator] Current attempt: ${currentAttempt}`);
    context.emitProgress(`Execution attempt ${currentAttempt}...`);

    if (params.mode === 'success') {
      return { success: true, attempt: currentAttempt };
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
        alwaysFail: params.alwaysFail
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
              'api_key': ['Invalid format', 'Must be at least 32 characters'],
              'endpoint': ['Host unreachable']
            }
          });
        case 'ConfigurationError':
          throw new ConfigurationError(msg, { details });
        default:
          throw new Error(msg);
      }
    }

    context.logger.info(`[Error Generator] Success reached on attempt ${currentAttempt}`);
    return { success: true, attempt: currentAttempt };
  },
};

componentRegistry.register(definition);
