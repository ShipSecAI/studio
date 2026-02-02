import type { Entry, Header, Request, Response, Timings } from 'har-format';

export type {
  Entry as HarEntry,
  Request as HarRequest,
  Response as HarResponse,
  Timings as HarTimings,
  Header as HarHeader,
};

export type HttpRequestInput = string | URL | Request;

export type HttpHeaders = {
  forEach: (callback: (value: string, name: string) => void) => void;
  get: (name: string) => string | null;
};

export type HttpResponseLike = {
  status: number;
  statusText: string;
  headers: HttpHeaders;
  text: () => Promise<string>;
  clone: () => HttpResponseLike;
  body: ReadableStream<Uint8Array> | null;
};

export interface HttpInstrumentationOptions {
  maxRequestBodySize?: number;
  maxResponseBodySize?: number;
  sensitiveHeaders?: string[];
  sensitiveQueryParams?: string[];
  correlationId?: string;
}

export const DEFAULT_MAX_REQUEST_BODY_SIZE = 10 * 1024;
export const DEFAULT_MAX_RESPONSE_BODY_SIZE = 50 * 1024;

export const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'x-apikey',
  'api-key',
  'key',
  'token',
  'bearer',
  'secret',
  'password',
  'cookie',
  'set-cookie',
];

export const DEFAULT_SENSITIVE_QUERY_PARAMS = [
  'api_key',
  'apikey',
  'api-key',
  'key',
  'token',
  'access_token',
  'accesstoken',
  'secret',
  'password',
  'bearer',
  'auth',
  'authorization',
  'credential',
  'sig',
  'signature',
  'x-amz-security-token',
  'x-amz-credential',
];
