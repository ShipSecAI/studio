import { Controller, Get, Post, Body, Param, Query, Res, Req, Logger, NotFoundException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageChunk } from 'ai';
import { AgentStreamQuerySchema } from './dto/agent-stream-query.dto';
import type { AgentStreamQueryDto } from './dto/agent-stream-query.dto';
import { AgentChatRequestSchema } from './dto/agent-chat-request.dto';
import type { AgentChatRequestDto } from './dto/agent-chat-request.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import type { AgentTracePartEntry } from '../agent-trace/agent-trace.service';
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
      parts: events
        .map((event) => ({ event, chunk: convertAgentTraceToUiChunk(event) }))
        .filter(
          (entry): entry is { event: AgentTracePartEntry; chunk: UIMessageChunk } =>
            Boolean(entry.chunk),
        )
        .map(({ event, chunk }) => ({
          sequence: event.sequence,
          timestamp: event.timestamp,
          chunk,
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

    let lastSequence = typeof body?.cursor === 'number' ? body.cursor : 0;
    let seenFinish = false;
    let aborted = false;

    req.on('close', () => {
      aborted = true;
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        while (!seenFinish && !aborted) {
          const events = await this.agentTraceService.list(agentRunId, lastSequence);
          if (events.length > 0) {
            events.forEach((event) => {
              const chunk = convertAgentTraceToUiChunk(event);
              if (chunk) {
                writer.write(chunk);
                if (chunk.type === 'finish') {
                  seenFinish = true;
                }
              }
            });
            lastSequence = events[events.length - 1]?.sequence ?? lastSequence;
            continue;
          }
          await sleep(1000);
        }
      },
      onError: (error) => {
        this.logger.error(
          `Agent chat stream failed for agent ${agentRunId}`,
          error instanceof Error ? error.stack : String(error),
        );
        return error instanceof Error ? error.message : String(error);
      },
    });

    pipeUIMessageStreamToResponse({
      response: res,
      stream,
    });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function convertAgentTraceToUiChunk(event: AgentTracePartEntry): UIMessageChunk | null {
  const payload = (event.part ?? {}) as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type : undefined;
  if (!type) {
    return null;
  }

  const baseMessageId =
    typeof payload.messageId === 'string' && payload.messageId.length > 0
      ? payload.messageId
      : event.agentRunId;

  if (type === 'message-start') {
    return {
      type: 'start',
      messageId: baseMessageId,
      messageMetadata: {
        workflowRunId: event.workflowRunId,
        nodeRef: event.nodeRef,
        role: typeof payload.role === 'string' ? payload.role : 'assistant',
        sequence: event.sequence,
      },
    };
  }

  if (type === 'text-start') {
    return {
      type: 'text-start',
      id: ensureString(payload.id) ?? baseMessageId,
    };
  }

  if (type === 'data-text-start') {
    return {
      type: 'text-start',
      id: ensureString(payload.id) ?? baseMessageId,
    };
  }

  if (type === 'text-end') {
    return {
      type: 'text-end',
      id: ensureString(payload.id) ?? baseMessageId,
    };
  }

  if (type === 'data-text-end') {
    return {
      type: 'text-end',
      id: ensureString(payload.id) ?? baseMessageId,
    };
  }

  if (type === 'text-delta') {
    return {
      type: 'text-delta',
      id: ensureString(payload.id) ?? baseMessageId,
      delta: typeof payload.textDelta === 'string' ? payload.textDelta : '',
    };
  }

  if (type === 'finish') {
    return {
      type: 'finish',
      messageMetadata: {
        workflowRunId: event.workflowRunId,
        nodeRef: event.nodeRef,
        finishReason: typeof payload.finishReason === 'string' ? payload.finishReason : undefined,
        responseText: typeof payload.responseText === 'string' ? payload.responseText : undefined,
      },
    };
  }

  if (type === 'tool-input-available') {
    return {
      type: 'tool-input-available',
      toolCallId: ensureString(payload.toolCallId) ?? `${event.sequence}`,
      toolName: ensureString(payload.toolName) ?? 'tool',
      input: payload.input ?? null,
      providerExecuted: typeof payload.providerExecuted === 'boolean' ? payload.providerExecuted : undefined,
    };
  }

  if (type === 'tool-output-available') {
    return {
      type: 'tool-output-available',
      toolCallId: ensureString(payload.toolCallId) ?? `${event.sequence}`,
      output: payload.output ?? null,
      providerExecuted: typeof payload.providerExecuted === 'boolean' ? payload.providerExecuted : undefined,
    };
  }

  if (type === 'tool-input-error') {
    return {
      type: 'tool-input-error',
      toolCallId: ensureString(payload.toolCallId) ?? `${event.sequence}`,
      toolName: ensureString(payload.toolName) ?? 'tool',
      input: payload.input ?? null,
      errorText: ensureString(payload.errorText) ?? 'Tool input error',
    };
  }

  if (type === 'tool-output-error') {
    return {
      type: 'tool-output-error',
      toolCallId: ensureString(payload.toolCallId) ?? `${event.sequence}`,
      errorText: ensureString(payload.errorText) ?? 'Tool output error',
    };
  }

  if (type.startsWith('data-')) {
    return {
      type: type as `data-${string}`,
      data: payload.data ?? payload,
    };
  }

  return null;
}

function ensureString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
