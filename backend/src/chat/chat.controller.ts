import { Controller, Post, Get, Patch, Delete, Body, Param, Res } from '@nestjs/common';
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
}

// Separate controller for internal tool API (avoids route conflict with :id param)
@Controller('chat/tools')
export class ChatToolsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  getToolDefinitions(@CurrentAuth() auth: AuthContext) {
    return this.chatService.getToolDefinitionsForWorker(auth);
  }

  @Post(':name/execute')
  async executeToolForWorker(
    @Param('name') name: string,
    @Body() args: Record<string, unknown>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.chatService.executeToolForWorker(name, args, auth);
  }
}
