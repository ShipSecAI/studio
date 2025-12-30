/**
 * ShipSec Component SDK - Error Types
 *
 * Standardized error taxonomy for component execution.
 * All errors extend ComponentError and provide semantic information
 * about whether they should be retried.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Base Error Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for all component errors.
 * Provides structured error information for retry decisions and debugging.
 */
export abstract class ComponentError extends Error {
  /** Unique error type name for classification */
  abstract readonly type: string;

  /** Whether this error should trigger a retry */
  abstract readonly retryable: boolean;

  /** Optional: Override retry delay for this specific error instance (milliseconds) */
  readonly retryDelayMs?: number;

  /** Optional: Additional context for debugging */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.retryDelayMs = options?.retryDelayMs;
    this.details = options?.details;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize error for logging/transport
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      retryable: this.retryable,
      retryDelayMs: this.retryDelayMs,
      details: this.details,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
      stack: this.stack,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transient Errors (Should Retry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Network-related errors (DNS failures, connection timeouts, ENETUNREACH)
 */
export class NetworkError extends ComponentError {
  readonly type = 'NetworkError';
  readonly retryable = true;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, options);
  }

  /**
   * Create NetworkError from a Node.js/fetch network error
   */
  static from(error: Error): NetworkError {
    const message = error.message || 'Network error';
    const details: Record<string, unknown> = {
      originalName: error.name,
      originalMessage: error.message,
    };

    // Extract network-specific details from common error patterns
    if ('code' in error) {
      details.code = (error as NodeJS.ErrnoException).code;
    }

    return new NetworkError(message, { cause: error, details });
  }
}

/**
 * Rate limit errors (HTTP 429, API quota exceeded)
 */
export class RateLimitError extends ComponentError {
  readonly type = 'RateLimitError';
  readonly retryable = true;

  /** When the rate limit resets (if known) */
  readonly resetAt?: Date;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
      resetAt?: Date;
    },
  ) {
    super(message, options);
    this.resetAt = options?.resetAt;
  }

  /**
   * Create RateLimitError from response headers
   * Parses common rate limit headers: Retry-After, X-RateLimit-Reset, etc.
   */
  static fromHeaders(headers: Headers, body?: string): RateLimitError {
    let retryDelayMs: number | undefined;
    let resetAt: Date | undefined;

    // Parse Retry-After header (can be seconds or HTTP date)
    const retryAfter = headers.get('Retry-After');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        retryDelayMs = seconds * 1000;
        resetAt = new Date(Date.now() + retryDelayMs);
      } else {
        // Try parsing as HTTP date
        resetAt = new Date(retryAfter);
        if (!isNaN(resetAt.getTime())) {
          retryDelayMs = Math.max(0, resetAt.getTime() - Date.now());
        }
      }
    }

    // Parse X-RateLimit-Reset (Unix timestamp)
    const rateLimitReset = headers.get('X-RateLimit-Reset');
    if (rateLimitReset && !resetAt) {
      const timestamp = parseInt(rateLimitReset, 10);
      if (!isNaN(timestamp)) {
        // Some APIs use seconds, some use milliseconds
        resetAt = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
        retryDelayMs = Math.max(0, resetAt.getTime() - Date.now());
      }
    }

    // Default retry delay of 60 seconds if not specified
    retryDelayMs = retryDelayMs ?? 60_000;

    const message = body || 'Rate limit exceeded';
    return new RateLimitError(message, {
      retryDelayMs,
      resetAt,
      details: {
        retryAfter: retryAfter || undefined,
        rateLimitReset: rateLimitReset || undefined,
        rateLimitLimit: headers.get('X-RateLimit-Limit') || undefined,
        rateLimitRemaining: headers.get('X-RateLimit-Remaining') || undefined,
      },
    });
  }
}

/**
 * Service errors (HTTP 5xx, service temporarily unavailable)
 */
export class ServiceError extends ComponentError {
  readonly type = 'ServiceError';
  readonly retryable = true;

  /** HTTP status code if applicable */
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
      statusCode?: number;
    },
  ) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}

/**
 * Timeout errors (operation exceeded timeout)
 */
export class TimeoutError extends ComponentError {
  readonly type = 'TimeoutError';
  readonly retryable = true;

  /** Timeout duration that was exceeded (milliseconds) */
  readonly timeoutMs: number;

  constructor(
    message: string,
    timeoutMs: number,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, options);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Resource unavailable errors (connection pool full, queue full)
 */
export class ResourceUnavailableError extends ComponentError {
  readonly type = 'ResourceUnavailableError';
  readonly retryable = true;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryDelayMs?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, options);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Permanent Errors (Do Not Retry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authentication errors (HTTP 401/403, invalid credentials)
 */
export class AuthenticationError extends ComponentError {
  readonly type = 'AuthenticationError';
  readonly retryable = false;

  /** HTTP status code if applicable */
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      statusCode?: number;
    },
  ) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}

/**
 * Not found errors (HTTP 404, missing resources)
 */
export class NotFoundError extends ComponentError {
  readonly type = 'NotFoundError';
  readonly retryable = false;

  /** The resource that was not found */
  readonly resourceType?: string;
  readonly resourceId?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      resourceType?: string;
      resourceId?: string;
    },
  ) {
    super(message, options);
    this.resourceType = options?.resourceType;
    this.resourceId = options?.resourceId;
  }
}

/**
 * Validation errors (invalid input, missing required fields)
 */
export class ValidationError extends ComponentError {
  readonly type = 'ValidationError';
  readonly retryable = false;

  /** Validation errors by field */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      fieldErrors?: Record<string, string[]>;
    },
  ) {
    super(message, options);
    this.fieldErrors = options?.fieldErrors;
  }
}

/**
 * Configuration errors (invalid settings, wrong configuration)
 */
export class ConfigurationError extends ComponentError {
  readonly type = 'ConfigurationError';
  readonly retryable = false;

  /** The configuration key that has an issue */
  readonly configKey?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      configKey?: string;
    },
  ) {
    super(message, options);
    this.configKey = options?.configKey;
  }
}

/**
 * Permission errors (access denied, insufficient permissions)
 */
export class PermissionError extends ComponentError {
  readonly type = 'PermissionError';
  readonly retryable = false;

  /** The required permission that was missing */
  readonly requiredPermission?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      requiredPermission?: string;
    },
  ) {
    super(message, options);
    this.requiredPermission = options?.requiredPermission;
  }
}

/**
 * Container errors (Docker image not found, incompatible architecture)
 */
export class ContainerError extends ComponentError {
  readonly type = 'ContainerError';
  readonly retryable = false;

  /** The container image that had an issue */
  readonly image?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      image?: string;
    },
  ) {
    super(message, options);
    this.image = options?.image;
  }
}

/**
 * HTTP errors for unknown or unexpected status codes.
 * Used when a response status doesn't match known patterns.
 */
export class HttpError extends ComponentError {
  readonly type = 'HttpError';
  readonly retryable = false;

  /** The HTTP status code that caused this error */
  readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, options);
    this.statusCode = statusCode;
  }
}

/**
 * Convert an HTTP response to the appropriate ComponentError type.
 *
 * @param response - The fetch Response object
 * @param body - Optional response body (if already read)
 * @returns The appropriate ComponentError subclass
 */
export function fromHttpResponse(
  response: Response,
  body?: string,
): ComponentError {
  const status = response.status;
  const message = body || response.statusText || `HTTP ${status}`;
  const details = {
    url: response.url,
    status,
    statusText: response.statusText,
  };

  // Handle specific status codes
  switch (status) {
    // Rate limit - special handling for headers
    case 429:
      return RateLimitError.fromHeaders(response.headers, body);

    // Client errors (non-retryable)
    case 400:
    case 409:
    case 422:
      return new ValidationError(message, { details });

    case 401:
      return new AuthenticationError(message, { statusCode: status, details });

    case 403:
      return new PermissionError(message, { details });

    case 404:
      return new NotFoundError(message, { details });

    case 408:
      return new TimeoutError(message, 0, { details });

    // Server errors (retryable)
    case 500:
    case 502:
    case 503:
    case 504:
      return new ServiceError(message, { statusCode: status, details });

    default:
      // Unknown status code - classify as non-retryable HTTP error
      // This preserves existing behavior for unexpected status codes
      return new HttpError(message, status, { details });
  }
}

/**
 * Check if an error is a ComponentError
 */
export function isComponentError(error: unknown): error is ComponentError {
  return error instanceof ComponentError;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isComponentError(error)) {
    return error.retryable;
  }
  return false;
}

/**
 * Get retry delay from error if present
 */
export function getRetryDelayMs(error: unknown): number | undefined {
  if (isComponentError(error)) {
    return error.retryDelayMs;
  }
  return undefined;
}

/**
 * Get error type name for classification
 */
export function getErrorType(error: unknown): string {
  if (isComponentError(error)) {
    return error.type;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UnknownError';
}

/**
 * Wrap an unknown error in the appropriate ComponentError type.
 * Useful for catch blocks where the error type is unknown.
 */
export function wrapError(error: unknown, context?: string): ComponentError {
  // Already a ComponentError
  if (isComponentError(error)) {
    return error;
  }

  // Standard Error - try to classify
  if (error instanceof Error) {
    const message = context
      ? `${context}: ${error.message}`
      : error.message;

    // Check for common network error patterns
    if (
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENETUNREACH') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('socket hang up') ||
      error.message.includes('network') ||
      error.name === 'FetchError'
    ) {
      return NetworkError.from(error);
    }

    // Check for abort/timeout patterns
    if (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('timeout')
    ) {
      return new TimeoutError(message, 0, { cause: error });
    }

    // Default to ServiceError (retryable) for unknown errors
    return new ServiceError(message, { cause: error });
  }

  // Unknown error type
  const message = context
    ? `${context}: ${String(error)}`
    : String(error);
  return new ServiceError(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Type Names (for non-retryable error type configuration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All non-retryable error type names.
 * Use this for configuring Temporal's nonRetryableErrorTypes.
 */
export const NON_RETRYABLE_ERROR_TYPES = [
  'AuthenticationError',
  'NotFoundError',
  'ValidationError',
  'ConfigurationError',
  'PermissionError',
  'ContainerError',
  'HttpError',
] as const;

/**
 * All retryable error type names.
 */
export const RETRYABLE_ERROR_TYPES = [
  'NetworkError',
  'RateLimitError',
  'ServiceError',
  'TimeoutError',
  'ResourceUnavailableError',
] as const;

/**
 * All component error type names.
 */
export const ALL_ERROR_TYPES = [
  ...RETRYABLE_ERROR_TYPES,
  ...NON_RETRYABLE_ERROR_TYPES,
] as const;

export type ErrorTypeName = (typeof ALL_ERROR_TYPES)[number];
