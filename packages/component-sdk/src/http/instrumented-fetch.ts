// Use non-prefixed imports for Webpack compatibility (Temporal workflow bundling)
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';

import type { ExecutionContext } from '../types';
import { getTimingAdapter } from './adapters';
import { buildHarEntry, buildHarRequest, buildHarResponse, harToCurl } from './har-builder';
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  DEFAULT_MAX_RESPONSE_BODY_SIZE,
  DEFAULT_SENSITIVE_HEADERS,
  DEFAULT_SENSITIVE_QUERY_PARAMS,
  type HarTimings,
  type HttpInstrumentationOptions,
  type HttpRequestInput,
} from './types';

const resolveOptions = (options?: HttpInstrumentationOptions): Required<Omit<HttpInstrumentationOptions, 'correlationId'>> => ({
  maxRequestBodySize: options?.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE,
  maxResponseBodySize: options?.maxResponseBodySize ?? DEFAULT_MAX_RESPONSE_BODY_SIZE,
  sensitiveHeaders: options?.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS,
  sensitiveQueryParams: options?.sensitiveQueryParams ?? DEFAULT_SENSITIVE_QUERY_PARAMS,
});

const buildTimings = (partial: Partial<HarTimings>): HarTimings => ({
  blocked: -1,
  dns: -1,
  connect: -1,
  ssl: -1,
  send: -1,
  wait: -1,
  receive: -1,
  ...partial,
});

export async function instrumentedFetch(
  input: HttpRequestInput,
  init: RequestInit | undefined,
  context: ExecutionContext,
  options: HttpInstrumentationOptions = {},
): Promise<Response> {
  const correlationId = options.correlationId ?? randomUUID();
  const url =
    input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : String(input);
  const timingAdapter = getTimingAdapter();
  const startTime = new Date().toISOString();
  const startMs = performance.now();
  const resolvedOptions = resolveOptions(options);

  timingAdapter.startTracking(correlationId, url);

  const harRequest = buildHarRequest(
    input instanceof URL ? input.toString() : input,
    init,
    resolvedOptions,
  );

  context.trace?.record({
    type: 'HTTP_REQUEST_SENT',
    level: 'info',
    message: `${harRequest.method} ${harRequest.url}`,
    data: { correlationId, request: harRequest },
  });

  try {
    const fetcher = globalThis.fetch as unknown as (
      input: HttpRequestInput,
      init?: RequestInit,
    ) => Promise<Response>;
    const response = await fetcher(input, init);
    const timings = timingAdapter.stopTracking(correlationId);
    const duration = performance.now() - startMs;

    const responseForHar = response.clone();
    const harResponse = await buildHarResponse(responseForHar, resolvedOptions);
    const harEntry = buildHarEntry(
      harRequest,
      harResponse,
      startTime,
      duration,
      buildTimings(timings),
    );

    context.trace?.record({
      type: 'HTTP_RESPONSE_RECEIVED',
      level: 'info',
      message: `${harRequest.method} ${harRequest.url} -> ${response.status}`,
      data: { correlationId, har: harEntry },
    });

    return response;
  } catch (error) {
    timingAdapter.stopTracking(correlationId);
    const err = error as Error;

    context.trace?.record({
      type: 'HTTP_REQUEST_ERROR',
      level: 'error',
      message: `${harRequest.method} ${harRequest.url} failed`,
      data: {
        correlationId,
        request: harRequest,
        error: {
          message: err?.message ?? 'Request failed',
          name: err?.name,
        },
      },
    });

    throw error;
  }
}

export function createHttpClient(
  context: ExecutionContext,
  defaultOptions: HttpInstrumentationOptions = {},
): {
  fetch: (
    input: HttpRequestInput,
    init?: RequestInit,
    options?: HttpInstrumentationOptions,
  ) => Promise<Response>;
  toCurl: (input: HttpRequestInput, init?: RequestInit) => string;
} {
  return {
    fetch: (input, init, options) =>
      instrumentedFetch(
        input,
        init,
        context,
        { ...defaultOptions, ...options },
      ),
    toCurl: (input, init) =>
      harToCurl(
        buildHarRequest(
          input instanceof URL ? input.toString() : input,
          init,
          resolveOptions(defaultOptions),
        ),
      ),
  };
}
