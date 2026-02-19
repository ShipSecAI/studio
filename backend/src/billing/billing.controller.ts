import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

import { BillingService } from './billing.service';
import { SubscriptionPlansService } from './subscription-plans.service';
import { BillingUsageResponseDto } from './dto/billing-usage.dto';
import { SubscriptionPlanDto } from './dto/subscription-plan.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly plansService: SubscriptionPlansService,
  ) {}

  @Get('/usage')
  @ApiOkResponse({ type: BillingUsageResponseDto })
  async usage(@CurrentAuth() auth: AuthContext) {
    return this.billingService.getUsage(auth);
  }

  @Get('/plans')
  @ApiOkResponse({ type: [SubscriptionPlanDto] })
  async plans() {
    return this.plansService.getAllActivePlans();
  }
}
