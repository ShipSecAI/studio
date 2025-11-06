import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { importWorkflows } from '../workflows-import';

const baseGraphPayload = {
  nodes: [
    {
      id: 'trigger',
      type: 'core.trigger.manual',
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
} as const;

const stringifyWorkflow = (name: string, description?: string) =>
  JSON.stringify(
    {
      name,
      description,
      ...baseGraphPayload,
    },
    null,
    2,
  );

describe('scripts/workflows-import', () => {
  it('creates new workflows and updates existing ones', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-import-'));
    const originalFetch = globalThis.fetch;

    try {
      writeFileSync(join(directory, 'existing.json'), stringifyWorkflow('Existing Workflow'), 'utf8');
      writeFileSync(join(directory, 'fresh.json'), stringifyWorkflow('Fresh Workflow', 'created via test'), 'utf8');

      const requests: Array<{ url: string; method: string; body?: any }> = [];

      const fetchMock = vi.fn().mockImplementation(async (input: any, init?: any) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        requests.push({ url: url.toString(), method, body });

        if (method === 'GET' && url.pathname === '/workflows') {
          return new Response(JSON.stringify([{ id: 'wf-existing', name: 'Existing Workflow' }]), {
            status: 200,
          });
        }

        if (method === 'PUT' && url.pathname === '/workflows/wf-existing') {
          expect(body).toMatchObject({
            id: 'wf-existing',
            name: 'Existing Workflow',
          });
          return new Response(JSON.stringify({ id: 'wf-existing' }), { status: 200 });
        }

        if (method === 'POST' && url.pathname === '/workflows') {
          expect(body).toMatchObject({
            name: 'Fresh Workflow',
            description: 'created via test',
            nodes: expect.any(Array),
            edges: expect.any(Array),
          });
          return new Response(JSON.stringify({ id: 'wf-fresh' }), { status: 200 });
        }

        throw new Error(`Unexpected fetch call: ${method} ${url}`);
      });

      globalThis.fetch = fetchMock as any;

      const stats = await importWorkflows({
        directory,
        baseUrl: 'http://localhost:3211',
      });

      expect(stats).toEqual({
        created: 1,
        updated: 1,
        skipped: 0,
        failed: 0,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(requests[1]?.method).toBe('PUT');
      expect(requests[2]?.method).toBe('POST');
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(directory, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('skips duplicate workflow names within the same directory', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-import-'));
    const originalFetch = globalThis.fetch;

    try {
      writeFileSync(join(directory, 'alpha.json'), stringifyWorkflow('Duplicate Workflow'), 'utf8');
      writeFileSync(join(directory, 'bravo.json'), stringifyWorkflow('Duplicate Workflow'), 'utf8');

      const fetchMock = vi.fn().mockImplementation(async (input: any, init?: any) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.pathname === '/workflows') {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (method === 'POST' && url.pathname === '/workflows') {
          return new Response(JSON.stringify({ id: 'wf-duplicate' }), { status: 200 });
        }

        throw new Error(`Unexpected fetch call: ${method} ${url}`);
      });

      globalThis.fetch = fetchMock as any;

      const stats = await importWorkflows({
        directory,
        baseUrl: 'http://localhost:3211',
      });

      expect(stats).toEqual({
        created: 1,
        updated: 0,
        skipped: 1,
        failed: 0,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(directory, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('counts invalid workflow files as failed imports', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-import-'));
    const originalFetch = globalThis.fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      writeFileSync(join(directory, 'invalid.json'), '{ "name": "Broken Workflow"', 'utf8');

      const fetchMock = vi.fn().mockImplementation(async (input: any, init?: any) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.pathname === '/workflows') {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected fetch call: ${method} ${url}`);
      });

      globalThis.fetch = fetchMock as any;

      const stats = await importWorkflows({
        directory,
        baseUrl: 'http://localhost:3211',
      });

      expect(stats).toEqual({
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/❌ Failed to import/));
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(directory, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});
