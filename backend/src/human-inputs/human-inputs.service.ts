import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { humanInputRequests as humanInputRequestsTable } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  ResolveHumanInputDto,
  ListHumanInputsQueryDto,
  HumanInputResponseDto,
  PublicResolveResultDto,
} from './dto/human-inputs.dto';
import { TemporalService } from '../temporal/temporal.service';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';

@Injectable()
export class HumanInputsService {
  private readonly logger = new Logger(HumanInputsService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly temporalService: TemporalService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(
    query?: ListHumanInputsQueryDto,
    organizationId?: string,
  ): Promise<HumanInputResponseDto[]> {
    const conditions = [];

    // SECURITY: Always filter by organization
    if (organizationId) {
      conditions.push(eq(humanInputRequestsTable.organizationId, organizationId));
    }

    if (query?.status) {
      conditions.push(eq(humanInputRequestsTable.status, query.status));
    }

    if (query?.inputType) {
      conditions.push(eq(humanInputRequestsTable.inputType, query.inputType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db.query.humanInputRequests.findMany({
      where: whereClause,
      orderBy: [desc(humanInputRequestsTable.createdAt)],
    });

    return results as unknown as HumanInputResponseDto[];
  }

  async getById(id: string, organizationId?: string): Promise<HumanInputResponseDto> {
    const conditions = [eq(humanInputRequestsTable.id, id)];

    // SECURITY: Always filter by organization
    if (organizationId) {
      conditions.push(eq(humanInputRequestsTable.organizationId, organizationId));
    }

    const request = await this.db.query.humanInputRequests.findFirst({
      where: and(...conditions),
    });

    if (!request) {
      throw new NotFoundException(`Human input request with ID ${id} not found`);
    }

    return request as unknown as HumanInputResponseDto;
  }

  async resolve(
    id: string,
    dto: ResolveHumanInputDto,
    organizationId?: string,
    auth?: AuthContext | null,
  ): Promise<HumanInputResponseDto> {
    const request = await this.getById(id, organizationId);

    if (request.status !== 'pending') {
      throw new Error(`Human input request is ${request.status}, cannot resolve`);
    }

    // Determine if approved based on responseData
    const isApproved = dto.responseData?.status !== 'rejected';

    // Update database
    const [updated] = await this.db
      .update(humanInputRequestsTable)
      .set({
        status: 'resolved',
        responseData: dto.responseData,
        respondedBy: dto.respondedBy,
        respondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(humanInputRequestsTable.id, id))
      .returning();

    // Signal Temporal workflow with correct signal name and payload
    await this.temporalService.signalWorkflow({
      workflowId: updated.runId, // runId contains the Temporal workflow ID
      signalName: 'resolveHumanInput',
      args: {
        requestId: updated.id,
        nodeRef: updated.nodeRef,
        approved: isApproved,
        respondedBy: dto.respondedBy ?? 'unknown',
        responseNote: dto.responseData?.comment as string | undefined,
        respondedAt: new Date().toISOString(),
        responseData: dto.responseData,
      },
    });

    this.auditLogService.record(auth ?? null, {
      action: 'human_input.resolve',
      resourceType: 'human_input',
      resourceId: updated.id,
      resourceName: updated.title,
      metadata: {
        approved: isApproved,
        respondedBy: dto.respondedBy ?? 'unknown',
        inputType: updated.inputType,
      },
    });

    return updated as unknown as HumanInputResponseDto;
  }

  // Public resolution using token
  async resolveByToken(
    token: string,
    action: 'approve' | 'reject' | 'resolve',
    data?: Record<string, unknown>,
  ): Promise<PublicResolveResultDto> {
    const request = await this.db.query.humanInputRequests.findFirst({
      where: eq(humanInputRequestsTable.resolveToken, token),
    });

    if (!request) {
      return {
        success: false,
        message: 'Invalid or expired token',
        input: {
          id: '',
          title: '',
          inputType: 'approval',
          status: 'expired',
          respondedAt: null,
        },
      };
    }

    if (request.status !== 'pending') {
      return {
        success: false,
        message: `Request is already ${request.status}`,
        input: {
          id: request.id,
          title: request.title,
          inputType: request.inputType,
          status: request.status,
          respondedAt: request.respondedAt?.toISOString() ?? null,
        },
      };
    }

    const isApproved = action !== 'reject';
    let responseData = data || {};
    responseData = { ...responseData, status: isApproved ? 'approved' : 'rejected' };

    // Update DB
    const [updated] = await this.db
      .update(humanInputRequestsTable)
      .set({
        status: 'resolved',
        responseData: responseData,
        respondedAt: new Date(),
        respondedBy: 'public-link',
        updatedAt: new Date(),
      })
      .where(eq(humanInputRequestsTable.id, request.id))
      .returning();

    // Signal Workflow with correct signal name and payload
    await this.temporalService.signalWorkflow({
      workflowId: updated.runId,
      signalName: 'resolveHumanInput',
      args: {
        requestId: updated.id,
        nodeRef: updated.nodeRef,
        approved: isApproved,
        respondedBy: 'public-link',
        responseNote: responseData.comment as string | undefined,
        respondedAt: new Date().toISOString(),
        responseData: responseData,
      },
    });

    this.auditLogService.record(null, {
      action: 'human_input.resolve',
      resourceType: 'human_input',
      resourceId: updated.id,
      resourceName: updated.title,
      metadata: { approved: isApproved, respondedBy: 'public-link', inputType: updated.inputType },
    });

    return {
      success: true,
      message: 'Input received successfully',
      input: {
        id: updated.id,
        title: updated.title,
        inputType: updated.inputType,
        status: updated.status,
        respondedAt: updated.respondedAt?.toISOString() ?? null,
      },
    };
  }
}
