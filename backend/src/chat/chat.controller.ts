import { Controller, Post, Get, Patch, Delete, Body, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';

import { ChatService } from './chat.service';
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

  @Post(':id/messages')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async sendMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageDto,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    await this.chatService.streamChatToResponse(id, body.messages, auth, res);
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

  @Get(':id/stream')
  async streamLive(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    const fmt = format === 'ndjson' ? 'ndjson' : 'sse';
    await this.chatService.streamLiveToResponse(id, fmt, auth, res);
  }

  /** Internal endpoint: worker flushes partial response during streaming */
  @Post(':id/partial')
  async upsertPartialResponse(@Param('id') id: string, @Body() body: { parts: unknown[] }) {
    await this.chatService.upsertPartialResponse(id, body.parts);
    return { success: true };
  }

  /** Internal endpoint: worker signals completion and cleans up partial */
  @Post(':id/complete')
  async completeSession(@Param('id') id: string) {
    await this.chatService.clearPartialResponse(id);
    return { success: true };
  }
}
