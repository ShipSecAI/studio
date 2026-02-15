import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ChatService } from './chat.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import type { RequestWithAuthContext } from '../auth/auth.guard';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(
    @Req() req: RequestWithAuthContext,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    const { messages } = req.body;

    await this.chatService.streamChatToResponse(messages, auth, res);
  }
}
