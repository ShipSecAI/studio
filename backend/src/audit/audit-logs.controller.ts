import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuditLogService } from './audit-log.service';
import {
  ListAuditLogsQueryDto,
  type ListAuditLogsQuery,
  ListAuditLogsQuerySchema,
  ListAuditLogsResponseDto,
} from './dto/audit-logs.dto';

@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOkResponse({
    description: 'List audit log events for the authenticated organization',
    type: ListAuditLogsResponseDto,
  })
  async list(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema)) query: ListAuditLogsQueryDto,
  ): Promise<ListAuditLogsResponseDto> {
    const normalizedQuery: ListAuditLogsQuery = {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorId: query.actorId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
    };

    const from = normalizedQuery.from ? new Date(normalizedQuery.from) : undefined;
    const to = normalizedQuery.to ? new Date(normalizedQuery.to) : undefined;

    const result = await this.auditLogService.list(auth, {
      resourceType: normalizedQuery.resourceType,
      resourceId: normalizedQuery.resourceId,
      action: normalizedQuery.action,
      actorId: normalizedQuery.actorId,
      from,
      to,
      limit: normalizedQuery.limit,
      cursor: normalizedQuery.cursor,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id,
        organizationId: item.organizationId ?? null,
        actorId: item.actorId ?? null,
        actorType: item.actorType,
        actorDisplay: item.actorDisplay ?? null,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId ?? null,
        resourceName: item.resourceName ?? null,
        metadata: item.metadata ?? null,
        ip: item.ip ?? null,
        userAgent: item.userAgent ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
