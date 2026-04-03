import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ChatModule } from '../chat/chat.module';

import { SlackEventsController } from './slack-events.controller';
import { SlackBotService } from './slack-bot.service';
import { SlackEventBridge } from './slack-event-bridge';
import { SlackThreadMappingRepository } from './slack-thread-mapping.repository';
import { SlackTurnPostRepository } from './slack-turn-post.repository';

@Module({
  imports: [DatabaseModule, IntegrationsModule, ChatModule],
  controllers: [SlackEventsController],
  providers: [
    SlackBotService,
    SlackEventBridge,
    SlackThreadMappingRepository,
    SlackTurnPostRepository,
  ],
  exports: [SlackBotService],
})
export class SlackBotModule {}
