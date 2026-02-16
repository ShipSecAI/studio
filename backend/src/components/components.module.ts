import { Module } from '@nestjs/common';

// Register worker components so the registry is populated before controllers run
import '@shipsec/studio-worker/components';

import { ComponentsController } from './components.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ApiKeysModule, AuthModule],
  controllers: [ComponentsController],
  exports: [],
})
export class ComponentsModule {}
