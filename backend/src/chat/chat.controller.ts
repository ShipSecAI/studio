import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';

import { ChatService } from './chat.service';
import { RunMismatchError } from './chat-stream-event.repository';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  CreateSessionSchema,
  UpdateSessionSchema,
  SendMessageSchema,
  type CreateSessionDto,
  type UpdateSessionDto,
  type SendMessageDto,
} from './dto/chat-session.dto';

@Controller('chat/sessions')
export class ChatController {
  private readonly activeStreams = new Map<string, number>();

  constructor(private readonly chatService: ChatService) {}

  @Post()
  async createSession(
    @Body(new ZodValidationPipe(CreateSessionSchema)) body: CreateSessionDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.createSession(auth, body.title);
  }

  @Get()
  async listSessions(@CurrentAuth() auth: AuthContext) {
    return this.chatService.listSessions(auth);
  }

  @Get(':id')
  async getSession(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getSession(id, auth);
  }

  @Patch(':id')
  async updateSession(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSessionSchema)) body: UpdateSessionDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.updateSessionTitle(id, body.title, auth);
  }

  @Delete(':id')
  async deleteSession(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    await this.chatService.deleteSession(id, auth);
    return { success: true };
  }

  @Get(':id/messages')
  async getMessages(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getMessages(id, auth);
  }

  /**
   * Send a message and return the runId.
   * The actual streaming happens via GET /:id/stream endpoint.
   * This allows multiple clients to attach to the same stream.
   */
  @Post(':id/messages')
  @Throttle({ default: { limit: 200, ttl: 60000 } })
  async sendMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    // body.messages contains an array, we only care about the last message
    const lastMessage = body.messages[body.messages.length - 1];
    if (!lastMessage) {
      return { error: 'No message provided' };
    }
    return this.chatService.sendMessage(id, lastMessage, auth);
  }

  @Post(':id/interrupt')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async interruptGeneration(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.interruptGeneration(id, auth);
  }

  // ---------------------------------------------------------------------------
  // Detachable session endpoints
  // ---------------------------------------------------------------------------

  @Get(':id/status')
  async getProcessingStatus(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getProcessingStatus(id, auth);
  }

  @Get(':id/partial')
  async getPartialResponse(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getPartialResponse(id, auth);
  }

  /**
   * Unified streaming endpoint for AI SDK v6 UIMessageChunk format.
   *
   * Used by:
   * - DurableChatTransport.sendMessages (after POST returns runId)
   * - DurableChatTransport.reconnectToStream (for late-joining tabs or refresh)
   *
   * All clients receive identical events from PostgreSQL replay + Redis pub/sub.
   */
  @Get(':id/stream')
  @Throttle({ default: { limit: 2000, ttl: 60000 } })
  async streamLive(
    @Param('id') id: string,
    @Query('runId') runId: string | undefined,
    @Query('afterSeq') afterSeqRaw: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    const current = this.activeStreams.get(id) ?? 0;
    if (current >= 3) {
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        message: 'Too many concurrent stream connections for this session',
      });
      return;
    }

    this.activeStreams.set(id, current + 1);

    res.on('close', () => {
      const count = this.activeStreams.get(id) ?? 1;
      if (count <= 1) {
        this.activeStreams.delete(id);
      } else {
        this.activeStreams.set(id, count - 1);
      }
    });

    const parsedAfterSeq = Number(afterSeqRaw ?? '0');
    const afterSeq = Number.isFinite(parsedAfterSeq) && parsedAfterSeq > 0 ? parsedAfterSeq : 0;
    await this.chatService.streamToResponse(id, auth, res, { runId, afterSeq });
  }

  @Get(':id/events')
  @Throttle({ default: { limit: 2000, ttl: 60000 } })
  async listRunEvents(
    @Param('id') id: string,
    @Query('runId') runId: string | undefined,
    @Query('afterSeq') afterSeqRaw: string | undefined,
    @CurrentAuth() auth: AuthContext,
  ) {
    if (!runId) {
      return { runId: null, events: [] };
    }
    const parsedAfterSeq = Number(afterSeqRaw ?? '0');
    const afterSeq = Number.isFinite(parsedAfterSeq) && parsedAfterSeq > 0 ? parsedAfterSeq : 0;
    return this.chatService.getRunEvents(id, runId, afterSeq, auth);
  }

  /** Internal endpoint: worker flushes partial response during streaming */
  @Post(':id/partial')
  @SkipThrottle()
  async upsertPartialResponse(@Param('id') id: string, @Body() body: { parts: unknown[] }) {
    await this.chatService.upsertPartialResponse(id, body.parts);
    return { success: true };
  }

  /** Internal endpoint: worker appends durable stream events */
  @Post(':id/events')
  @SkipThrottle()
  async appendRunEvent(
    @Param('id') id: string,
    @Body() body: { runId: string; event: Record<string, unknown> },
    @Res() res: Response,
  ) {
    try {
      const seq = await this.chatService.appendStreamEvent(id, body.runId, body.event);
      return res.status(HttpStatus.OK).json({ seq });
    } catch (error) {
      if (error instanceof RunMismatchError) {
        return res.status(HttpStatus.CONFLICT).json({
          error: 'GENERATION_SUPERSEDED',
          message: error.message,
        });
      }
      throw error;
    }
  }

  /** Internal endpoint: worker signals completion and cleans up partial */
  @Post(':id/complete')
  @SkipThrottle()
  async completeSession(@Param('id') id: string, @Body() body: { runId?: string }) {
    await this.chatService.clearPartialResponse(id, body?.runId);
    return { success: true };
  }
}
