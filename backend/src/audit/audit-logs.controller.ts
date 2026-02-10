import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuditLogService } from './audit-log.service';
import {
  ListAuditLogsQuerySchema,
  type ListAuditLogsQueryDto,
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
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const result = await this.auditLogService.list(auth, {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorId: query.actorId,
      from,
      to,
      limit: query.limit,
      cursor: query.cursor,
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
        metadata: (item.metadata as any) ?? null,
        ip: item.ip ?? null,
        userAgent: item.userAgent ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
