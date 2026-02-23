import { describe, it, expect } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import { AuditLogService } from '../audit-log.service';
import type { AuditLogRepository } from '../audit-log.repository';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: ['MEMBER'],
    isAuthenticated: true,
    provider: 'local',
    ...overrides,
  };
}

describe('AuditLogService', () => {
  it('allows org admins to read audit logs', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(service.canRead(makeAuth({ roles: ['ADMIN'] }))).toBe(true);
  });

  it('allows API keys with audit.read=true to read audit logs', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(
      service.canRead(
        makeAuth({
          provider: 'api-key',
          roles: ['MEMBER'],
          apiKeyPermissions: {
            workflows: { run: false, list: false, read: false },
            runs: { read: false, cancel: false },
            audit: { read: true },
          },
        }),
      ),
    ).toBe(true);
  });

  it('denies API keys without audit.read', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(
      service.canRead(
        makeAuth({
          provider: 'api-key',
          roles: ['MEMBER'],
          apiKeyPermissions: {
            workflows: { run: true, list: true, read: true },
            runs: { read: true, cancel: true },
            audit: { read: false },
          },
        }),
      ),
    ).toBe(false);
  });

  it('record() never throws even if repository insert fails', async () => {
    let called = false;
    const repo: AuditLogRepository = {
      insert: async () => {
        called = true;
        throw new Error('db down');
      },
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);

    expect(() =>
      service.record(makeAuth({ roles: ['ADMIN'] }), {
        action: 'secret.access',
        resourceType: 'secret',
        resourceId: 'secret-1',
        resourceName: 'foo',
        metadata: { requestedVersion: 1 },
      }),
    ).not.toThrow();

    // Flush microtasks (record uses queueMicrotask).
    await Promise.resolve();
    expect(called).toBe(true);
  });
});
