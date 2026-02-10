import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import type { AuditActorType, AuditResourceType } from '../database/schema/audit-logs';
import { AuditLogRepository } from './audit-log.repository';

export interface AuditRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEventInput {
  action: string;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditLogsInput {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

function actorTypeFromAuth(auth: AuthContext | null): AuditActorType {
  if (!auth) return 'unknown';
  if (auth.provider === 'api-key') return 'api-key';
  if (auth.provider === 'internal') return 'internal';
  if (auth.isAuthenticated) return 'user';
  return 'unknown';
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAtIso, id] = raw.split('|');
    if (!createdAtIso || !id) return null;
    const createdAt = new Date(createdAtIso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  canRead(auth: AuthContext | null): boolean {
    if (!auth?.isAuthenticated) return false;

    if (auth.roles.includes('ADMIN')) {
      return true;
    }

    if (auth.provider === 'api-key') {
      return Boolean(auth.apiKeyPermissions?.audit?.read);
    }

    return false;
  }

  record(auth: AuthContext | null, event: AuditEventInput, meta?: AuditRequestMeta): void {
    const organizationId = auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const actorType = actorTypeFromAuth(auth);
    const actorId = auth?.userId ?? null;

    const values = {
      organizationId,
      actorId,
      actorType,
      actorDisplay: null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      resourceName: event.resourceName ?? null,
      metadata: event.metadata ?? null,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    };

    // Non-blocking: audit logging must never affect API latency or success.
    queueMicrotask(() => {
      this.repository.insert(values).catch((error) => {
        this.logger.warn(
          `Failed to write audit log action=${event.action} resourceType=${event.resourceType}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }

  async list(auth: AuthContext | null, input: ListAuditLogsInput) {
    if (!this.canRead(auth)) {
      throw new ForbiddenException('Audit log access denied');
    }

    const organizationId = auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    const items = await this.repository.list({
      organizationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      actorId: input.actorId,
      from: input.from,
      to: input.to,
      limit: input.limit,
      cursor: cursor ?? undefined,
    });

    const nextCursor =
      items.length === input.limit
        ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
        : null;

    return { items, nextCursor };
  }
}
