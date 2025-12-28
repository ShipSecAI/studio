import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { humanInputRequests, humanInputRequests as humanInputRequestsTable } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { 
  ResolveHumanInputDto, 
  ListHumanInputsQueryDto,
  HumanInputResponseDto,
  PublicResolveResultDto
} from './dto/human-inputs.dto';
import { TemporalService } from '../temporal/temporal.service';

@Injectable()
export class HumanInputsService {
  private readonly logger = new Logger(HumanInputsService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly temporalService: TemporalService,
  ) {}

  async list(query?: ListHumanInputsQueryDto): Promise<HumanInputResponseDto[]> {
    const conditions = [];
    
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

  async getById(id: string): Promise<HumanInputResponseDto> {
    const request = await this.db.query.humanInputRequests.findFirst({
      where: eq(humanInputRequestsTable.id, id),
    });

    if (!request) {
      throw new NotFoundException(`Human input request with ID ${id} not found`);
    }

    return request as unknown as HumanInputResponseDto;
  }

  async resolve(id: string, dto: ResolveHumanInputDto): Promise<HumanInputResponseDto> {
    const request = await this.getById(id);

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

    return updated as unknown as HumanInputResponseDto;
  }

  // Public resolution using token
  async resolveByToken(token: string, action: 'approve' | 'reject' | 'resolve', data?: Record<string, unknown>): Promise<PublicResolveResultDto> {
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
          respondedAt: null
        }
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
          respondedAt: request.respondedAt?.toISOString() ?? null
        }
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

    return {
      success: true,
      message: 'Input received successfully',
      input: {
          id: updated.id,
          title: updated.title,
          inputType: updated.inputType,
          status: updated.status,
          respondedAt: updated.respondedAt?.toISOString() ?? null
      }
    };
  }
}
