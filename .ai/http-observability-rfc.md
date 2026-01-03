# HTTP Observability RFC

## Overview

This document specifies the design for first-class HTTP observability in ShipSec Studio. The goal is to make every HTTP call from components fully inspectable, with request/response details, timing breakdowns, and HAR-format export.

## Goals

1. **Full Visibility** - See exactly what was sent (request) and received (response) for every HTTP call
2. **Real-time Streaming** - Request event emitted immediately when sent, response event when received
3. **HAR Compatibility** - Use standard HAR 1.2 format for Chrome DevTools import/export
4. **Granular Timing** - DNS, connect, TLS, TTFB phases (via Undici diagnostics)
5. **Security** - Automatic masking of sensitive headers (API keys, tokens)
6. **Runtime Agnostic** - Adapter pattern for future Bun/Deno support

---

## Phase 1: Add HTTP Trace Event Types

### Files to Modify

1. **`packages/shared/src/execution.ts`**
   ```typescript
   // Line 85: Add new event types
   export const TRACE_EVENT_TYPES = [
     'STARTED',
     'PROGRESS', 
     'COMPLETED',
     'FAILED',
     'AWAITING_INPUT',
     'SKIPPED',
     'HTTP_REQUEST_SENT',      // NEW
     'HTTP_RESPONSE_RECEIVED', // NEW
     'HTTP_REQUEST_ERROR',     // NEW
   ] as const;
   ```

2. **`packages/component-sdk/src/interfaces.ts`**
   ```typescript
   // Line 143-144: Add new event types
   export interface TraceEvent {
     type: 
       | 'NODE_STARTED' 
       | 'NODE_COMPLETED' 
       | 'NODE_FAILED' 
       | 'NODE_PROGRESS' 
       | 'AWAITING_INPUT' 
       | 'NODE_SKIPPED'
       | 'HTTP_REQUEST_SENT'      // NEW
       | 'HTTP_RESPONSE_RECEIVED' // NEW
       | 'HTTP_REQUEST_ERROR'     // NEW
       ;
     // ... rest unchanged
   }
   ```

3. **`backend/src/trace/types.ts`**
   ```typescript
   export type TraceEventType =
     | 'NODE_STARTED'
     | 'NODE_COMPLETED'
     | 'NODE_FAILED'
     | 'NODE_PROGRESS'
     | 'AWAITING_INPUT'
     | 'NODE_SKIPPED'
     | 'HTTP_REQUEST_SENT'      // NEW
     | 'HTTP_RESPONSE_RECEIVED' // NEW
     | 'HTTP_REQUEST_ERROR'     // NEW
     ;
   
   // Add new event interfaces
   export interface HttpRequestSentEvent extends TraceEventBase {
     type: 'HTTP_REQUEST_SENT';
     data: {
       correlationId: string;
       request: HarRequest; // from har-format types
     };
   }
   
   export interface HttpResponseReceivedEvent extends TraceEventBase {
     type: 'HTTP_RESPONSE_RECEIVED';
     data: {
       correlationId: string;
       har: HarEntry; // Complete HAR entry
     };
   }

   export interface HttpRequestErrorEvent extends TraceEventBase {
     type: 'HTTP_REQUEST_ERROR';
     data: {
       correlationId: string;
       request: HarRequest;
       error: {
         message: string;
         name?: string;
       };
     };
   }
   ```

4. **`backend/src/trace/trace.service.ts`**
   - Update `mapEventType` so `HTTP_*` types pass through instead of mapping to `PROGRESS`

5. **`worker/src/adapters/schema/traces.schema.ts`** + **`backend/src/database/schema/traces.ts`**
   - Extend the allowed `type` union to include the new `HTTP_*` types

---

## Phase 2: HAR Types in SDK

### Files to Create

1. **`packages/component-sdk/src/http/types.ts`**
   
   - Re-export types from `@types/har-format`
   - Define `HttpInstrumentationOptions`
   - Define `DEFAULT_SENSITIVE_HEADERS` list
   - Define body size limits

### Dependencies

```bash
# In packages/component-sdk
bun add -d @types/har-format
```

### Types to Define

```typescript
import type { Entry, Request, Response, Timings, Header } from 'har-format';

export type { 
  Entry as HarEntry, 
  Request as HarRequest, 
  Response as HarResponse, 
  Timings as HarTimings,
  Header as HarHeader,
};

export interface HttpInstrumentationOptions {
  maxRequestBodySize?: number;   // Default: 10KB
  maxResponseBodySize?: number;  // Default: 50KB
  sensitiveHeaders?: string[];   // Headers to mask
  correlationId?: string;        // Custom correlation ID
}

export const DEFAULT_SENSITIVE_HEADERS = [
  'authorization', 'x-api-key', 'api-key', 'key', 'token', 
  'bearer', 'secret', 'password', 'cookie', 'set-cookie',
];
```

---

## Phase 3: Timing Adapter Interface

### Files to Create

1. **`packages/component-sdk/src/http/adapters/interface.ts`**

```typescript
export interface IHttpTimingAdapter {
  startTracking(correlationId: string, url: string): void;
  stopTracking(correlationId: string): Partial<HarTimings>;
  dispose(): void;
}

export class NoOpTimingAdapter implements IHttpTimingAdapter {
  startTracking(): void {}
  stopTracking(): Partial<HarTimings> {
    return { blocked: -1, dns: -1, connect: -1, ssl: -1, send: -1, wait: -1, receive: -1 };
  }
  dispose(): void {}
}
```

2. **`packages/component-sdk/src/http/adapters/index.ts`**
   
   - Export `getTimingAdapter()` factory function
   - This is THE ONE PLACE to swap runtimes

---

## Phase 4: Undici Adapter (Node.js)

### Files to Create

1. **`packages/component-sdk/src/http/adapters/undici.adapter.ts`**

### Undici Diagnostic Channels to Subscribe

| Channel | Use |
|---------|-----|
| `undici:request:create` | Request created timestamp |
| `undici:client:beforeConnect` | DNS start |
| `undici:client:connected` | Connect end |
| `undici:client:sendHeaders` | Headers sent (request complete) |
| `undici:request:headers` | Response headers received (TTFB) |

### Implementation Notes

- Use `performance.now()` for high-resolution timing
- Map URL → correlationId for channel callbacks
- Calculate timing phases from captured timestamps
- Gracefully handle missing channels (older Node versions)

---

## Phase 5: HAR Builder Utilities

### Files to Create

1. **`packages/component-sdk/src/http/har-builder.ts`**

### Functions to Implement

```typescript
// Convert Headers to HAR format
headersToHar(headers: Headers | Record<string, string>): HarHeader[]

// Mask sensitive headers
maskHeaders(headers: HarHeader[], sensitive: string[]): HarHeader[]

// Parse URL query string
parseQueryString(url: string): QueryString[]

// Truncate large bodies
truncateBody(body: string, maxSize: number): { text: string; truncated: boolean }

// Build HAR Request from fetch inputs
buildHarRequest(input: RequestInfo, init: RequestInit, options: HttpInstrumentationOptions): HarRequest

// Build HAR Response from fetch Response
buildHarResponse(response: Response, options: HttpInstrumentationOptions): Promise<HarResponse>

// Build complete HAR Entry
buildHarEntry(request: HarRequest, response: HarResponse, startTime: string, duration: number, timings: HarTimings): HarEntry

// Generate cURL command for debugging
harToCurl(request: HarRequest): string
```

---

## Phase 6: Instrumented Fetch

### Files to Create

1. **`packages/component-sdk/src/http/instrumented-fetch.ts`**

### Main Function Signature

```typescript
async function instrumentedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: ExecutionContext,
  options?: HttpInstrumentationOptions
): Promise<Response>
```

### Behavior

1. Generate `correlationId` (or use provided one)
2. Start timing adapter tracking
3. Build HAR request
4. **Emit `HTTP_REQUEST_SENT` trace event immediately**
5. Call native `fetch()`
6. On error: stop timing, emit `HTTP_REQUEST_ERROR`, throw
7. On success: stop timing, build HAR response **from a cloned response**
8. **Emit `HTTP_RESPONSE_RECEIVED` trace event with full HAR entry**
9. Return original response (unconsumed body)

**Important:** use `const responseForHar = response.clone()` and read the body from `responseForHar` to avoid consuming the body that components need.

### Context Helper

```typescript
function createHttpClient(context: ExecutionContext, defaultOptions?: HttpInstrumentationOptions) {
  return {
    fetch: (input, init, options) => instrumentedFetch(input, init, context, {...defaultOptions, ...options}),
    toCurl: (input, init) => harToCurl(buildHarRequest(input, init, defaultOptions)),
  };
}
```

---

## Phase 7: Wire into Execution Context

### Files to Modify

1. **`packages/component-sdk/src/types.ts`**
   
   Add `http` property to `ExecutionContext`:
   ```typescript
   export interface ExecutionContext {
     // ... existing properties
     http: {
       fetch: (input: RequestInfo | URL, init?: RequestInit, options?: HttpInstrumentationOptions) => Promise<Response>;
       toCurl: (input: RequestInfo | URL, init?: RequestInit) => string;
     };
   }
   ```

2. **`packages/component-sdk/src/context.ts`**
   
   In `createExecutionContext()`:
   ```typescript
   const http = createHttpClient(context);
   // ... assign to context.http
   ```

3. **`worker/src/testing/test-utils.ts`** + **unit tests with inline `ExecutionContext` mocks**
   - Add a default `http` stub so tests do not break when `http` becomes required

---

## Phase 8: Migrate Components

### Components to Update

1. **`worker/src/components/core/http-request.ts`**
   - Replace `fetch()` with `context.http.fetch()`

2. **`worker/src/components/security/abuseipdb.ts`**
   - Replace `fetch()` with `context.http.fetch()`

3. **Other API wrappers**
   - `worker/src/components/notification/slack.ts`
   - `worker/src/components/security/virustotal.ts`
   - `worker/src/components/github/remove-org-membership.ts`
   - `worker/src/components/ai/ai-agent.ts`
   - `worker/src/components/security/atlassian-offboarding.ts`
   - (Skip `core/logic-script.ts` and Docker-based fetch usage for now)

### Migration Pattern

```diff
- const response = await fetch(url, {
-   method: 'GET',
-   headers: { 'Key': apiKey }
- });
+ const response = await context.http.fetch(url, {
+   method: 'GET',
+   headers: { 'Key': apiKey }
+ }, { sensitiveHeaders: ['key'] });
```

---

## Phase 9: Frontend HTTP Events + Panel

### Required event wiring (current UI)

1. **`frontend/src/store/executionTimelineStore.ts`**
   - Treat `HTTP_REQUEST_SENT` + `HTTP_RESPONSE_RECEIVED` + `HTTP_REQUEST_ERROR` as non-terminal events (status stays `running`)
   - Do not let HTTP events override node status computed from `STARTED/COMPLETED/FAILED`

2. **`frontend/src/components/timeline/EventInspector.tsx`**
   - Add icon + tone mappings for `HTTP_*` events so the inspector renders without crashing

3. **`frontend/src/components/timeline/ExecutionTimeline.tsx`**
   - Add colors for `HTTP_*` types so timeline bars are consistent

### New Components to Create (future)

1. **`frontend/src/components/timeline/HttpExchangePanel.tsx`**
   - Display request/response in side-by-side or tabbed view
   - Syntax highlighting for JSON bodies
   - Copy as cURL button
   - HAR export button

2. **`frontend/src/components/timeline/HttpTimelineEvent.tsx`**
   - Compact view in timeline
   - Shows: `GET https://api.example.com → 200 OK (245ms)`
   - Expandable to show full details

### UI Inspiration

- Chrome DevTools Network panel
- Postman request/response view
- Insomnia HTTP client

---

## Data Flow Diagram

```
Component calls context.http.fetch()
         │
         ▼
┌─────────────────────────────┐
│    instrumentedFetch()      │
├─────────────────────────────┤
│ 1. Build HAR Request        │
│ 2. Start timing adapter     │
│ 3. Emit HTTP_REQUEST_SENT   │──────▶ Trace DB (data: { correlationId, request })
│ 4. Call native fetch()      │
│ 5. Stop timing adapter      │
│ 6. Build HAR Response       │
│ 7. Emit HTTP_RESPONSE_RECV  │──────▶ Trace DB (data: { correlationId, har })
│ 8. Return Response          │
└─────────────────────────────┘
         │
         ▼
    Component continues
```

---

## Database Storage

HTTP data stored in existing `workflow_traces.data` JSONB column:

```sql
-- HTTP_REQUEST_SENT event
{
  "_payload": {
    "correlationId": "uuid",
    "request": { /* HAR Request object */ }
  },
  "_metadata": { /* packed trace metadata */ }
}

-- HTTP_RESPONSE_RECEIVED event  
{
  "_payload": {
    "correlationId": "uuid",
    "har": { /* Complete HAR Entry */ }
  },
  "_metadata": { /* packed trace metadata */ }
}

-- HTTP_REQUEST_ERROR event
{
  "_payload": {
    "correlationId": "uuid",
    "request": { /* HAR Request object */ },
    "error": { "message": "Network error", "name": "FetchError" }
  },
  "_metadata": { /* packed trace metadata */ }
}
```

### Size Considerations

- Request body: truncated at 10KB
- Response body: truncated at 50KB
- Original size stored in HAR for reference
- Consider retention policy for old traces

---

## Testing Strategy

### Unit Tests

1. HAR builder functions
2. Header masking
3. Body truncation
4. Timing adapter (with mocked diagnostics_channel)

### Integration Tests

1. Full instrumented fetch flow
2. Trace event emission
3. HAR export compatibility

### E2E Tests

1. Run workflow with HTTP component
2. Verify trace events in database
3. Export HAR, import into Chrome DevTools

---

## Open Questions

1. **Should we add `HTTP_REQUEST_ERROR` as a third event type?**
   - ✅ Resolved: add `HTTP_REQUEST_ERROR` so the UI can render error rows in the trace stream

2. **Should HAR export be per-run or per-node?**
   - Per-run: all HTTP calls in one HAR file
   - Per-node: each component's calls separately

3. **Timing adapter singleton vs per-request?**
   - Current design: singleton adapter
   - Alternative: create adapter per context

---

## Implementation Order

1. ✅ Add `@types/har-format` dependency
2. ▢ Add HTTP trace event types to shared/SDK/backend + schema unions + trace service mapping
3. ▢ Create `http/types.ts` with HAR re-exports
4. ▢ Create adapter interface + NoOp adapter
5. ▢ Create Undici adapter (Node runtime)
6. ▢ Create HAR builder utilities
7. ▢ Create instrumented fetch (clone response before reading)
8. ▢ Wire into execution context + update test mocks
9. ▢ Update frontend event handling for `HTTP_*` (inspector + timeline store + colors)
10. ▢ Migrate `http-request` + `abuseipdb` + other inline fetch components (skip logic-script)
11. ▢ Add unit tests
12. ▢ Add integration tests
13. ▢ Frontend HTTP panel (separate PR)
