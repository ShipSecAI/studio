/**
 * Shared AWS provider utilities: retry logic, ARN synthesis, metadata guardrails.
 */

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const METADATA_MAX_DEPTH = 3;
const METADATA_MAX_ARRAY = 100;
const METADATA_MAX_BYTES = 64 * 1024; // 64KB

/**
 * Exponential backoff with jitter for AWS throttling.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isThrottled =
        error?.name === 'ThrottlingException' ||
        error?.name === 'TooManyRequestsException' ||
        error?.$metadata?.httpStatusCode === 429;

      if (!isThrottled || attempt === maxRetries) {
        throw error;
      }

      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      const jitter = backoff * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
  throw new Error('Unreachable');
}

/**
 * Check if an error is an AccessDenied error from AWS.
 */
export function isAccessDenied(error: any): boolean {
  const name = error?.name ?? '';
  const code = error?.Code ?? error?.code ?? '';
  return (
    name === 'AccessDeniedException' ||
    name === 'UnauthorizedAccess' ||
    code === 'AccessDenied' ||
    code === 'AccessDeniedException' ||
    error?.$metadata?.httpStatusCode === 403
  );
}

/**
 * Derive AWS partition from region.
 */
export function getPartition(region: string): string {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  return 'aws';
}

/**
 * Synthesize an ARN for services that don't return one.
 */
export function synthesizeArn(params: {
  service: string;
  region: string;
  accountId: string;
  resourceType: string;
  resourceId: string;
}): string {
  const partition = getPartition(params.region);
  const regionPart = params.region === 'global' ? '' : params.region;
  return `arn:${partition}:${params.service}:${regionPart}:${params.accountId}:${params.resourceType}/${params.resourceId}`;
}

/**
 * Sanitize metadata: enforce depth, array size, and total size limits.
 * Returns { metadata, truncated }.
 */
export function sanitizeMetadata(raw: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  truncated: boolean;
} {
  let truncated = false;

  function sanitize(value: unknown, depth: number): unknown {
    if (depth > METADATA_MAX_DEPTH) {
      truncated = true;
      return '[truncated]';
    }

    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      if (value.length > METADATA_MAX_ARRAY) {
        truncated = true;
        return value.slice(0, METADATA_MAX_ARRAY).map((v) => sanitize(v, depth + 1));
      }
      return value.map((v) => sanitize(v, depth + 1));
    }

    if (typeof value === 'object') {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        obj[k] = sanitize(v, depth + 1);
      }
      return obj;
    }

    // Dates, functions, etc.
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  const sanitized = sanitize(raw, 0) as Record<string, unknown>;

  // Check total size
  const json = JSON.stringify(sanitized);
  if (json.length > METADATA_MAX_BYTES) {
    truncated = true;
    // Return a minimal version
    return {
      metadata: { _metadataTruncated: true, _originalSize: json.length },
      truncated: true,
    };
  }

  return { metadata: sanitized, truncated };
}
