import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatTurnRepository } from './chat-turn.repository';
import { ChatSessionEventRepository } from './chat-session-event.repository';
import { ChatTurnDraftRepository } from './chat-turn-draft.repository';
import { ChatStreamService } from './chat-stream.service';
import { TerminalModule } from '../terminal/terminal.module';

@Module({
  imports: [TerminalModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatSessionRepository,
    ChatTurnRepository,
    ChatSessionEventRepository,
    ChatTurnDraftRepository,
    ChatStreamService,
  ],
})
export class ChatModule {}
