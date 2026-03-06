import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  OnboardingPreferencesDto,
  UpdateOnboardingPreferencesDto,
} from './dto/onboarding-preferences.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('preferences')
  @ApiOkResponse({ type: OnboardingPreferencesDto })
  async getPreferences(@CurrentAuth() auth: AuthContext | null) {
    return this.onboardingService.getPreferences(auth);
  }

  @Patch('preferences')
  @ApiOkResponse({ type: OnboardingPreferencesDto })
  async updatePreferences(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: UpdateOnboardingPreferencesDto,
  ) {
    return this.onboardingService.updatePreferences(auth, body);
  }
}
