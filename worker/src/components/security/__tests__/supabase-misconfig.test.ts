import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'bun:test';
import { componentRegistry } from '../../index';
import type {
  SupabaseMisconfigInput,
  SupabaseMisconfigOutput,
} from '../supabase-misconfig';
import * as sdk from '@shipsec/component-sdk';

const queryMock = vi.fn<(sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>>();

vi.mock('pg', () => {
  class MockClient {
    connect = vi.fn(async () => {});
    end = vi.fn(async () => {});
    async query(sql: string) {
      return queryMock(sql);
    }
  }

  return {
    Client: MockClient,
  };
});

const fetchMock = vi.fn<typeof fetch>();
const fetchResponses = new Map<string, unknown>();
const originalFetch = globalThis.fetch;

function setFetchResponse(path: string, payload: unknown) {
  fetchResponses.set(path.replace(/^\//, ''), payload);
}

describe('supabase misconfiguration component', () => {
  beforeAll(async () => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await import('../../index');
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
  });

  beforeEach(() => {
    // Mock global fetch
    globalThis.fetch = fetchMock as typeof fetch;
    
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('relrowsecurity = false')) {
        return { rows: [] };
      }
      if (sql.includes('NOT EXISTS')) {
        return { rows: [] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolname: 'postgres' }] };
      }
      if (sql.includes('has_function_privilege')) {
        return { rows: [] };
      }
      if (sql.trim().toLowerCase().startsWith('show log_statement')) {
        return { rows: [{ setting: 'ddl' }] };
      }
      if (sql.trim().toLowerCase().startsWith('show ssl')) {
        return { rows: [{ setting: 'on' }] };
      }
      if (sql.includes('pg_extension')) {
        return { rows: [{ extname: 'plpgsql' }] };
      }

      return { rows: [] };
    });

    fetchResponses.clear();
    setFetchResponse('auth/v1/settings', {
      AUTO_CONFIRM_EMAIL: false,
      MFA: { ENABLED: true },
      PASSWORD_MIN_LENGTH: 12,
      ALLOW_SIGNUPS: false,
      JWT_EXPIRY: 3600,
    });
    setFetchResponse('storage/v1/bucket', [{ name: 'avatars', public: false }]);
    setFetchResponse('storage/v1/policies', []);

    fetchMock.mockImplementation(async (input: Request | string | URL) => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      const key = url.pathname.replace(/^\//, '');
      if (!fetchResponses.has(key)) {
        return new Response('Not Found', { status: 404 });
      }

      return new Response(JSON.stringify(fetchResponses.get(key)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('registers the component with metadata', () => {
    const component =
      componentRegistry.get<SupabaseMisconfigInput, SupabaseMisconfigOutput>(
        'shipsec.supabase.misconfig',
      );
    expect(component).toBeDefined();
    expect(component?.label).toBe('Supabase Misconfiguration Scan');
    expect(component?.metadata?.slug).toBe('supabase-misconfig');
  });

  it('passes when configuration is secure', async () => {
    const component =
      componentRegistry.get<SupabaseMisconfigInput, SupabaseMisconfigOutput>(
        'shipsec.supabase.misconfig',
      );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'supabase-misconfig',
    });

    const params = component.inputSchema.parse({
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    });

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.summary.checksFailed).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.summary.checksTotal).toBeGreaterThan(0);
    expect(result.rawReport).toContain('"checks"');
  });

  it('reports findings for risky configuration', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('relrowsecurity = false')) {
        return { rows: [{ schema: 'public', table: 'users' }] };
      }
      if (sql.includes('NOT EXISTS')) {
        return { rows: [{ schema: 'public', table: 'payments' }] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolname: 'postgres' }, { rolname: 'debug_role' }] };
      }
      if (sql.includes('has_function_privilege')) {
        return { rows: [{ schema: 'public', function: 'dangerous_fn' }] };
      }
      if (sql.trim().toLowerCase().startsWith('show log_statement')) {
        return { rows: [{ setting: 'none' }] };
      }
      if (sql.trim().toLowerCase().startsWith('show ssl')) {
        return { rows: [{ setting: 'off' }] };
      }
      if (sql.includes('pg_extension')) {
        return { rows: [{ extname: 'dblink' }] };
      }

      return { rows: [] };
    });

    setFetchResponse('auth/v1/settings', {
      AUTO_CONFIRM_EMAIL: true,
      MFA: { ENABLED: false },
      PASSWORD_MIN_LENGTH: 6,
      ALLOW_SIGNUPS: true,
      JWT_EXPIRY: 7200,
    });
    setFetchResponse('storage/v1/bucket', [
      { name: 'avatars', public: true },
      { name: 'documents', public: false },
    ]);
    setFetchResponse('storage/v1/policies', [
      { name: 'allow_public_read', definition: 'allow read for role = public', bucket_id: 'avatars' },
    ]);
    setFetchResponse('functions/v1/list', [{ name: 'public-function', verify_jwt: false }]);

    const component =
      componentRegistry.get<SupabaseMisconfigInput, SupabaseMisconfigOutput>(
        'shipsec.supabase.misconfig',
      );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'supabase-misconfig',
    });

    const params = component.inputSchema.parse({
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      serviceRoleKey: 'test-service-role-key',
      includeEnvScan: true,
      includeEdgeFunctions: true,
      envFiles: [
        {
          fileName: '.env.production',
          content: 'SUPABASE_SERVICE_ROLE_KEY=secret\nSUPABASE_ANON_KEY=anon',
        },
      ],
    });

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.summary.checksFailed).toBeGreaterThan(0);
    const findingIds = result.findings.map((finding) => finding.id);
    expect(findingIds).toContain('DB_RLS_PUBLIC_TABLE');
    expect(findingIds).toContain('ENV_SERVICE_ROLE_EXPOSED');
    expect(findingIds).toContain('EDGE_FUNCTION_PUBLIC');
    expect(result.rawReport).toContain('DB_RLS_PUBLIC_TABLE');
  });
});
