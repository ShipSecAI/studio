import { Controller, Get, Headers, BadRequestException } from '@nestjs/common';

import { InternalOnly } from '../common/guards/internal-only.guard';
import { LiteLLMKeyResolverService } from './litellm-key-resolver.service';

@Controller('internal/billing')
export class InternalBillingController {
  constructor(private readonly keyResolver: LiteLLMKeyResolverService) {}

  @Get('litellm-key')
  @InternalOnly()
  async getLiteLLMKey(@Headers('x-organization-id') organizationId?: string) {
    if (!organizationId) {
      throw new BadRequestException('x-organization-id header is required');
    }

    const virtualKey = await this.keyResolver.resolveVirtualKey(organizationId.trim());

    return { virtualKey };
  }
}
