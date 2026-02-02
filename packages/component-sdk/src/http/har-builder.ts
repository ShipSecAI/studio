import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  DEFAULT_MAX_RESPONSE_BODY_SIZE,
  DEFAULT_SENSITIVE_HEADERS,
  DEFAULT_SENSITIVE_QUERY_PARAMS,
  type HarEntry,
  type HarHeader,
  type HarRequest,
  type HarResponse,
  type HarTimings,
  type HttpHeaders,
  type HttpInstrumentationOptions,
  type HttpRequestInput,
  type HttpResponseLike,
} from './types';

type HarQueryString = HarRequest['queryString'][number];

const DEFAULT_HTTP_VERSION = 'HTTP/1.1';

const normalizeSensitiveHeaders = (headers: string[]) =>
  new Set(headers.map((header) => header.toLowerCase()));

const getBodyText = (body: RequestInit['body'] | null | undefined): string | undefined => {
  if (!body) {
    return undefined;
  }

  if (typeof body === 'string') {
    return body;
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.toString();
  }

  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    return Buffer.from(body).toString('utf8');
  }

  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }

  return undefined;
};

export function headersToHar(headers: HttpHeaders | Record<string, string>): HarHeader[] {
  const entries: HarHeader[] = [];
  if (typeof (headers as HttpHeaders).forEach === 'function') {
    (headers as HttpHeaders).forEach((value, name) => {
      entries.push({ name, value });
    });
  } else {
    Object.entries(headers as Record<string, string>).forEach(([name, value]) => {
      entries.push({ name, value });
    });
  }
  return entries;
}

export function maskHeaders(headers: HarHeader[], sensitive: string[]): HarHeader[] {
  const sensitiveSet = normalizeSensitiveHeaders(sensitive);
  return headers.map((header) =>
    sensitiveSet.has(header.name.toLowerCase())
      ? { ...header, value: '***' }
      : header,
  );
}

export function parseQueryString(url: string): HarQueryString[] {
  const parsed = new URL(url, 'http://localhost');
  const query: HarQueryString[] = [];
  parsed.searchParams.forEach((value, name) => {
    query.push({ name, value });
  });
  return query;
}

export function maskQueryParams(
  queryParams: HarQueryString[],
  sensitive: string[],
): HarQueryString[] {
  const sensitiveSet = new Set(sensitive.map((param) => param.toLowerCase()));
  return queryParams.map((param) =>
    sensitiveSet.has(param.name.toLowerCase())
      ? { ...param, value: '***' }
      : param,
  );
}

export function maskUrlQueryParams(url: string, sensitive: string[]): string {
  try {
    const parsed = new URL(url);
    const sensitiveSet = new Set(sensitive.map((param) => param.toLowerCase()));
    const newParams = new URLSearchParams();
    parsed.searchParams.forEach((value, name) => {
      if (sensitiveSet.has(name.toLowerCase())) {
        newParams.append(name, '***');
      } else {
        newParams.append(name, value);
      }
    });
    parsed.search = newParams.toString();
    return parsed.toString();
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

export function truncateBody(
  body: string,
  maxSize: number,
): { text: string; truncated: boolean } {
  if (body.length <= maxSize) {
    return { text: body, truncated: false };
  }
  return { text: body.slice(0, maxSize), truncated: true };
}

export function buildHarRequest(
  input: HttpRequestInput,
  init: RequestInit | undefined,
  options: HttpInstrumentationOptions = {},
): HarRequest {
  let request: Request;
  if (input instanceof Request) {
    request = input;
  } else {
    const requestInput = input instanceof URL ? input.toString() : String(input);
    request = new Request(requestInput, init);
  }
  const sensitiveHeaders = options.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS;
  const sensitiveQueryParams = options.sensitiveQueryParams ?? DEFAULT_SENSITIVE_QUERY_PARAMS;
  const maxBodySize = options.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE;
  const rawBody = getBodyText(init?.body);
  const bodyText = rawBody ? truncateBody(rawBody, maxBodySize).text : undefined;
  const contentType = request.headers.get('content-type') ?? '';

  const headers = maskHeaders(headersToHar(request.headers), sensitiveHeaders);
  const rawQueryString = parseQueryString(request.url);
  const queryString = maskQueryParams(rawQueryString, sensitiveQueryParams);
  const maskedUrl = maskUrlQueryParams(request.url, sensitiveQueryParams);

  const postData = bodyText
    ? {
        mimeType: contentType || 'text/plain',
        text: bodyText,
      }
    : undefined;

  return {
    method: request.method,
    url: maskedUrl,
    httpVersion: DEFAULT_HTTP_VERSION,
    headers,
    queryString,
    cookies: [],
    headersSize: -1,
    bodySize: rawBody ? rawBody.length : 0,
    ...(postData ? { postData } : {}),
  };
}

export async function buildHarResponse(
  response: HttpResponseLike,
  options: HttpInstrumentationOptions = {},
): Promise<HarResponse> {
  const sensitiveHeaders = options.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS;
  const maxBodySize = options.maxResponseBodySize ?? DEFAULT_MAX_RESPONSE_BODY_SIZE;

  // Read body with streaming to avoid buffering entire response
  let bodyText = '';
  let totalSize = 0;
  let truncated = false;

  if (response.body) {
    // Use streaming to read only up to maxBodySize bytes
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        totalSize += value.byteLength;

        if (bodyText.length < maxBodySize) {
          const remaining = maxBodySize - bodyText.length;
          if (chunk.length <= remaining) {
            chunks.push(chunk);
            bodyText += chunk;
          } else {
            chunks.push(chunk.slice(0, remaining));
            bodyText += chunk.slice(0, remaining);
            truncated = true;
            // Cancel the stream to avoid reading remaining data
            await reader.cancel();
            break;
          }
        } else {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } catch {
      // If streaming fails, fall through and handle gracefully
    }
  } else {
    // Fallback for responses without streaming body
    const rawBody = await response.text();
    totalSize = rawBody.length;
    const result = truncateBody(rawBody, maxBodySize);
    bodyText = result.text;
    truncated = result.truncated;
  }

  const headers = maskHeaders(headersToHar(response.headers), sensitiveHeaders);
  const contentType = response.headers.get('content-type') ?? '';
  const redirectURL = response.headers.get('location') ?? '';

  return {
    status: response.status,
    statusText: response.statusText,
    httpVersion: DEFAULT_HTTP_VERSION,
    headers,
    cookies: [],
    content: {
      size: totalSize,
      mimeType: contentType,
      text: bodyText,
    },
    redirectURL,
    headersSize: -1,
    bodySize: totalSize,
  };
}

export function buildHarEntry(
  request: HarRequest,
  response: HarResponse,
  startTime: string,
  duration: number,
  timings: HarTimings,
): HarEntry {
  return {
    startedDateTime: startTime,
    time: duration,
    request,
    response,
    cache: {},
    timings,
  };
}

export function harToCurl(request: HarRequest): string {
  const parts = ['curl', '-X', request.method, quoteShellArg(request.url)];

  request.headers.forEach((header) => {
    parts.push('-H', quoteShellArg(`${header.name}: ${header.value}`));
  });

  if (request.postData?.text) {
    parts.push('--data-raw', quoteShellArg(request.postData.text));
  }

  return parts.join(' ');
}

const quoteShellArg = (value: string): string => {
  const escaped = value.replace(/'/g, `'\\''`);
  return `'${escaped}'`;
};
