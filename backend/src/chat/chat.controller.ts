import { Controller, Post, Body, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';

import { ChatService } from './chat.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ChatRequestSchema } from './dto/chat-request.dto';
import type { ChatRequestDto } from './dto/chat-request.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async chat(
    @Body(new ZodValidationPipe(ChatRequestSchema)) body: ChatRequestDto,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    await this.chatService.streamChatToResponse(body.messages, auth, res);
  }
}
