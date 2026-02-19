import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatStreamService } from './chat-stream.service';
import { TerminalModule } from '../terminal/terminal.module';

@Module({
  imports: [TerminalModule],
  controllers: [ChatController],
  providers: [ChatService, ChatSessionRepository, ChatStreamService],
})
export class ChatModule {}
