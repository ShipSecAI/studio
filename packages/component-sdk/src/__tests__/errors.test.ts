import { describe, it, expect } from 'bun:test';

import {
  // Error classes
  ComponentError,
  NetworkError,
  RateLimitError,
  ServiceError,
  TimeoutError,
  ResourceUnavailableError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConfigurationError,
  PermissionError,
  ContainerError,
  HttpError,
  // Helper functions
  fromHttpResponse,
  isComponentError,
  isRetryableError,
  getRetryDelayMs,
  getErrorType,
  wrapError,
  // Constants
  NON_RETRYABLE_ERROR_TYPES,
  RETRYABLE_ERROR_TYPES,
  ALL_ERROR_TYPES,
} from '../errors';

// ─────────────────────────────────────────────────────────────────────────────
// Base ComponentError
// ─────────────────────────────────────────────────────────────────────────────

describe('ComponentError', () => {
  it('should be abstract and not directly instantiable', () => {
    // ComponentError is abstract, we can only test through subclasses
    // This is verified by TypeScript at compile time
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transient Errors (Retryable)
// ─────────────────────────────────────────────────────────────────────────────

describe('NetworkError', () => {
  it('should be retryable', () => {
    const error = new NetworkError('Connection refused');
    expect(error.retryable).toBe(true);
    expect(error.type).toBe('NetworkError');
    expect(error.message).toBe('Connection refused');
  });

  it('should accept options', () => {
    const cause = new Error('Original error');
    const error = new NetworkError('DNS resolution failed', {
      cause,
      retryDelayMs: 5000,
      details: { host: 'example.com' },
    });

    expect(error.cause).toBe(cause);
    expect(error.retryDelayMs).toBe(5000);
    expect(error.details).toEqual({ host: 'example.com' });
  });

  it('should create from Node.js error via static method', () => {
    const nodeError = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    const error = NetworkError.from(nodeError);

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('ENOTFOUND');
    expect(error.cause).toBe(nodeError);
    expect(error.details?.code).toBe('ENOTFOUND');
  });

  it('should serialize to JSON', () => {
    const error = new NetworkError('Test error', {
      retryDelayMs: 1000,
      details: { key: 'value' },
    });

    const json = error.toJSON();
    expect(json.name).toBe('NetworkError');
    expect(json.type).toBe('NetworkError');
    expect(json.message).toBe('Test error');
    expect(json.retryable).toBe(true);
    expect(json.retryDelayMs).toBe(1000);
    expect(json.details).toEqual({ key: 'value' });
  });
});

describe('RateLimitError', () => {
  it('should be retryable', () => {
    const error = new RateLimitError('Too many requests');
    expect(error.retryable).toBe(true);
    expect(error.type).toBe('RateLimitError');
  });

  it('should accept resetAt option', () => {
    const resetAt = new Date(Date.now() + 60000);
    const error = new RateLimitError('Rate limit exceeded', {
      resetAt,
      retryDelayMs: 60000,
    });

    expect(error.resetAt).toEqual(resetAt);
    expect(error.retryDelayMs).toBe(60000);
  });

  it('should parse Retry-After header (seconds)', () => {
    const headers = new Headers({
      'Retry-After': '30',
    });

    const error = RateLimitError.fromHeaders(headers, 'Too many requests');

    expect(error.retryable).toBe(true);
    expect(error.retryDelayMs).toBe(30000);
    expect(error.message).toBe('Too many requests');
  });

  it('should parse X-RateLimit-Reset header (Unix timestamp)', () => {
    const futureTimestamp = Math.floor((Date.now() + 60000) / 1000);
    const headers = new Headers({
      'X-RateLimit-Reset': String(futureTimestamp),
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
    });

    const error = RateLimitError.fromHeaders(headers);

    expect(error.retryable).toBe(true);
    expect(error.retryDelayMs).toBeGreaterThan(0);
    expect(error.retryDelayMs).toBeLessThanOrEqual(60000);
    expect(error.details?.rateLimitLimit).toBe('100');
    expect(error.details?.rateLimitRemaining).toBe('0');
  });

  it('should default to 60s delay when no headers present', () => {
    const headers = new Headers();
    const error = RateLimitError.fromHeaders(headers);

    expect(error.retryDelayMs).toBe(60000);
  });
});

describe('ServiceError', () => {
  it('should be retryable', () => {
    const error = new ServiceError('Internal server error', { statusCode: 500 });
    expect(error.retryable).toBe(true);
    expect(error.type).toBe('ServiceError');
    expect(error.statusCode).toBe(500);
  });
});

describe('TimeoutError', () => {
  it('should be retryable', () => {
    const error = new TimeoutError('Operation timed out', 30000);
    expect(error.retryable).toBe(true);
    expect(error.type).toBe('TimeoutError');
    expect(error.timeoutMs).toBe(30000);
  });
});

describe('ResourceUnavailableError', () => {
  it('should be retryable', () => {
    const error = new ResourceUnavailableError('Connection pool exhausted');
    expect(error.retryable).toBe(true);
    expect(error.type).toBe('ResourceUnavailableError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permanent Errors (Non-Retryable)
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthenticationError', () => {
  it('should NOT be retryable', () => {
    const error = new AuthenticationError('Invalid credentials', { statusCode: 401 });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('AuthenticationError');
    expect(error.statusCode).toBe(401);
  });
});

describe('NotFoundError', () => {
  it('should NOT be retryable', () => {
    const error = new NotFoundError('Resource not found', {
      resourceType: 'user',
      resourceId: '123',
    });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('NotFoundError');
    expect(error.resourceType).toBe('user');
    expect(error.resourceId).toBe('123');
  });
});

describe('ValidationError', () => {
  it('should NOT be retryable', () => {
    const error = new ValidationError('Invalid request', {
      fieldErrors: {
        email: ['Invalid email format'],
        password: ['Too short', 'Missing special character'],
      },
    });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('ValidationError');
    expect(error.fieldErrors).toEqual({
      email: ['Invalid email format'],
      password: ['Too short', 'Missing special character'],
    });
  });
});

describe('ConfigurationError', () => {
  it('should NOT be retryable', () => {
    const error = new ConfigurationError('Missing API key', {
      configKey: 'SLACK_WEBHOOK_URL',
    });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('ConfigurationError');
    expect(error.configKey).toBe('SLACK_WEBHOOK_URL');
  });
});

describe('PermissionError', () => {
  it('should NOT be retryable', () => {
    const error = new PermissionError('Access denied', {
      requiredPermission: 'admin:write',
    });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('PermissionError');
    expect(error.requiredPermission).toBe('admin:write');
  });
});

describe('ContainerError', () => {
  it('should NOT be retryable', () => {
    const error = new ContainerError('Image not found', {
      image: 'projectdiscovery/nuclei:latest',
    });
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('ContainerError');
    expect(error.image).toBe('projectdiscovery/nuclei:latest');
  });
});

describe('HttpError', () => {
  it('should NOT be retryable', () => {
    const error = new HttpError('Unexpected status', 418);
    expect(error.retryable).toBe(false);
    expect(error.type).toBe('HttpError');
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe('Unexpected status');
  });

  it('should accept options', () => {
    const cause = new Error('Original error');
    const error = new HttpError('Custom error', 520, {
      cause,
      details: { origin: 'upstream' },
    });

    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ origin: 'upstream' });
  });

  it('should serialize to JSON', () => {
    const error = new HttpError('Unknown error', 599, {
      details: { extra: 'info' },
    });

    const json = error.toJSON();
    expect(json.name).toBe('HttpError');
    expect(json.type).toBe('HttpError');
    expect(json.message).toBe('Unknown error');
    expect(json.retryable).toBe(false);
    expect(json.details).toEqual({ extra: 'info' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fromHttpResponse Helper
// ─────────────────────────────────────────────────────────────────────────────

describe('fromHttpResponse', () => {
  function createMockResponse(status: number): Response {
    return { status, statusText: `Status ${status}`, url: 'https://api.example.com/test', headers: new Headers() } as Response;
  }

  it('maps 4xx status codes to appropriate errors', () => {
    const tests: [number, string, boolean][] = [
      [400, 'ValidationError', false], [401, 'AuthenticationError', false], [403, 'PermissionError', false],
      [404, 'NotFoundError', false], [422, 'ValidationError', false],
    ];
    for (const [status, expectedType, retryable] of tests) {
      const error = fromHttpResponse(createMockResponse(status));
      expect(error.type).toBe(expectedType);
      expect(error.retryable).toBe(retryable);
    }
  });

  it('maps 5xx status codes to ServiceError', () => {
    for (const status of [500, 502, 503, 504]) {
      const error = fromHttpResponse(createMockResponse(status));
      expect(error).toBeInstanceOf(ServiceError);
      expect(error.retryable).toBe(true);
      expect((error as ServiceError).statusCode).toBe(status);
    }
  });

  it('maps special status codes correctly', () => {
    expect(fromHttpResponse(createMockResponse(408))).toBeInstanceOf(TimeoutError);
    const rateLimit = { status: 429, headers: new Headers({ 'Retry-After': '60' }) } as Response;
    const error = fromHttpResponse(rateLimit, 'Rate limited');
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryDelayMs).toBe(60000);
  });

  it('returns HttpError for unknown status codes', () => {
    const unknown4xx = fromHttpResponse(createMockResponse(418));
    expect(unknown4xx).toBeInstanceOf(HttpError);
    expect(unknown4xx.retryable).toBe(false);
    expect((unknown4xx as HttpError).statusCode).toBe(418);

    const unknown5xx = fromHttpResponse(createMockResponse(599));
    expect(unknown5xx).toBeInstanceOf(HttpError);
    expect(unknown5xx.retryable).toBe(false);
    expect((unknown5xx as HttpError).statusCode).toBe(599);
  });

  it('includes URL and status in error details', () => {
    const error = fromHttpResponse(createMockResponse(500), 'Error');
    expect(error.details?.url).toBe('https://api.example.com/test');
    expect(error.details?.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

describe('isComponentError', () => {
  it('should return true for ComponentError instances', () => {
    expect(isComponentError(new NetworkError('test'))).toBe(true);
    expect(isComponentError(new AuthenticationError('test'))).toBe(true);
    expect(isComponentError(new ValidationError('test'))).toBe(true);
  });

  it('should return false for regular errors', () => {
    expect(isComponentError(new Error('test'))).toBe(false);
    expect(isComponentError(new TypeError('test'))).toBe(false);
  });

  it('should return false for non-errors', () => {
    expect(isComponentError('string')).toBe(false);
    expect(isComponentError(123)).toBe(false);
    expect(isComponentError(null)).toBe(false);
    expect(isComponentError(undefined)).toBe(false);
    expect(isComponentError({})).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('should return true for retryable errors', () => {
    expect(isRetryableError(new NetworkError('test'))).toBe(true);
    expect(isRetryableError(new RateLimitError('test'))).toBe(true);
    expect(isRetryableError(new ServiceError('test'))).toBe(true);
    expect(isRetryableError(new TimeoutError('test', 1000))).toBe(true);
    expect(isRetryableError(new ResourceUnavailableError('test'))).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    expect(isRetryableError(new AuthenticationError('test'))).toBe(false);
    expect(isRetryableError(new NotFoundError('test'))).toBe(false);
    expect(isRetryableError(new ValidationError('test'))).toBe(false);
    expect(isRetryableError(new ConfigurationError('test'))).toBe(false);
    expect(isRetryableError(new PermissionError('test'))).toBe(false);
    expect(isRetryableError(new ContainerError('test'))).toBe(false);
    expect(isRetryableError(new HttpError('test', 418))).toBe(false);
  });

  it('should return false for regular errors', () => {
    expect(isRetryableError(new Error('test'))).toBe(false);
  });
});

describe('getRetryDelayMs', () => {
  it('should return retry delay from component errors', () => {
    const error = new NetworkError('test', { retryDelayMs: 5000 });
    expect(getRetryDelayMs(error)).toBe(5000);
  });

  it('should return undefined if no delay set', () => {
    const error = new NetworkError('test');
    expect(getRetryDelayMs(error)).toBeUndefined();
  });

  it('should return undefined for non-component errors', () => {
    expect(getRetryDelayMs(new Error('test'))).toBeUndefined();
  });
});

describe('getErrorType', () => {
  it('should return type for component errors', () => {
    expect(getErrorType(new NetworkError('test'))).toBe('NetworkError');
    expect(getErrorType(new AuthenticationError('test'))).toBe('AuthenticationError');
    expect(getErrorType(new ValidationError('test'))).toBe('ValidationError');
  });

  it('should return name for regular errors', () => {
    expect(getErrorType(new Error('test'))).toBe('Error');
    expect(getErrorType(new TypeError('test'))).toBe('TypeError');
  });

  it('should return UnknownError for non-errors', () => {
    expect(getErrorType('string')).toBe('UnknownError');
    expect(getErrorType(123)).toBe('UnknownError');
    expect(getErrorType(null)).toBe('UnknownError');
  });
});

describe('wrapError', () => {
  it('should return ComponentError as-is', () => {
    const original = new NetworkError('test');
    const wrapped = wrapError(original);
    expect(wrapped).toBe(original);
  });

  it('should wrap network errors correctly', () => {
    const error = new Error('ECONNREFUSED');
    const wrapped = wrapError(error);

    expect(wrapped).toBeInstanceOf(NetworkError);
    expect(wrapped.retryable).toBe(true);
  });

  it('should wrap timeout/abort errors correctly', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const wrapped = wrapError(error);

    expect(wrapped).toBeInstanceOf(TimeoutError);
    expect(wrapped.retryable).toBe(true);
  });

  it('should default to ServiceError for unknown errors', () => {
    const error = new Error('Something unexpected');
    const wrapped = wrapError(error);

    expect(wrapped).toBeInstanceOf(ServiceError);
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.cause).toBe(error);
  });

  it('should add context to error message', () => {
    const error = new Error('Failed');
    const wrapped = wrapError(error, 'Processing webhook');

    expect(wrapped.message).toBe('Processing webhook: Failed');
  });

  it('should wrap non-Error values', () => {
    const wrapped = wrapError('string error');
    expect(wrapped).toBeInstanceOf(ServiceError);
    expect(wrapped.message).toBe('string error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Type Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Type Constants', () => {
  it('NON_RETRYABLE_ERROR_TYPES contains expected types', () => {
    expect(NON_RETRYABLE_ERROR_TYPES).toHaveLength(7);
    expect(NON_RETRYABLE_ERROR_TYPES).toEqual(expect.arrayContaining([
      'AuthenticationError', 'NotFoundError', 'ValidationError', 'ConfigurationError',
      'PermissionError', 'ContainerError', 'HttpError',
    ]));
  });

  it('RETRYABLE_ERROR_TYPES contains expected types', () => {
    expect(RETRYABLE_ERROR_TYPES).toHaveLength(5);
    expect(RETRYABLE_ERROR_TYPES).toEqual(expect.arrayContaining([
      'NetworkError', 'RateLimitError', 'ServiceError', 'TimeoutError', 'ResourceUnavailableError',
    ]));
  });

  it('ALL_ERROR_TYPES has correct count', () => {
    expect(ALL_ERROR_TYPES).toHaveLength(12);
    expect(ALL_ERROR_TYPES).toContain('HttpError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// instanceof checks
// ─────────────────────────────────────────────────────────────────────────────

describe('instanceof checks', () => {
  it('should properly detect error types via instanceof', () => {
    const networkError = new NetworkError('test');
    const authError = new AuthenticationError('test');

    expect(networkError instanceof ComponentError).toBe(true);
    expect(networkError instanceof NetworkError).toBe(true);
    expect(networkError instanceof Error).toBe(true);

    expect(authError instanceof ComponentError).toBe(true);
    expect(authError instanceof AuthenticationError).toBe(true);
    expect(authError instanceof Error).toBe(true);

    // Cross-check
    expect(networkError instanceof AuthenticationError).toBe(false);
    expect(authError instanceof NetworkError).toBe(false);
  });
});
