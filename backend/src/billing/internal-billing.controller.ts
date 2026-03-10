import { Controller, Get, Headers, BadRequestException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { InternalOnly } from '../common/guards/internal-only.guard';
import { LiteLLMKeyResolverService } from './litellm-key-resolver.service';
import { LiteLLMKeyResponseDto } from './dto/internal-billing.dto';

@ApiTags('internal-billing')
@Controller('internal/billing')
export class InternalBillingController {
  constructor(private readonly keyResolver: LiteLLMKeyResolverService) {}

  @Get('litellm-key')
  @InternalOnly()
  @ApiOkResponse({ type: LiteLLMKeyResponseDto })
  async getLiteLLMKey(
    @Headers('x-organization-id') organizationId?: string,
  ): Promise<LiteLLMKeyResponseDto> {
    if (!organizationId) {
      throw new BadRequestException('x-organization-id header is required');
    }

    const virtualKey = await this.keyResolver.resolveVirtualKey(organizationId.trim());

    return { virtualKey };
  }
}
