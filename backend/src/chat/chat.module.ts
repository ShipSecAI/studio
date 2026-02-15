import { Module } from '@nestjs/common';

import { StudioMcpModule } from '../studio-mcp/studio-mcp.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [StudioMcpModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
