import { Controller, Get, Post, Body, Param, Query, Res, Req, Logger, NotFoundException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AgentStreamQuerySchema } from './dto/agent-stream-query.dto';
import type { AgentStreamQueryDto } from './dto/agent-stream-query.dto';
import { AgentChatRequestSchema } from './dto/agent-chat-request.dto';
import type { AgentChatRequestDto } from './dto/agent-chat-request.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly agentTraceService: AgentTraceService,
  ) {}

  @Get('/:agentRunId/stream')
  @ApiOkResponse({ description: 'Server-sent events stream for agent reasoning updates' })
  async stream(
    @Param('agentRunId') agentRunId: string,
    @Query(new ZodValidationPipe(AgentStreamQuerySchema)) query: AgentStreamQueryDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    const metadata = await this.agentTraceService.getRunMetadata(agentRunId);
    if (!metadata) {
      throw new NotFoundException(`Agent run ${agentRunId} not found`);
    }
    await this.workflowsService.ensureRunAccess(metadata.workflowRunId, auth);
    this.logger.log(`Agent stream requested for agentRunId=${agentRunId}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    let lastSequence = Number.parseInt(query.cursor ?? '0', 10);
    if (Number.isNaN(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

    let active = true;
    let intervalId: NodeJS.Timeout | null = null;
    let heartbeatId: NodeJS.Timeout | null = null;

    const send = (event: string, payload: unknown) => {
      if (!active) {
        return;
      }
      this.logger.debug(
        `Sending agent SSE (${event}) for agent ${agentRunId} payload=${JSON.stringify(payload).slice(0, 200)}...`,
      );
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }
      res.end();
    };

    const emitPart = (payload: Record<string, unknown>) => {
      res.write('event: message\n');
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const pump = async () => {
      if (!active) {
        return;
      }

      try {
        const events = await this.agentTraceService.list(agentRunId, lastSequence);
        if (events.length > 0) {
          events.forEach((event) => {
            emitPart({
              type: typeof event.part?.type === 'string' ? event.part.type : 'data',
              sequence: event.sequence,
              timestamp: event.timestamp,
              payload: event.part,
              agentRunId,
              workflowRunId: event.workflowRunId,
              nodeRef: event.nodeRef,
            });
          });
          lastSequence = events[events.length - 1]?.sequence ?? lastSequence;
          send('cursor', { cursor: lastSequence });
        }
      } catch (error) {
        this.logger.error(
          `Agent stream pump failed for agent ${agentRunId}`,
          error instanceof Error ? error.stack : String(error),
        );
        send('error', {
          message: 'agent_stream_failed',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    };

    intervalId = setInterval(pump, 1000);
    heartbeatId = setInterval(() => {
      send('heartbeat', { ts: Date.now() });
    }, 15000);

    req.on('close', cleanup);
    await pump();
  }

  @Get('/:agentRunId/parts')
  @ApiOkResponse({ description: 'Returns stored agent trace parts' })
  async parts(
    @Param('agentRunId') agentRunId: string,
    @Query(new ZodValidationPipe(AgentStreamQuerySchema)) query: AgentStreamQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const metadata = await this.agentTraceService.getRunMetadata(agentRunId);
    if (!metadata) {
      throw new NotFoundException(`Agent run ${agentRunId} not found`);
    }
    await this.workflowsService.ensureRunAccess(metadata.workflowRunId, auth);
    const cursor = Number.parseInt(query.cursor ?? '0', 10);
    const effectiveCursor = Number.isNaN(cursor) ? undefined : cursor;
    const events = await this.agentTraceService.list(agentRunId, effectiveCursor);
    const lastSequence = events.length > 0 ? events[events.length - 1]?.sequence : effectiveCursor ?? 0;

    return {
      agentRunId,
      workflowRunId: metadata.workflowRunId,
      nodeRef: metadata.nodeRef,
      cursor: lastSequence ?? 0,
      parts: events.map((event) => ({
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.part?.type ?? 'data',
        payload: event.part,
      })),
    };
  }

  @Post('/:agentRunId/chat')
  @ApiOkResponse({ description: 'AI SDK-compatible SSE for agent run' })
  async chat(
    @Param('agentRunId') agentRunId: string,
    @Body(new ZodValidationPipe(AgentChatRequestSchema)) body: AgentChatRequestDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    const metadata = await this.agentTraceService.getRunMetadata(agentRunId);
    if (!metadata) {
      throw new NotFoundException(`Agent run ${agentRunId} not found`);
    }
    await this.workflowsService.ensureRunAccess(metadata.workflowRunId, auth);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    let lastSequence = typeof body?.cursor === 'number' ? body.cursor : 0;
    let active = true;
    let seenFinish = false;
    let intervalId: NodeJS.Timeout | null = null;

    const write = (payload: Record<string, unknown> | string) => {
      if (!active) {
        return;
      }
      res.write('event: message\n');
      res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
    };

    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      res.end();
    };

    const pump = async () => {
      if (!active || seenFinish) {
        return;
      }
      try {
        const events = await this.agentTraceService.list(agentRunId, lastSequence);
        if (events.length === 0) {
          return;
        }
        events.forEach((event) => {
          const partType = typeof event.part?.type === 'string' ? event.part.type : 'data';
          write({
            type: partType,
            sequence: event.sequence,
            timestamp: event.timestamp,
            agentRunId,
            workflowRunId: event.workflowRunId,
            nodeRef: event.nodeRef,
            payload: event.part,
          });
          if (partType === 'finish') {
            seenFinish = true;
          }
        });
        lastSequence = events[events.length - 1]?.sequence ?? lastSequence;
        if (seenFinish) {
          write('[DONE]');
          cleanup();
        }
      } catch (error) {
        this.logger.error(
          `Agent chat stream failed for agent ${agentRunId}`,
          error instanceof Error ? error.stack : String(error),
        );
        write(
          JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        write('[DONE]');
        cleanup();
      }
    };

    intervalId = setInterval(pump, 1000);
    req.on('close', cleanup);
    await pump();
  }
}
