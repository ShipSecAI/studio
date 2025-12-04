import { Controller, Get, Param, Query, Res, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AgentStreamQueryDto, AgentStreamQuerySchema } from './dto/agent-stream-query.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { TraceService } from '../trace/trace.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly traceService: TraceService,
  ) {}

  @Get('/:runId/stream')
  @ApiOkResponse({ description: 'Server-sent events stream for agent reasoning updates' })
  async stream(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(AgentStreamQuerySchema)) query: AgentStreamQueryDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    await this.workflowsService.ensureRunAccess(runId, auth);

    let lastSequence = Number.parseInt(query.cursor ?? '0', 10);
    if (Number.isNaN(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

    const targetNodeId = query.nodeId?.trim() ? query.nodeId.trim() : null;
    let active = true;
    let intervalId: NodeJS.Timeout | null = null;
    let heartbeatId: NodeJS.Timeout | null = null;

    const send = (event: string, payload: unknown) => {
      if (!active) {
        return;
      }
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

    const pump = async () => {
      if (!active) {
        return;
      }

      try {
        const { events } = await this.traceService.listSince(runId, lastSequence, auth);
        const agentEvents = events.filter((event) => {
          if (targetNodeId && event.nodeId !== targetNodeId) {
            return false;
          }
          return typeof event.data?.agentEvent === 'string';
        });

        if (agentEvents.length > 0) {
          const lastId = agentEvents[agentEvents.length - 1]?.id;
          if (lastId) {
            const parsed = Number.parseInt(lastId, 10);
            if (!Number.isNaN(parsed)) {
              lastSequence = parsed;
            }
          }

          const normalized = agentEvents.map((event) => ({
            id: event.id,
            runId: event.runId,
            nodeId: event.nodeId,
            timestamp: event.timestamp,
            agentEvent: event.data?.agentEvent,
            data: event.data,
            level: event.level,
          }));

          send('agent', {
            events: normalized,
            cursor: lastSequence.toString(),
          });
        }
      } catch (error) {
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
}
