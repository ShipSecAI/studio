import { Global, Module, forwardRef } from '@nestjs/common';

import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

import { ApiKeysModule } from '../api-keys/api-keys.module';

@Global()
@Module({
  imports: [forwardRef(() => ApiKeysModule)],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
