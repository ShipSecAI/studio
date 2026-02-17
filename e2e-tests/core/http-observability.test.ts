/**
 * E2E Tests - HTTP Observability
 *
 * Validates that HTTP requests made by components are traced and HAR data is captured.
 *
 * These tests require:
 * - Backend API running on http://localhost:3211
 * - Worker running and component registry loaded
 * - Temporal, Postgres, and other infrastructure running
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  getTraceEvents,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

let servicesAvailable = false;

beforeAll(async () => {
  console.log('\n  E2E Test Suite: HTTP Observability');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('  Backend API is not available. Tests will be skipped.');
    return;
  }
  console.log('  Backend API is running');
});

afterAll(async () => {
  console.log('  Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('HTTP Observability E2E Tests', () => {
  e2eTest('HTTP Request component captures HAR data in trace', { timeout: 120000 }, async () => {
    console.log('\n  Test: HTTP Request captures HAR data');

    const wf = {
      name: 'Test: HTTP Observability',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
        },
        {
          id: 'http-call',
          type: 'core.http.request',
          position: { x: 200, y: 0 },
          data: {
            label: 'HTTP Request',
            config: {
              params: {
                method: 'GET',
                authType: 'none',
                contentType: 'application/json',
                timeout: 30000,
                failOnError: false,
              },
              inputOverrides: {
                url: 'https://httpbin.org/get?test=http-observability',
              },
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'http-call' }],
    };

    const res = await fetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(wf)
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Workflow creation failed: ${res.status} - ${error}`);
    }
    const { id } = await res.json();
    console.log(`  Workflow ID: ${id}`);

    const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ inputs: {} })
    });
    if (!runRes.ok) {
      const error = await runRes.text();
      throw new Error(`Workflow run failed: ${runRes.status} - ${error}`);
    }
    const { runId } = await runRes.json();
    console.log(`  Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const events = await getTraceEvents(runId);

    const httpRequestSentEvents = events.filter((e: any) => e.type === 'HTTP_REQUEST_SENT');
    console.log(`  HTTP_REQUEST_SENT events: ${httpRequestSentEvents.length}`);
    expect(httpRequestSentEvents.length).toBeGreaterThanOrEqual(1);

    const httpResponseReceivedEvents = events.filter((e: any) => e.type === 'HTTP_RESPONSE_RECEIVED');
    console.log(`  HTTP_RESPONSE_RECEIVED events: ${httpResponseReceivedEvents.length}`);
    expect(httpResponseReceivedEvents.length).toBeGreaterThanOrEqual(1);

    const requestEvent = httpRequestSentEvents[0];
    console.log(`  Request event data keys: ${Object.keys(requestEvent.data || {}).join(', ')}`);
    expect(requestEvent.data).toBeDefined();
    expect(requestEvent.data.correlationId).toBeDefined();
    expect(requestEvent.data.request).toBeDefined();
    expect(requestEvent.data.request.method).toBe('GET');
    expect(requestEvent.data.request.url).toContain('httpbin.org');

    const responseEvent = httpResponseReceivedEvents[0];
    console.log(`  Response event data keys: ${Object.keys(responseEvent.data || {}).join(', ')}`);
    expect(responseEvent.data).toBeDefined();
    expect(responseEvent.data.correlationId).toBeDefined();
    expect(responseEvent.data.har).toBeDefined();

    const harEntry = responseEvent.data.har;
    console.log(`  HAR entry keys: ${Object.keys(harEntry || {}).join(', ')}`);
    expect(harEntry.startedDateTime).toBeDefined();
    expect(harEntry.time).toBeDefined();
    expect(harEntry.request).toBeDefined();
    expect(harEntry.response).toBeDefined();
    expect(harEntry.timings).toBeDefined();

    expect(harEntry.request.method).toBe('GET');
    expect(harEntry.request.url).toContain('httpbin.org');
    expect(harEntry.request.headers).toBeDefined();
    expect(Array.isArray(harEntry.request.headers)).toBe(true);

    expect(harEntry.response.status).toBe(200);
    expect(harEntry.response.statusText).toBeDefined();
    expect(harEntry.response.headers).toBeDefined();
    expect(Array.isArray(harEntry.response.headers)).toBe(true);
    expect(harEntry.response.content).toBeDefined();

    expect(harEntry.timings).toHaveProperty('wait');
    expect(harEntry.timings).toHaveProperty('receive');

    console.log(`  HAR data captured successfully!`);
    console.log(`  Response status: ${harEntry.response.status}`);
    console.log(`  Total time: ${harEntry.time.toFixed(2)}ms`);
  });

  e2eTest('HTTP errors are captured in trace', { timeout: 120000 }, async () => {
    console.log('\n  Test: HTTP errors captured in trace');

    const wf = {
      name: 'Test: HTTP Error Tracing',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
        },
        {
          id: 'http-call',
          type: 'core.http.request',
          position: { x: 200, y: 0 },
          data: {
            label: 'HTTP Request',
            config: {
              params: {
                method: 'GET',
                authType: 'none',
                contentType: 'application/json',
                timeout: 30000,
                failOnError: false,
              },
              inputOverrides: {
                url: 'https://httpbin.org/status/404',
              },
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'http-call' }],
    };

    const res = await fetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(wf)
    });
    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Workflow creation failed: ${res.status} - ${errorBody}`);
    }
    const { id } = await res.json();
    console.log(`  Workflow ID: ${id}`);

    const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ inputs: {} })
    });
    if (!runRes.ok) throw new Error(`Workflow run failed: ${runRes.status}`);
    const { runId } = await runRes.json();
    console.log(`  Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const events = await getTraceEvents(runId);

    const httpResponseEvents = events.filter((e: any) => e.type === 'HTTP_RESPONSE_RECEIVED');
    expect(httpResponseEvents.length).toBeGreaterThanOrEqual(1);

    const responseEvent = httpResponseEvents[0];
    const harEntry = responseEvent.data?.har;
    expect(harEntry).toBeDefined();
    expect(harEntry.response.status).toBe(404);

    console.log(`  HTTP 404 error captured in HAR!`);
    console.log(`  Response status: ${harEntry.response.status}`);
  });

  e2eTest('Multiple HTTP requests are all traced', { timeout: 180000 }, async () => {
    console.log('\n  Test: Multiple HTTP requests all traced');

    const wf = {
      name: 'Test: Multiple HTTP Requests',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
        },
        {
          id: 'http-1',
          type: 'core.http.request',
          position: { x: 200, y: 0 },
          data: {
            label: 'HTTP Request 1',
            config: {
              params: {
                method: 'GET',
                authType: 'none',
                contentType: 'application/json',
                timeout: 30000,
                failOnError: false,
              },
              inputOverrides: {
                url: 'https://httpbin.org/get?request=1',
              },
            },
          },
        },
        {
          id: 'http-2',
          type: 'core.http.request',
          position: { x: 400, y: 0 },
          data: {
            label: 'HTTP Request 2',
            config: {
              params: {
                method: 'POST',
                authType: 'none',
                contentType: 'application/json',
                timeout: 30000,
                failOnError: false,
              },
              inputOverrides: {
                url: 'https://httpbin.org/post',
                body: '{"message": "hello from test"}',
              },
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'http-1' },
        { id: 'e2', source: 'http-1', target: 'http-2' },
      ],
    };

    const res = await fetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(wf)
    });
    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Workflow creation failed: ${res.status} - ${errorBody}`);
    }
    const { id } = await res.json();
    console.log(`  Workflow ID: ${id}`);

    const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ inputs: {} })
    });
    if (!runRes.ok) throw new Error(`Workflow run failed: ${runRes.status}`);
    const { runId } = await runRes.json();
    console.log(`  Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const events = await getTraceEvents(runId);

    const httpRequestEvents = events.filter((e: any) => e.type === 'HTTP_REQUEST_SENT');
    const httpResponseEvents = events.filter((e: any) => e.type === 'HTTP_RESPONSE_RECEIVED');

    console.log(`  HTTP_REQUEST_SENT events: ${httpRequestEvents.length}`);
    console.log(`  HTTP_RESPONSE_RECEIVED events: ${httpResponseEvents.length}`);

    expect(httpRequestEvents.length).toBeGreaterThanOrEqual(2);
    expect(httpResponseEvents.length).toBeGreaterThanOrEqual(2);

    const methods = httpResponseEvents.map((e: any) => e.data?.har?.request?.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');

    const correlationIds = httpRequestEvents.map((e: any) => e.data?.correlationId);
    const uniqueIds = new Set(correlationIds);
    expect(uniqueIds.size).toBe(correlationIds.length);

    console.log(`  Multiple HTTP requests traced with unique correlation IDs!`);
  });
});
