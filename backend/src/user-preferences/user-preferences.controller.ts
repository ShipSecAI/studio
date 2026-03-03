import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { UserPreferencesService } from './user-preferences.service';
import { UpdateUserPreferencesDto, UserPreferencesResponseDto } from './user-preferences.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('user-preferences')
@Controller('users/me/preferences')
export class UserPreferencesController {
  constructor(private readonly service: UserPreferencesService) {}

  @Get()
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  async getPreferences(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<UserPreferencesResponseDto> {
    return this.service.getPreferences(auth);
  }

  @Patch()
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  async updatePreferences(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    return this.service.updatePreferences(auth, body);
  }
}
