import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ChatService } from './chat.service';
import {
  AppendInternalEventSchema,
  AppendInternalEventResponseDto,
  CreateSessionSchema,
  ChatEventsResponseDto,
  ChatSessionResponseDto,
  DeleteSessionResponseDto,
  RunCompletionResponseDto,
  SubmitOperationSchema,
  SubmitOperationResponseDto,
  ThreadHistoryResponseDto,
  UpdateSessionSchema,
  CompleteRunRequestDto,
  AppendInternalEventDto,
  CreateSessionDto,
  SubmitOperationDto,
  UpdateSessionDto,
} from './dto/chat-session.dto';

@ApiTags('chat')
@Controller('chat/sessions')
export class ChatController {
  private static readonly MAX_ACTIVE_STREAMS_PER_SESSION = 12;

  private readonly activeStreams = new Map<string, number>();

  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiCreatedResponse({ type: ChatSessionResponseDto })
  async createSession(
    @Body(new ZodValidationPipe(CreateSessionSchema)) body: CreateSessionDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.createSession(auth, body.title);
  }

  @Get()
  @ApiOkResponse({ type: [ChatSessionResponseDto] })
  async listSessions(@CurrentAuth() auth: AuthContext) {
    return this.chatService.listSessions(auth);
  }

  @Get(':id')
  @ApiOkResponse({ type: ChatSessionResponseDto })
  async getSession(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getSession(id, auth);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ChatSessionResponseDto })
  async updateSession(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSessionSchema)) body: UpdateSessionDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.updateSessionTitle(id, body.title, auth);
  }

  @Delete(':id')
  @ApiOkResponse({ type: DeleteSessionResponseDto })
  async deleteSession(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    await this.chatService.deleteSession(id, auth);
    return { success: true };
  }

  @Post(':id/submissions')
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @ApiCreatedResponse({ type: SubmitOperationResponseDto })
  async submitOperation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitOperationSchema)) body: SubmitOperationDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.submitOperation(id, body, auth);
  }

  @Get(':id/thread-history')
  @ApiOkResponse({ type: ThreadHistoryResponseDto })
  async getThreadHistory(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.chatService.getThreadHistory(id, auth);
  }

  @Get(':id/stream')
  @Throttle({ default: { limit: 10000, ttl: 60000 } })
  async streamLive(
    @Param('id') id: string,
    @Query('afterSeq') afterSeqRaw: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    const current = this.activeStreams.get(id) ?? 0;
    if (current >= ChatController.MAX_ACTIVE_STREAMS_PER_SESSION) {
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
    await this.chatService.streamToResponse(id, auth, res, { afterSeq });
  }

  @Get(':id/events')
  @Throttle({ default: { limit: 10000, ttl: 60000 } })
  @ApiOkResponse({ type: ChatEventsResponseDto })
  async listEvents(
    @Param('id') id: string,
    @Query('afterSeq') afterSeqRaw: string | undefined,
    @CurrentAuth() auth: AuthContext,
  ) {
    const parsedAfterSeq = Number(afterSeqRaw ?? '0');
    const afterSeq = Number.isFinite(parsedAfterSeq) && parsedAfterSeq > 0 ? parsedAfterSeq : 0;
    return this.chatService.getEvents(id, afterSeq, auth);
  }

  @Post(':id/internal/events')
  @SkipThrottle()
  @ApiOkResponse({ type: AppendInternalEventResponseDto })
  async appendInternalEvent(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AppendInternalEventSchema)) body: AppendInternalEventDto,
    @Res() res: Response,
  ) {
    const seq = await this.chatService.appendInternalEvent(id, body);
    return res.status(HttpStatus.OK).json({ seq });
  }

  @Post(':id/internal/run-completion')
  @SkipThrottle()
  @ApiOkResponse({ type: RunCompletionResponseDto })
  async appendRunCompletion(@Param('id') id: string, @Body() body: CompleteRunRequestDto) {
    await this.chatService.completeRun(id, body?.runId);
    return { success: true };
  }
}
