import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgentSkillsController } from './agent-skills.controller';
import { AgentSkillsRepository } from './agent-skills.repository';
import { AgentSkillsService } from './agent-skills.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentSkillsController],
  providers: [AgentSkillsService, AgentSkillsRepository],
  exports: [AgentSkillsService],
})
export class AgentSkillsModule {}
