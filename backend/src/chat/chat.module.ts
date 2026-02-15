import { Module } from '@nestjs/common';

import { StudioMcpModule } from '../studio-mcp/studio-mcp.module';
import { ChatController, ChatToolsController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatStreamService } from './chat-stream.service';

@Module({
  imports: [StudioMcpModule],
  controllers: [ChatController, ChatToolsController],
  providers: [ChatService, ChatSessionRepository, ChatStreamService],
})
export class ChatModule {}
