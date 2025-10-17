import { Module } from '@nestjs/common';

import { ComponentsController } from './components.controller';

@Module({
  controllers: [ComponentsController],
  exports: [],
})
export class ComponentsModule {}
